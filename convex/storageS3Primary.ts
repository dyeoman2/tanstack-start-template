'use node';

import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { issueFileAccessUrlForCurrentUser } from './fileServing';
import { createPresignedS3Url, deleteS3Object, headS3Object } from './lib/storageS3';
import type { FinalizeUploadArgs, ResolveFileUrlArgs, UploadTargetResult } from './storageTypes';

function toStoragePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function buildDeterministicStorageKey(args: {
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
}) {
  const scopePrefix = args.organizationId
    ? `org/${toStoragePathSegment(args.organizationId)}`
    : 'site-admin';

  return `${scopePrefix}/${toStoragePathSegment(args.sourceType)}/${args.storageId}`;
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
  const key = buildDeterministicStorageKey({
    organizationId: args.organizationId,
    sourceType: args.sourceType,
    storageId: args.storageId,
  });
  const presigned = await createPresignedS3Url({
    bucket,
    contentType: args.contentType,
    key,
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

  const key = buildDeterministicStorageKey({
    organizationId: args.organizationId,
    sourceType: args.sourceType,
    storageId: args.storageId,
  });
  const head = await headS3Object({ bucket, key });

  await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
    backendMode: 's3-primary',
    canonicalBucket: bucket,
    canonicalKey: key,
    canonicalVersionId: head.VersionId,
    fileSize: args.fileSize,
    malwareStatus: 'PENDING',
    mimeType: args.mimeType,
    mirrorDeadlineAt: Date.now() + runtimeConfig.malwareScanSlaMs,
    organizationId: args.organizationId,
    originalFileName: args.fileName,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    storageId: args.storageId,
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
  if (!lifecycle?.canonicalBucket || !lifecycle.canonicalKey) {
    return;
  }

  await deleteS3Object({
    bucket: lifecycle.canonicalBucket,
    key: lifecycle.canonicalKey,
    versionId: lifecycle.canonicalVersionId,
  });
}
