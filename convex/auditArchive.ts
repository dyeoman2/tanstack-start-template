'use node';

import { gzipSync } from 'node:zlib';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import { getAuditArchiveRuntimeConfig } from '../src/lib/server/env.server';
import type { AuthAuditEvent } from '../src/lib/shared/auth-audit';
import { isAuthAuditEventType } from '../src/lib/shared/auth-audit';
import { headAuditArchiveObject, putAuditArchiveObject } from './lib/auditArchiveS3';
import { recordSystemAuditEvent } from './lib/auditEmitters';

type AuditLedgerEventDoc = Doc<'auditLedgerEvents'>;
type AuditLedgerStateSnapshot = {
  chainId: string;
  chainVersion: number;
  headSequence: number;
  headEventHash: string | null;
  startedAt: number;
  updatedAt: number;
};
type AuditArchiveWorkerResult = {
  endSequence: number | null;
  exported: boolean;
  reason: string;
  startSequence: number | null;
};

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

async function objectExists(key: string) {
  try {
    await headAuditArchiveObject({ key });
    return true;
  } catch (error) {
    const statusCode =
      typeof error === 'object' && error !== null
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
    const name =
      typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
    if (statusCode === 404 || name === 'NotFound' || name === 'NoSuchKey') {
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

export const exportSealedAuditLedgerSegmentToImmutableStoreInternal = internalAction({
  args: {},
  returns: v.object({
    endSequence: v.union(v.number(), v.null()),
    exported: v.boolean(),
    reason: v.string(),
    startSequence: v.union(v.number(), v.null()),
  }),
  handler: async (ctx): Promise<AuditArchiveWorkerResult> => {
    const archiveConfig = getAuditArchiveRuntimeConfig();
    if (
      !archiveConfig.awsRegion ||
      !archiveConfig.bucket ||
      !archiveConfig.kmsKeyArn ||
      !archiveConfig.roleArn
    ) {
      return {
        endSequence: null,
        exported: false,
        reason: 'disabled',
        startSequence: null,
      };
    }

    const [state, latestSeal, latestExport]: [
      AuditLedgerStateSnapshot | null,
      Doc<'auditLedgerSeals'> | null,
      Doc<'auditLedgerImmutableExports'> | null,
    ] = await Promise.all([
      ctx.runQuery(internal.audit.getAuditLedgerStateInternal, {}),
      ctx.runQuery(internal.audit.getLatestAuditLedgerSealInternal, {}),
      ctx.runQuery(internal.audit.getLatestImmutableAuditExportInternal, {}),
    ]);

    if (!latestSeal) {
      return {
        endSequence: null,
        exported: false,
        reason: 'no_seal',
        startSequence: null,
      };
    }

    if (latestExport && latestExport.endSequence >= latestSeal.endSequence) {
      return {
        endSequence: latestExport.endSequence,
        exported: false,
        reason: 'already_exported',
        startSequence: latestExport.startSequence,
      };
    }

    const startSequence = (latestExport?.endSequence ?? 0) + 1;
    if (startSequence > latestSeal.endSequence) {
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
      prefix: archiveConfig.prefix,
      startSequence,
    });
    const objectKey = `${baseKey}.jsonl.gz`;
    const manifestObjectKey = `${baseKey}.manifest.json`;
    const jsonl = events.map((event) => JSON.stringify(event)).join('\n');
    const payloadBytes = new Uint8Array(gzipSync(Buffer.from(jsonl, 'utf8')));
    const payloadSha256 = await sha256HexBytes(payloadBytes);
    const exportedAt = Date.now();
    const manifest = {
      bucket: archiveConfig.bucket,
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
      bucket: archiveConfig.bucket,
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
        bucket: archiveConfig.bucket,
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

    return {
      endSequence: latestSeal.endSequence,
      exported: true,
      reason: 'exported',
      startSequence,
    };
  },
});
