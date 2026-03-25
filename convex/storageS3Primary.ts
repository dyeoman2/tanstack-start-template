'use node';

import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { issueFileAccessUrlForCurrentUser } from './fileServing';
import { copyS3Object, createPresignedS3Url, deleteS3Object, headS3Object } from './lib/storageS3';
import type { FinalizeUploadArgs, ResolveFileUrlArgs, UploadTargetResult } from './storageTypes';

function toStoragePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function buildScopedStoragePath(args: {
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
  topLevelPrefix?: string;
}) {
  const scopePath = args.organizationId
    ? `org/${toStoragePathSegment(args.organizationId)}`
    : 'site-admin';
  const topLevelPrefix = args.topLevelPrefix ? `${toStoragePathSegment(args.topLevelPrefix)}/` : '';

  return `${topLevelPrefix}${scopePath}/${toStoragePathSegment(args.sourceType)}/${args.storageId}`;
}

export function buildDeterministicStorageKey(args: {
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
}) {
  return buildScopedStoragePath(args);
}

export function buildQuarantineStorageKey(args: {
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
}) {
  return buildScopedStoragePath({
    ...args,
    topLevelPrefix: 'quarantine',
  });
}

export function buildPromotedStorageKey(args: {
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
}) {
  return buildScopedStoragePath({
    ...args,
    topLevelPrefix: 'clean',
  });
}

export async function generateS3PrimaryUploadTarget(args: {
  contentType: string;
  fileName: string;
  fileSize: number;
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
}): Promise<UploadTargetResult> {
  const runtimeConfig = getStorageRuntimeConfig();
  const bucket = runtimeConfig.s3FilesBucket;
  if (!bucket) {
    throw new Error('AWS_S3_FILES_BUCKET environment variable is required for S3-backed storage.');
  }
  const quarantineKey = buildQuarantineStorageKey({
    organizationId: args.organizationId,
    sourceType: args.sourceType,
    storageId: args.storageId,
  });
  const presigned = await createPresignedS3Url({
    bucket,
    contentType: args.contentType,
    key: quarantineKey,
    method: 'PUT',
  });

  return {
    backend: 's3',
    expiresAt: presigned.expiresAt,
    storageId: args.storageId,
    uploadHeaders: {
      'Content-Type': args.contentType,
    },
    uploadMethod: 'PUT',
    uploadUrl: presigned.url,
  };
}

export async function finalizeS3PrimaryUpload(ctx: ActionCtx, args: FinalizeUploadArgs) {
  const runtimeConfig = getStorageRuntimeConfig();
  const bucket = runtimeConfig.s3FilesBucket;
  if (!bucket) {
    throw new Error('AWS_S3_FILES_BUCKET environment variable is required for S3-backed storage.');
  }

  const quarantineKey = buildQuarantineStorageKey({
    organizationId: args.organizationId,
    sourceType: args.sourceType,
    storageId: args.storageId,
  });
  const head = await headS3Object({ bucket, key: quarantineKey });

  await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
    backendMode: 's3-primary',
    fileSize: args.fileSize,
    malwareStatus: 'PENDING',
    mimeType: args.mimeType,
    mirrorDeadlineAt: Date.now() + runtimeConfig.malwareScanSlaMs,
    organizationId: args.organizationId,
    originalFileName: args.fileName,
    quarantineBucket: bucket,
    quarantineKey,
    quarantineVersionId: head.VersionId,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    storageId: args.storageId,
    storagePlacement: 'QUARANTINE',
  });
  await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
    actionResult: 'success',
    details: 's3_primary_finalized',
    eventType: 'finalized',
    storageId: args.storageId,
  });
}

export async function resolveS3PrimaryUrl(ctx: ActionCtx, args: ResolveFileUrlArgs) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });
  if (!lifecycle?.canonicalBucket || !lifecycle.canonicalKey) {
    return null;
  }

  const signedServeUrl = await issueFileAccessUrlForCurrentUser(ctx, {
    purpose: 'interactive_open',
    sourceSurface: 'storage.s3_primary_url',
    storageId: args.storageId,
  });
  return signedServeUrl.url;
}

export async function deleteS3PrimaryObject(ctx: ActionCtx, args: { storageId: string }) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });
  if (!lifecycle) {
    return;
  }

  if (lifecycle.canonicalBucket && lifecycle.canonicalKey) {
    await deleteS3Object({
      bucket: lifecycle.canonicalBucket,
      key: lifecycle.canonicalKey,
      versionId: lifecycle.canonicalVersionId,
    });
  }

  if (lifecycle.quarantineBucket && lifecycle.quarantineKey) {
    await deleteS3Object({
      bucket: lifecycle.quarantineBucket,
      key: lifecycle.quarantineKey,
      versionId: lifecycle.quarantineVersionId,
    });
  }
}

export async function promoteS3PrimaryObject(
  ctx: ActionCtx,
  args: { scannedAt: number; storageId: string },
) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });
  if (!lifecycle) {
    throw new Error(`Storage lifecycle row not found for storageId=${args.storageId}.`);
  }

  if (lifecycle.storagePlacement === 'PROMOTED' && lifecycle.malwareStatus === 'CLEAN') {
    return { promoted: false as const, reason: 'already_promoted' as const };
  }

  if (!lifecycle.quarantineBucket || !lifecycle.quarantineKey) {
    throw new Error('Stored file does not have a quarantine backing object.');
  }

  const promotedKey = buildPromotedStorageKey({
    organizationId: lifecycle.organizationId ?? null,
    sourceType: lifecycle.sourceType,
    storageId: lifecycle.storageId,
  });
  const copyResult = await copyS3Object({
    bucket: lifecycle.quarantineBucket,
    contentType: lifecycle.mimeType,
    destinationKey: promotedKey,
    sourceBucket: lifecycle.quarantineBucket,
    sourceKey: lifecycle.quarantineKey,
  });

  await ctx.runMutation(internal.storageLifecycle.markCleanInternal, {
    canonicalBucket: lifecycle.quarantineBucket,
    canonicalKey: promotedKey,
    canonicalVersionId: copyResult.VersionId ?? null,
    scannedAt: args.scannedAt,
    storageId: args.storageId,
    storagePlacement: 'PROMOTED',
  });

  await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
    actionResult: 'success',
    details: promotedKey,
    eventType: 's3_primary_promoted',
    storageId: args.storageId,
  });

  await deleteS3Object({
    bucket: lifecycle.quarantineBucket,
    key: lifecycle.quarantineKey,
    versionId: lifecycle.quarantineVersionId,
  });

  return { promoted: true as const, reason: 'ok' as const };
}
