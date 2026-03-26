'use node';

import { gzipSync } from 'node:zlib';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import {
  getAuditArchiveRuntimeConfig,
  getFileStorageBackendMode,
  isS3BackedFileStorageBackendMode,
} from '../src/lib/server/env.server';
import type { AuthAuditEvent } from '../src/lib/shared/auth-audit';
import { isAuthAuditEventType } from '../src/lib/shared/auth-audit';
import {
  getAuditArchiveObjectBytes,
  headAuditArchiveObject,
  putAuditArchiveMetricData,
  putAuditArchiveObject,
} from './lib/auditArchiveS3';
import { recordSystemAuditEvent } from './lib/auditEmitters';

type AuditLedgerArchiveVerificationDoc = Doc<'auditLedgerArchiveVerifications'>;
type AuditLedgerEventDoc = Doc<'auditLedgerEvents'>;
type AuditLedgerStateSnapshot = {
  chainId: string;
  chainVersion: number;
  headSequence: number;
  headEventHash: string | null;
  startedAt: number;
  updatedAt: number;
};
type ArchiveVerificationStatus =
  | 'verified'
  | 'missing_object'
  | 'hash_mismatch'
  | 'no_seal'
  | 'disabled';
type AuditArchiveManifest = {
  endSequence: number;
  headHash: string | null;
  manifestObjectKey: string;
  objectKey: string;
  payloadSha256: string;
  startSequence: number;
};
type AuditArchiveWorkerResult = {
  endSequence: number | null;
  exported: boolean;
  reason: string;
  startSequence: number | null;
};
type AuditArchiveVerificationResult = {
  checkedAt: number;
  configured: boolean;
  driftDetected: boolean;
  exporterEnabled: boolean;
  failureReason: string | null;
  lagCount: number;
  lastVerificationStatus: ArchiveVerificationStatus;
  lastVerifiedSealEndSequence: number | null;
  latestExportEndSequence: number | null;
  latestManifestObjectKey: string | null;
  latestPayloadObjectKey: string | null;
  latestSealEndSequence: number | null;
  manifestSha256: string | null;
  payloadSha256: string | null;
  required: boolean;
};
type ArchiveRuntimeState = {
  configured: boolean;
  config: ReturnType<typeof getAuditArchiveRuntimeConfig> | null;
  errorMessage: string | null;
  exporterEnabled: boolean;
  required: boolean;
};

const archiveVerificationStatusValidator = v.union(
  v.literal('verified'),
  v.literal('missing_object'),
  v.literal('hash_mismatch'),
  v.literal('no_seal'),
  v.literal('disabled'),
);

function parseMetadata(metadata: string | undefined) {
  if (!metadata) {
    return undefined;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

function toAuditEvent(log: AuditLedgerEventDoc): AuthAuditEvent | null {
  if (!isAuthAuditEventType(log.eventType)) {
    return null;
  }

  return {
    id: log.id,
    sequence: log.sequence,
    eventType: log.eventType,
    provenance: log.provenance,
    ...(log.userId ? { userId: log.userId } : {}),
    ...(log.actorUserId ? { actorUserId: log.actorUserId } : {}),
    ...(log.targetUserId ? { targetUserId: log.targetUserId } : {}),
    ...(log.organizationId ? { organizationId: log.organizationId } : {}),
    ...(log.identifier ? { identifier: log.identifier } : {}),
    ...(log.sessionId ? { sessionId: log.sessionId } : {}),
    ...(log.requestId ? { requestId: log.requestId } : {}),
    ...(log.outcome ? { outcome: log.outcome } : {}),
    ...(log.severity ? { severity: log.severity } : {}),
    ...(log.resourceType ? { resourceType: log.resourceType } : {}),
    ...(log.resourceId ? { resourceId: log.resourceId } : {}),
    ...(log.resourceLabel ? { resourceLabel: log.resourceLabel } : {}),
    ...(log.sourceSurface ? { sourceSurface: log.sourceSurface } : {}),
    ...(log.eventHash ? { eventHash: log.eventHash } : {}),
    ...(log.previousEventHash ? { previousEventHash: log.previousEventHash } : {}),
    recordedAt: log.recordedAt,
    ...(log.ipAddress ? { ipAddress: log.ipAddress } : {}),
    ...(log.userAgent ? { userAgent: log.userAgent } : {}),
    ...(log.metadata ? { metadata: parseMetadata(log.metadata) } : {}),
  };
}

async function sha256HexBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function padSequence(sequence: number) {
  return String(sequence).padStart(12, '0');
}

function buildArchiveKey(args: {
  chainId: string;
  endSequence: number;
  headHash: string | null;
  prefix: string;
  startSequence: number;
}) {
  return `${args.prefix}${args.chainId}/${padSequence(args.startSequence)}-${padSequence(args.endSequence)}-${args.headHash ?? 'null'}`;
}

function getArchiveRuntimeState(): ArchiveRuntimeState {
  const backendMode = getFileStorageBackendMode();
  const required = isS3BackedFileStorageBackendMode(backendMode);

  try {
    const config = getAuditArchiveRuntimeConfig();
    const configured = Boolean(
      config.awsRegion && config.bucket && config.kmsKeyArn && config.roleArn,
    );
    return {
      configured,
      config,
      errorMessage: configured ? null : required ? 'Archive config missing.' : null,
      exporterEnabled: configured,
      required,
    };
  } catch (error) {
    return {
      configured: false,
      config: null,
      errorMessage: error instanceof Error ? error.message : 'Archive config unavailable.',
      exporterEnabled: false,
      required,
    };
  }
}

function isMissingObjectError(error: unknown) {
  const statusCode =
    typeof error === 'object' && error !== null
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
  return statusCode === 404 || name === 'NotFound' || name === 'NoSuchKey';
}

async function objectExists(key: string) {
  try {
    await headAuditArchiveObject({ key });
    return true;
  } catch (error) {
    if (isMissingObjectError(error)) {
      return false;
    }
    throw error;
  }
}

async function collectEventsForRange(
  ctx: Pick<ActionCtx, 'runQuery'>,
  args: { endSequence: number; startSequence: number },
) {
  const events: AuthAuditEvent[] = [];
  let cursor: string | undefined;
  let isDone = false;

  while (!isDone) {
    const page: {
      continueCursor: string;
      isDone: boolean;
      page: AuditLedgerEventDoc[];
    } = await ctx.runQuery(internal.audit.listAuditLedgerEventsForVerificationInternal, {
      cursor,
      endSequence: args.endSequence,
      startSequence: args.startSequence,
    });

    for (const event of page.page) {
      const normalized = toAuditEvent(event);
      if (normalized) {
        events.push(normalized);
      }
    }

    cursor = page.continueCursor;
    isDone = page.isDone;
  }

  return events;
}

async function publishArchiveMetrics(input: {
  bucketName: string | null;
  driftDetected: boolean;
  exporterEnabled: boolean;
  lagCount: number;
  latestSealVerified: boolean;
}) {
  if (!input.bucketName) {
    return;
  }

  await putAuditArchiveMetricData({
    bucketName: input.bucketName,
    metrics: [
      {
        metricName: 'ArchiveExporterDisabled',
        unit: 'Count',
        value: input.exporterEnabled ? 0 : 1,
      },
      {
        metricName: 'ArchiveLagCount',
        unit: 'Count',
        value: input.lagCount,
      },
      {
        metricName: 'ArchiveSealExportDrift',
        unit: 'Count',
        value: input.driftDetected ? 1 : 0,
      },
      {
        metricName: 'ArchiveLatestSealVerified',
        unit: 'Count',
        value: input.latestSealVerified ? 1 : 0,
      },
    ],
  });
}

async function recordArchiveVerificationTransition(args: {
  ctx: Pick<ActionCtx, 'runMutation'>;
  next: AuditArchiveVerificationResult;
  previous: AuditLedgerArchiveVerificationDoc | null;
}) {
  const previousStatus = args.previous?.lastVerificationStatus ?? null;
  if (args.next.lastVerificationStatus !== 'verified') {
    if (
      previousStatus !== null &&
      previousStatus !== 'verified' &&
      previousStatus === args.next.lastVerificationStatus
    ) {
      return;
    }

    await recordSystemAuditEvent(args.ctx, {
      emitter: 'audit.archive',
      eventType: 'audit_archive_verification_failed',
      metadata: JSON.stringify({
        driftDetected: args.next.driftDetected ? 'true' : 'false',
        failureReason: args.next.failureReason,
        lagCount: args.next.lagCount,
        latestSealEndSequence: args.next.latestSealEndSequence ?? 0,
        verificationStatus: args.next.lastVerificationStatus,
      }),
      outcome: 'failure',
      resourceId: String(args.next.latestSealEndSequence ?? 'none'),
      resourceType: 'audit_archive_verification',
      severity: args.next.required ? 'critical' : 'warning',
      sourceSurface: 'audit.archive',
      ...(args.next.latestPayloadObjectKey || args.next.latestManifestObjectKey
        ? {
            resourceLabel:
              args.next.latestPayloadObjectKey ?? args.next.latestManifestObjectKey ?? undefined,
          }
        : {}),
    });
    return;
  }

  if (previousStatus && previousStatus !== 'verified') {
    await recordSystemAuditEvent(args.ctx, {
      emitter: 'audit.archive',
      eventType: 'audit_archive_verification_recovered',
      metadata: JSON.stringify({
        driftDetected: args.next.driftDetected ? 'true' : 'false',
        lagCount: args.next.lagCount,
        latestSealEndSequence: args.next.latestSealEndSequence ?? 0,
        verificationStatus: args.next.lastVerificationStatus,
      }),
      outcome: 'success',
      resourceId: String(args.next.latestSealEndSequence ?? 'none'),
      resourceType: 'audit_archive_verification',
      severity: 'info',
      sourceSurface: 'audit.archive',
      ...(args.next.latestPayloadObjectKey || args.next.latestManifestObjectKey
        ? {
            resourceLabel:
              args.next.latestPayloadObjectKey ?? args.next.latestManifestObjectKey ?? undefined,
          }
        : {}),
    });
  }
}

async function persistArchiveVerificationResult(args: {
  ctx: Pick<ActionCtx, 'runMutation'>;
  previous: AuditLedgerArchiveVerificationDoc | null;
  result: AuditArchiveVerificationResult;
}) {
  await args.ctx.runMutation(internal.audit.createAuditLedgerArchiveVerificationInternal, {
    chainId: 'primary',
    checkedAt: args.result.checkedAt,
    configured: args.result.configured,
    driftDetected: args.result.driftDetected,
    exporterEnabled: args.result.exporterEnabled,
    failureReason: args.result.failureReason,
    lagCount: args.result.lagCount,
    lastVerificationStatus: args.result.lastVerificationStatus,
    lastVerifiedSealEndSequence: args.result.lastVerifiedSealEndSequence,
    latestExportEndSequence: args.result.latestExportEndSequence,
    latestManifestObjectKey: args.result.latestManifestObjectKey,
    latestPayloadObjectKey: args.result.latestPayloadObjectKey,
    latestSealEndSequence: args.result.latestSealEndSequence,
    manifestSha256: args.result.manifestSha256,
    payloadSha256: args.result.payloadSha256,
    required: args.result.required,
  });
  await recordArchiveVerificationTransition({
    ctx: args.ctx,
    next: args.result,
    previous: args.previous,
  });
}

export const exportSealedAuditLedgerSegmentToImmutableStoreInternal = internalAction({
  args: {},
  returns: v.object({
    endSequence: v.union(v.number(), v.null()),
    exported: v.boolean(),
    reason: v.string(),
    startSequence: v.union(v.number(), v.null()),
  }),
  handler: async (ctx): Promise<AuditArchiveWorkerResult> => {
    const runtimeState = getArchiveRuntimeState();
    if (!runtimeState.exporterEnabled || !runtimeState.config?.bucket) {
      return {
        endSequence: null,
        exported: false,
        reason: 'disabled',
        startSequence: null,
      };
    }

    const [state, latestSeal, latestExport, latestVerification]: [
      AuditLedgerStateSnapshot | null,
      Doc<'auditLedgerSeals'> | null,
      Doc<'auditLedgerImmutableExports'> | null,
      AuditLedgerArchiveVerificationDoc | null,
    ] = await Promise.all([
      ctx.runQuery(internal.audit.getAuditLedgerStateInternal, {}),
      ctx.runQuery(internal.audit.getLatestAuditLedgerSealInternal, {}),
      ctx.runQuery(internal.audit.getLatestImmutableAuditExportInternal, {}),
      ctx.runQuery(internal.audit.getLatestAuditLedgerArchiveVerificationInternal, {}),
    ]);

    if (!latestSeal) {
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: false,
        exporterEnabled: true,
        lagCount: 0,
        latestSealVerified: true,
      });
      return {
        endSequence: null,
        exported: false,
        reason: 'no_seal',
        startSequence: null,
      };
    }

    if (latestExport && latestExport.endSequence >= latestSeal.endSequence) {
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: latestExport.headHash !== latestSeal.headHash,
        exporterEnabled: true,
        lagCount: Math.max(0, latestSeal.endSequence - latestExport.endSequence),
        latestSealVerified:
          latestVerification?.lastVerificationStatus === 'verified' &&
          latestVerification.lastVerifiedSealEndSequence === latestSeal.endSequence,
      });
      return {
        endSequence: latestExport.endSequence,
        exported: false,
        reason: 'already_exported',
        startSequence: latestExport.startSequence,
      };
    }

    const startSequence = (latestExport?.endSequence ?? 0) + 1;
    if (startSequence > latestSeal.endSequence) {
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: false,
        exporterEnabled: true,
        lagCount: 0,
        latestSealVerified:
          latestVerification?.lastVerificationStatus === 'verified' &&
          latestVerification.lastVerifiedSealEndSequence === latestSeal.endSequence,
      });
      return {
        endSequence: latestSeal.endSequence,
        exported: false,
        reason: 'already_exported',
        startSequence,
      };
    }

    const events = await collectEventsForRange(ctx, {
      endSequence: latestSeal.endSequence,
      startSequence,
    });
    if (events.length === 0) {
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: true,
        exporterEnabled: true,
        lagCount: Math.max(0, latestSeal.endSequence - (latestExport?.endSequence ?? 0)),
        latestSealVerified: false,
      });
      return {
        endSequence: latestSeal.endSequence,
        exported: false,
        reason: 'empty_range',
        startSequence,
      };
    }

    const baseKey = buildArchiveKey({
      chainId: latestSeal.chainId,
      endSequence: latestSeal.endSequence,
      headHash: latestSeal.headHash,
      prefix: runtimeState.config.prefix,
      startSequence,
    });
    const objectKey = `${baseKey}.jsonl.gz`;
    const manifestObjectKey = `${baseKey}.manifest.json`;
    const jsonl = events.map((event) => JSON.stringify(event)).join('\n');
    const payloadBytes = new Uint8Array(gzipSync(Buffer.from(jsonl, 'utf8')));
    const payloadSha256 = await sha256HexBytes(payloadBytes);
    const exportedAt = Date.now();
    const manifest = {
      bucket: runtimeState.config.bucket,
      chainId: latestSeal.chainId,
      chainVersion: state?.chainVersion ?? 1,
      contentEncoding: 'gzip',
      contentType: 'application/x-ndjson',
      endSequence: latestSeal.endSequence,
      eventCount: events.length,
      exportedAt,
      headHash: latestSeal.headHash,
      manifestObjectKey,
      objectKey,
      payloadSha256,
      sealedAt: latestSeal.sealedAt,
      startSequence,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestSha256 = await sha256HexBytes(manifestBytes);

    if (!(await objectExists(objectKey))) {
      await putAuditArchiveObject({
        body: payloadBytes,
        contentEncoding: 'gzip',
        contentType: 'application/x-ndjson',
        key: objectKey,
      });
    }

    if (!(await objectExists(manifestObjectKey))) {
      await putAuditArchiveObject({
        body: manifestBytes,
        contentType: 'application/json',
        key: manifestObjectKey,
      });
    }

    await ctx.runMutation(internal.audit.recordImmutableAuditExportInternal, {
      bucket: runtimeState.config.bucket,
      chainId: latestSeal.chainId,
      endSequence: latestSeal.endSequence,
      eventCount: events.length,
      exportedAt,
      headHash: latestSeal.headHash,
      manifestObjectKey,
      manifestSha256,
      objectKey,
      payloadSha256,
      sealedAt: latestSeal.sealedAt,
      startSequence,
    });

    await recordSystemAuditEvent(ctx, {
      emitter: 'audit.archive',
      eventType: 'audit_ledger_segment_archived',
      metadata: JSON.stringify({
        bucket: runtimeState.config.bucket,
        endSequence: latestSeal.endSequence,
        headHash: latestSeal.headHash ?? '',
        manifestSha256,
        objectKey,
        startSequence,
      }),
      outcome: 'success',
      resourceId: `${startSequence}-${latestSeal.endSequence}`,
      resourceLabel: objectKey,
      resourceType: 'audit_ledger_segment',
      severity: 'info',
      sourceSurface: 'audit.archive',
    });

    await publishArchiveMetrics({
      bucketName: runtimeState.config.bucket,
      driftDetected: false,
      exporterEnabled: true,
      lagCount: 0,
      latestSealVerified: false,
    });

    return {
      endSequence: latestSeal.endSequence,
      exported: true,
      reason: 'exported',
      startSequence,
    };
  },
});

export const verifyLatestSealedAuditLedgerSegmentInImmutableStoreInternal = internalAction({
  args: {},
  returns: v.object({
    checkedAt: v.number(),
    configured: v.boolean(),
    driftDetected: v.boolean(),
    exporterEnabled: v.boolean(),
    failureReason: v.union(v.string(), v.null()),
    lagCount: v.number(),
    lastVerificationStatus: archiveVerificationStatusValidator,
    lastVerifiedSealEndSequence: v.union(v.number(), v.null()),
    latestExportEndSequence: v.union(v.number(), v.null()),
    latestManifestObjectKey: v.union(v.string(), v.null()),
    latestPayloadObjectKey: v.union(v.string(), v.null()),
    latestSealEndSequence: v.union(v.number(), v.null()),
    manifestSha256: v.union(v.string(), v.null()),
    payloadSha256: v.union(v.string(), v.null()),
    required: v.boolean(),
  }),
  handler: async (ctx): Promise<AuditArchiveVerificationResult> => {
    const runtimeState = getArchiveRuntimeState();
    const checkedAt = Date.now();
    const [latestSeal, latestExport, previousVerification]: [
      Doc<'auditLedgerSeals'> | null,
      Doc<'auditLedgerImmutableExports'> | null,
      AuditLedgerArchiveVerificationDoc | null,
    ] = await Promise.all([
      ctx.runQuery(internal.audit.getLatestAuditLedgerSealInternal, {}),
      ctx.runQuery(internal.audit.getLatestImmutableAuditExportInternal, {}),
      ctx.runQuery(internal.audit.getLatestAuditLedgerArchiveVerificationInternal, {}),
    ]);

    if (!runtimeState.exporterEnabled || !runtimeState.config?.bucket) {
      const result: AuditArchiveVerificationResult = {
        checkedAt,
        configured: runtimeState.configured,
        driftDetected: false,
        exporterEnabled: false,
        failureReason: runtimeState.errorMessage,
        lagCount: latestSeal?.endSequence ?? 0,
        lastVerificationStatus: 'disabled',
        lastVerifiedSealEndSequence: null,
        latestExportEndSequence: latestExport?.endSequence ?? null,
        latestManifestObjectKey: latestExport?.manifestObjectKey ?? null,
        latestPayloadObjectKey: latestExport?.objectKey ?? null,
        latestSealEndSequence: latestSeal?.endSequence ?? null,
        manifestSha256: latestExport?.manifestSha256 ?? null,
        payloadSha256: latestExport?.payloadSha256 ?? null,
        required: runtimeState.required,
      };
      await persistArchiveVerificationResult({
        ctx,
        previous: previousVerification,
        result,
      });
      return result;
    }

    if (!latestSeal) {
      const result: AuditArchiveVerificationResult = {
        checkedAt,
        configured: true,
        driftDetected: false,
        exporterEnabled: true,
        failureReason: null,
        lagCount: 0,
        lastVerificationStatus: 'no_seal',
        lastVerifiedSealEndSequence: null,
        latestExportEndSequence: latestExport?.endSequence ?? null,
        latestManifestObjectKey: latestExport?.manifestObjectKey ?? null,
        latestPayloadObjectKey: latestExport?.objectKey ?? null,
        latestSealEndSequence: null,
        manifestSha256: latestExport?.manifestSha256 ?? null,
        payloadSha256: latestExport?.payloadSha256 ?? null,
        required: runtimeState.required,
      };
      await persistArchiveVerificationResult({
        ctx,
        previous: previousVerification,
        result,
      });
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: false,
        exporterEnabled: true,
        lagCount: 0,
        latestSealVerified: true,
      });
      return result;
    }

    const lagCount = Math.max(0, latestSeal.endSequence - (latestExport?.endSequence ?? 0));
    const driftDetected =
      !latestExport ||
      latestExport.endSequence < latestSeal.endSequence ||
      latestExport.headHash !== latestSeal.headHash;
    if (!latestExport || driftDetected) {
      const result: AuditArchiveVerificationResult = {
        checkedAt,
        configured: true,
        driftDetected,
        exporterEnabled: true,
        failureReason: !latestExport
          ? 'No immutable audit export exists for the latest seal.'
          : latestExport.headHash !== latestSeal.headHash
            ? 'Latest immutable audit export head hash does not match the latest seal.'
            : 'Latest immutable audit export does not yet cover the latest seal.',
        lagCount,
        lastVerificationStatus:
          latestExport?.headHash !== latestSeal.headHash ? 'hash_mismatch' : 'missing_object',
        lastVerifiedSealEndSequence: null,
        latestExportEndSequence: latestExport?.endSequence ?? null,
        latestManifestObjectKey: latestExport?.manifestObjectKey ?? null,
        latestPayloadObjectKey: latestExport?.objectKey ?? null,
        latestSealEndSequence: latestSeal.endSequence,
        manifestSha256: latestExport?.manifestSha256 ?? null,
        payloadSha256: latestExport?.payloadSha256 ?? null,
        required: runtimeState.required,
      };
      await persistArchiveVerificationResult({
        ctx,
        previous: previousVerification,
        result,
      });
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: result.driftDetected,
        exporterEnabled: true,
        lagCount,
        latestSealVerified: false,
      });
      return result;
    }

    try {
      await Promise.all([
        headAuditArchiveObject({ key: latestExport.objectKey }),
        headAuditArchiveObject({ key: latestExport.manifestObjectKey }),
      ]);
    } catch (error) {
      const result: AuditArchiveVerificationResult = {
        checkedAt,
        configured: true,
        driftDetected,
        exporterEnabled: true,
        failureReason: isMissingObjectError(error)
          ? 'Immutable audit archive object is missing from the configured bucket.'
          : error instanceof Error
            ? error.message
            : 'Immutable audit archive object lookup failed.',
        lagCount,
        lastVerificationStatus: 'missing_object',
        lastVerifiedSealEndSequence: null,
        latestExportEndSequence: latestExport.endSequence,
        latestManifestObjectKey: latestExport.manifestObjectKey,
        latestPayloadObjectKey: latestExport.objectKey,
        latestSealEndSequence: latestSeal.endSequence,
        manifestSha256: latestExport.manifestSha256,
        payloadSha256: latestExport.payloadSha256,
        required: runtimeState.required,
      };
      await persistArchiveVerificationResult({
        ctx,
        previous: previousVerification,
        result,
      });
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected,
        exporterEnabled: true,
        lagCount,
        latestSealVerified: false,
      });
      return result;
    }

    const [payloadBytes, manifestBytes] = await Promise.all([
      getAuditArchiveObjectBytes({ key: latestExport.objectKey }),
      getAuditArchiveObjectBytes({ key: latestExport.manifestObjectKey }),
    ]);
    const [payloadSha256, manifestSha256] = await Promise.all([
      sha256HexBytes(payloadBytes),
      sha256HexBytes(manifestBytes),
    ]);
    let manifest: AuditArchiveManifest | null = null;

    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as AuditArchiveManifest;
    } catch {
      manifest = null;
    }

    const hashesMatch =
      payloadSha256 === latestExport.payloadSha256 &&
      manifestSha256 === latestExport.manifestSha256;
    const manifestMatches =
      manifest !== null &&
      manifest.endSequence === latestExport.endSequence &&
      manifest.headHash === latestExport.headHash &&
      manifest.manifestObjectKey === latestExport.manifestObjectKey &&
      manifest.objectKey === latestExport.objectKey &&
      manifest.payloadSha256 === latestExport.payloadSha256 &&
      manifest.startSequence === latestExport.startSequence;

    if (!hashesMatch || !manifestMatches) {
      const result: AuditArchiveVerificationResult = {
        checkedAt,
        configured: true,
        driftDetected: true,
        exporterEnabled: true,
        failureReason: !hashesMatch
          ? 'Immutable audit archive payload or manifest hash does not match the recorded export row.'
          : 'Immutable audit archive manifest contents do not match the recorded export row.',
        lagCount,
        lastVerificationStatus: 'hash_mismatch',
        lastVerifiedSealEndSequence: null,
        latestExportEndSequence: latestExport.endSequence,
        latestManifestObjectKey: latestExport.manifestObjectKey,
        latestPayloadObjectKey: latestExport.objectKey,
        latestSealEndSequence: latestSeal.endSequence,
        manifestSha256,
        payloadSha256,
        required: runtimeState.required,
      };
      await persistArchiveVerificationResult({
        ctx,
        previous: previousVerification,
        result,
      });
      await publishArchiveMetrics({
        bucketName: runtimeState.config.bucket,
        driftDetected: true,
        exporterEnabled: true,
        lagCount,
        latestSealVerified: false,
      });
      return result;
    }

    const result: AuditArchiveVerificationResult = {
      checkedAt,
      configured: true,
      driftDetected: false,
      exporterEnabled: true,
      failureReason: null,
      lagCount,
      lastVerificationStatus: 'verified',
      lastVerifiedSealEndSequence: latestSeal.endSequence,
      latestExportEndSequence: latestExport.endSequence,
      latestManifestObjectKey: latestExport.manifestObjectKey,
      latestPayloadObjectKey: latestExport.objectKey,
      latestSealEndSequence: latestSeal.endSequence,
      manifestSha256,
      payloadSha256,
      required: runtimeState.required,
    };
    await persistArchiveVerificationResult({
      ctx,
      previous: previousVerification,
      result,
    });
    await publishArchiveMetrics({
      bucketName: runtimeState.config.bucket,
      driftDetected: false,
      exporterEnabled: true,
      lagCount,
      latestSealVerified: true,
    });
    return result;
  },
});
