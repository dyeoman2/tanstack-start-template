'use node';

import { ConvexError, v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { deleteS3Object, listS3Objects, putS3Object } from './lib/storageS3';
import { buildDeterministicStorageKey } from './storageS3Primary';
import type { FinalizeUploadArgs } from './storageTypes';

function asConvexStorageId(storageId: string) {
  return storageId as Id<'_storage'>;
}

function toUint8Array(buffer: ArrayBuffer) {
  return new Uint8Array(buffer);
}

export async function finalizeS3MirrorUpload(ctx: ActionCtx, args: FinalizeUploadArgs) {
  const runtimeConfig = getStorageRuntimeConfig();
  await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
    backendMode: 's3-mirror',
    fileSize: args.fileSize,
    malwareStatus: 'PENDING',
    mimeType: args.mimeType,
    mirrorDeadlineAt: Date.now() + runtimeConfig.malwareScanSlaMs,
    mirrorStatus: 'PENDING',
    originalFileName: args.fileName,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    storageId: args.storageId,
  });
  await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
    actionResult: 'success',
    details: 'mirror_pending',
    eventType: 'finalized',
    storageId: args.storageId,
  });
  await ctx.scheduler.runAfter(0, internal.storageS3Mirror.runMirrorUploadInternal, {
    storageId: args.storageId,
  });
}

export async function mirrorConvexFileToS3(ctx: ActionCtx, args: { storageId: string }) {
  const runtimeConfig = getStorageRuntimeConfig();
  const bucket = runtimeConfig.s3FilesBucket;
  if (!bucket) {
    throw new Error('AWS_S3_FILES_BUCKET environment variable is required for mirrored storage.');
  }

  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });
  if (!lifecycle) {
    throw new ConvexError(`Lifecycle row not found for storageId=${args.storageId}.`);
  }

  const blob = await ctx.storage.get(asConvexStorageId(args.storageId));
  if (!blob) {
    throw new ConvexError(`Convex blob not found for storageId=${args.storageId}.`);
  }

  const key = buildDeterministicStorageKey(args.storageId);
  const content = toUint8Array(await blob.arrayBuffer());
  const result = await putS3Object({
    body: content,
    bucket,
    contentType: blob.type || lifecycle.mimeType || 'application/octet-stream',
    key,
  });

  await ctx.runMutation(internal.storageLifecycle.markMirrorSuccessInternal, {
    bucket,
    key,
    storageId: args.storageId,
    versionId: result.VersionId,
  });
  await ctx.runAction(internal.agentChatActions.processPendingChatAttachmentInternal, {
    storageId: args.storageId,
  });
  await ctx.runAction(internal.pdfParseActions.processPendingPdfParseJobInternal, {
    storageId: args.storageId,
  });
}

export async function scheduleMirrorRetry(
  ctx: ActionCtx,
  args: { attempt: number; errorMessage: string; storageId: string },
) {
  const runtimeConfig = getStorageRuntimeConfig();
  const delayMs = Math.min(
    runtimeConfig.mirrorRetryBaseDelayMs * 2 ** Math.max(0, args.attempt - 1),
    runtimeConfig.mirrorRetryMaxDelayMs,
  );
  const nextAttemptAt = Date.now() + delayMs;
  await ctx.runMutation(internal.storageLifecycle.markMirrorFailureInternal, {
    details: args.errorMessage,
    nextAttemptAt,
    storageId: args.storageId,
  });
  await ctx.scheduler.runAfter(delayMs, internal.storageS3Mirror.runMirrorUploadInternal, {
    storageId: args.storageId,
  });
}

export async function deleteMirrorObject(ctx: ActionCtx, args: { storageId: string }) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });
  if (!lifecycle?.mirrorBucket || !lifecycle.mirrorKey) {
    return;
  }

  await deleteS3Object({
    bucket: lifecycle.mirrorBucket,
    key: lifecycle.mirrorKey,
    versionId: lifecycle.mirrorVersionId,
  });
}

export async function reconcileOrphanedMirrorObjects(ctx: ActionCtx) {
  const runtimeConfig = getStorageRuntimeConfig();
  const bucket = runtimeConfig.s3FilesBucket;
  if (!bucket) {
    return;
  }

  const listed = await listS3Objects({
    bucket,
    maxKeys: runtimeConfig.s3OrphanCleanupMaxScan,
    prefix: 'team/global/storage/',
  });
  const contents = listed.Contents ?? [];
  const cutoff = Date.now() - runtimeConfig.s3OrphanCleanupMinAgeMs;

  for (const object of contents) {
    if (!object.Key || !object.LastModified || object.LastModified.getTime() > cutoff) {
      continue;
    }

    const keyParts = object.Key.split('/');
    const storageId = keyParts[keyParts.length - 1];
    if (!storageId) {
      continue;
    }

    const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
      storageId,
    });
    if (!lifecycle || lifecycle.deletedAt) {
      await deleteS3Object({ bucket, key: object.Key });
    }
  }
}

export const runMirrorUploadInternal = internalAction({
  args: { storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
      storageId: args.storageId,
    });
    const attempt = (lifecycle?.mirrorAttempts ?? 0) + 1;

    try {
      await mirrorConvexFileToS3(ctx, args);
    } catch (error) {
      await scheduleMirrorRetry(ctx, {
        attempt,
        errorMessage: error instanceof Error ? error.message : 'Mirror upload failed.',
        storageId: args.storageId,
      });
    }

    return null;
  },
});
