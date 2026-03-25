'use node';

import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { issueFileAccessUrlForCurrentUser } from './fileServing';
import { createPresignedS3Url, deleteS3Object } from './lib/storageS3';
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

export function buildMirroredStorageKey(args: {
  organizationId?: string | null;
  sourceType: string;
  storageId: string;
}) {
  return buildScopedStoragePath(args);
}

function hexSha256ToBase64(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error('Expected a lowercase SHA-256 hex digest.');
  }
  return Buffer.from(normalized, 'hex').toString('base64');
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
  sha256Hex?: string;
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
  const checksumHeader = args.sha256Hex
    ? {
        'x-amz-checksum-sha256': hexSha256ToBase64(args.sha256Hex),
      }
    : undefined;
  const presigned = await createPresignedS3Url({
    bucket,
    contentType: args.contentType,
    headers: checksumHeader,
    key: quarantineKey,
    method: 'PUT',
  });

  return {
    backend: 's3',
    expiresAt: presigned.expiresAt,
    storageId: args.storageId,
    uploadHeaders: {
      'Content-Type': args.contentType,
      ...checksumHeader,
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
