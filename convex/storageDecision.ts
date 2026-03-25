'use node';

import { ConvexError, v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import {
  inspectStorageUploadBytes,
  resolveStorageInspectionPolicy,
} from '../src/lib/server/storage-inspection-policy';
import { parseStorageInspectionWebhookPayload as parseSharedStorageInspectionWebhookPayload } from '../src/lib/shared/storage-webhook-payload';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import {
  deleteStorageObject,
  getQuarantineObject,
  promoteQuarantineObject,
  rejectQuarantineObject,
} from './lib/storageS3';
import { buildPromotedStorageKey, buildRejectedStorageKey } from './storageS3Primary';

type LifecycleDoc = Doc<'storageLifecycle'>;

export const storageInspectionWebhookPayloadValidator = v.object({
  bucket: v.string(),
  key: v.string(),
});

export function parseStorageInspectionWebhookPayload(payload: string) {
  try {
    return parseSharedStorageInspectionWebhookPayload(payload);
  } catch (error) {
    throw new ConvexError(
      error instanceof Error ? error.message : 'Storage inspection webhook payload is malformed.',
    );
  }
}

async function readObjectBytes(args: { key: string }): Promise<Uint8Array | null> {
  const object = await getQuarantineObject({ key: args.key });
  const body = object.Body;
  if (!body) {
    return null;
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    return await (
      body as {
        transformToByteArray: () => Promise<Uint8Array>;
      }
    ).transformToByteArray();
  }
  if (typeof body === 'object' && body !== null && 'transformToWebStream' in body) {
    const stream = (
      body as { transformToWebStream: () => ReadableStream<Uint8Array> }
    ).transformToWebStream();
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      chunks.push(result.value);
      totalLength += result.value.byteLength;
    }
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }
  return null;
}

async function loadLifecycleByStorageId(
  ctx: Pick<ActionCtx, 'runQuery'>,
  storageId: string,
): Promise<LifecycleDoc | null> {
  return (await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId,
  })) as LifecycleDoc | null;
}

async function loadLifecycleByQuarantineKey(
  ctx: Pick<ActionCtx, 'runQuery'>,
  bucket: string,
  key: string,
): Promise<LifecycleDoc | null> {
  return (await ctx.runQuery(internal.storageLifecycle.getByQuarantineS3KeyInternal, {
    bucket,
    key,
  })) as LifecycleDoc | null;
}

function getRejectedReason(lifecycle: LifecycleDoc) {
  if (lifecycle.inspectionStatus === 'REJECTED') {
    return lifecycle.inspectionDetails ?? 'Attachment rejected during security review.';
  }
  if (lifecycle.inspectionStatus === 'FAILED') {
    return lifecycle.inspectionDetails ?? 'Attachment blocked because security inspection failed.';
  }
  if (lifecycle.malwareStatus === 'INFECTED') {
    return 'Attachment blocked by GuardDuty malware finding.';
  }
  if (lifecycle.malwareStatus === 'QUARANTINED_UNSCANNED') {
    return 'Attachment quarantined because malware scan SLA elapsed.';
  }
  return 'Attachment blocked during security review.';
}

async function triggerPendingConsumers(ctx: ActionCtx, storageId: string) {
  await ctx.runAction(internal.agentChatActions.processPendingChatAttachmentInternal, {
    storageId,
  });
  await ctx.runAction(internal.pdfParseActions.processPendingPdfParseJobInternal, {
    storageId,
  });
}

async function promoteCleanObject(ctx: ActionCtx, lifecycle: LifecycleDoc) {
  if (!lifecycle.quarantineBucket || !lifecycle.quarantineKey) {
    return { applied: false, reason: 'missing_quarantine_object' as const };
  }

  const runtimeConfig = getStorageRuntimeConfig();
  const cleanBucket = runtimeConfig.storageBuckets.clean.bucket;
  if (!cleanBucket) {
    throw new ConvexError('AWS_S3_CLEAN_BUCKET environment variable is required for promotion.');
  }

  const promotedKey = buildPromotedStorageKey({
    organizationId: lifecycle.organizationId ?? null,
    sourceType: lifecycle.sourceType,
    storageId: lifecycle.storageId,
  });
  if (
    lifecycle.storagePlacement === 'PROMOTED' &&
    lifecycle.canonicalBucket === cleanBucket &&
    lifecycle.canonicalKey === promotedKey
  ) {
    return { applied: false, reason: 'already_promoted' as const };
  }

  const result = await promoteQuarantineObject({
    contentType: lifecycle.mimeType ?? undefined,
    destinationKey: promotedKey,
    sourceKey: lifecycle.quarantineKey,
  });
  await deleteStorageObject({
    bucketKind: 'quarantine',
    key: lifecycle.quarantineKey,
    versionId: lifecycle.quarantineVersionId,
  });

  await ctx.runMutation(internal.storageLifecycle.markCleanInternal, {
    canonicalBucket: cleanBucket,
    canonicalKey: promotedKey,
    canonicalVersionId: result.VersionId ?? null,
    scannedAt: Math.max(
      lifecycle.inspectionScannedAt ?? 0,
      lifecycle.malwareScannedAt ?? 0,
      Date.now(),
    ),
    storageId: lifecycle.storageId,
    storagePlacement: 'PROMOTED',
  });
  await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
    actionResult: 'success',
    details: promotedKey,
    eventType: 's3_primary_promoted',
    storageId: lifecycle.storageId,
  });
  await triggerPendingConsumers(ctx, lifecycle.storageId);

  return { applied: true, reason: 'promoted' as const };
}

async function moveToRejected(ctx: ActionCtx, lifecycle: LifecycleDoc) {
  const bucket = lifecycle.quarantineBucket ?? lifecycle.rejectedBucket;
  if (!bucket) {
    return { applied: false, reason: 'missing_bucket' as const };
  }

  const rejectedKey = buildRejectedStorageKey({
    organizationId: lifecycle.organizationId ?? null,
    sourceType: lifecycle.sourceType,
    storageId: lifecycle.storageId,
  });
  if (
    lifecycle.storagePlacement === 'REJECTED' &&
    lifecycle.rejectedBucket === bucket &&
    lifecycle.rejectedKey === rejectedKey
  ) {
    return { applied: false, reason: 'already_rejected' as const };
  }

  let versionId: string | null | undefined = lifecycle.rejectedVersionId;
  if (lifecycle.quarantineBucket && lifecycle.quarantineKey) {
    const copied = await rejectQuarantineObject({
      contentType: lifecycle.mimeType ?? undefined,
      destinationKey: rejectedKey,
      sourceKey: lifecycle.quarantineKey,
    });
    versionId = copied.VersionId ?? null;
    await deleteStorageObject({
      bucketKind: 'quarantine',
      key: lifecycle.quarantineKey,
      versionId: lifecycle.quarantineVersionId,
    });
  }

  await ctx.runMutation(internal.storageLifecycle.markRejectedInternal, {
    rejectedBucket: bucket,
    rejectedKey,
    rejectedVersionId: versionId ?? null,
    storageId: lifecycle.storageId,
  });
  if (lifecycle.sourceType === 'chat_attachment') {
    await ctx.runMutation(internal.agentChat.quarantineAttachmentByStorageIdInternal, {
      reason: getRejectedReason(lifecycle),
      storageId: lifecycle.storageId,
    });
  }
  await ctx.runAction(internal.pdfParseActions.processPendingPdfParseJobInternal, {
    storageId: lifecycle.storageId,
  });

  return { applied: true, reason: 'rejected' as const };
}

export async function tryFinalizeStorageDecision(ctx: ActionCtx, args: { storageId: string }) {
  const lifecycle = await loadLifecycleByStorageId(ctx, args.storageId);
  if (!lifecycle) {
    return { applied: false, reason: 'missing_lifecycle' as const };
  }
  if (lifecycle.backendMode !== 's3-primary') {
    return { applied: false, reason: 'unsupported_backend' as const };
  }

  const inspectionRejected =
    lifecycle.inspectionStatus === 'REJECTED' || lifecycle.inspectionStatus === 'FAILED';
  const malwareRejected =
    lifecycle.malwareStatus === 'INFECTED' || lifecycle.malwareStatus === 'QUARANTINED_UNSCANNED';

  if (inspectionRejected || malwareRejected) {
    return await moveToRejected(ctx, lifecycle);
  }

  if (lifecycle.inspectionStatus === 'PASSED' && lifecycle.malwareStatus === 'CLEAN') {
    return await promoteCleanObject(ctx, lifecycle);
  }

  return { applied: false, reason: 'awaiting_verdicts' as const };
}

async function inspectLifecycle(ctx: ActionCtx, lifecycle: LifecycleDoc) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!lifecycle.quarantineBucket || !lifecycle.quarantineKey) {
    return { applied: false, reason: 'missing_quarantine_object' as const };
  }
  if (
    runtimeConfig.storageBuckets.quarantine.bucket &&
    lifecycle.quarantineBucket !== runtimeConfig.storageBuckets.quarantine.bucket
  ) {
    return { applied: false, reason: 'wrong_bucket' as const };
  }
  if (
    lifecycle.inspectionStatus === 'PASSED' ||
    lifecycle.inspectionStatus === 'REJECTED' ||
    lifecycle.inspectionStatus === 'FAILED'
  ) {
    return { applied: false, reason: 'already_inspected' as const };
  }

  const bytes = await readObjectBytes({
    key: lifecycle.quarantineKey,
  });
  if (!bytes) {
    await ctx.runMutation(internal.storageLifecycle.markInspectionFailedInternal, {
      details: 'Uploaded file was not found in S3 quarantine storage.',
      engine: 's3-intake-policy',
      scannedAt: Date.now(),
      storageId: lifecycle.storageId,
    });
    await tryFinalizeStorageDecision(ctx, { storageId: lifecycle.storageId });
    return { applied: false, reason: 'missing_object' as const };
  }

  const policy = resolveStorageInspectionPolicy({
    defaultMaxBytes: runtimeConfig.fileUploadMaxBytes,
    sourceType: lifecycle.sourceType,
  });
  const result = await inspectStorageUploadBytes({
    allowedKinds: policy.allowedKinds,
    bytes,
    fileName: lifecycle.originalFileName,
    maxBytes: policy.maxBytes,
    mimeType: lifecycle.mimeType ?? 'application/octet-stream',
    sha256Hex: lifecycle.sha256Hex ?? undefined,
  });

  if (result.status === 'PASSED') {
    await ctx.runMutation(internal.storageLifecycle.markInspectionPassedInternal, {
      details: result.details ?? null,
      engine: result.engine,
      scannedAt: result.inspectedAt,
      storageId: lifecycle.storageId,
    });
  } else if (result.status === 'REJECTED') {
    await ctx.runMutation(internal.storageLifecycle.markInspectionRejectedInternal, {
      details: result.details ?? null,
      engine: result.engine,
      reason: result.reason ?? 'inspection_error',
      scannedAt: result.inspectedAt,
      storageId: lifecycle.storageId,
    });
  } else {
    await ctx.runMutation(internal.storageLifecycle.markInspectionFailedInternal, {
      details: result.details ?? null,
      engine: result.engine,
      scannedAt: result.inspectedAt,
      storageId: lifecycle.storageId,
    });
  }

  await tryFinalizeStorageDecision(ctx, { storageId: lifecycle.storageId });
  return { applied: true, reason: result.status.toLowerCase() as 'failed' | 'passed' | 'rejected' };
}

export async function applyStorageInspectionRequest(
  ctx: ActionCtx,
  args: { bucket: string; key: string },
) {
  const lifecycle = await loadLifecycleByQuarantineKey(ctx, args.bucket, args.key);
  if (!lifecycle) {
    return { applied: false, reason: 'missing_lifecycle' as const };
  }

  return await inspectLifecycle(ctx, lifecycle);
}

export const inspectQuarantineObjectByStorageIdInternal = internalAction({
  args: {
    storageId: v.string(),
  },
  returns: v.object({
    applied: v.boolean(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    const lifecycle = await loadLifecycleByStorageId(ctx, args.storageId);
    if (!lifecycle) {
      return { applied: false, reason: 'missing_lifecycle' };
    }
    return await inspectLifecycle(ctx, lifecycle);
  },
});

export const tryFinalizeStorageDecisionInternal = internalAction({
  args: {
    storageId: v.string(),
  },
  returns: v.object({
    applied: v.boolean(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    return await tryFinalizeStorageDecision(ctx, args);
  },
});
