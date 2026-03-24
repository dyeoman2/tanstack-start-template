'use node';

import { v } from 'convex/values';
import { getFileStorageBackendMode, getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { issueFileAccessUrlForCurrentUser } from './fileServing';
import { getStorageReadiness } from './storageReadiness';
import { deleteMirrorObject, finalizeS3MirrorUpload } from './storageS3Mirror';
import {
  buildDeterministicStorageKey,
  deleteS3PrimaryObject,
  finalizeS3PrimaryUpload,
  generateS3PrimaryUploadTarget,
} from './storageS3Primary';
import { getS3Object, putS3Object } from './lib/storageS3';
import {
  type CreateUploadTargetArgs,
  type DeleteStoredFileArgs,
  type FinalizeUploadArgs,
  fileUrlResultValidator,
  type MalwareStatus,
  type RegisterFileForLifecycleTrackingArgs,
  type ResolveFileUrlArgs,
  storageBackendModeValidator,
  uploadTargetResultValidator,
} from './storageTypes';

function asConvexStorageId(storageId: string) {
  return storageId as Id<'_storage'>;
}

function asStorageReader(storage: ActionCtx['storage']) {
  return storage as typeof storage & {
    get: (storageId: Id<'_storage'>) => Promise<Blob | null>;
    getUrl: (storageId: Id<'_storage'>) => Promise<string | null>;
  };
}

export async function createUploadTargetWithMode(ctx: ActionCtx, args: CreateUploadTargetArgs) {
  const backendMode = getFileStorageBackendMode();
  if (backendMode === 's3-primary') {
    const storageId = crypto.randomUUID();
    return await generateS3PrimaryUploadTarget({
      contentType: args.contentType,
      fileName: args.fileName,
      fileSize: args.fileSize,
      organizationId: args.organizationId,
      sourceType: args.sourceType,
      storageId,
    });
  }

  const uploadUrl = await ctx.storage.generateUploadUrl();
  return {
    backend: 'convex' as const,
    expiresAt: Date.now() + 60 * 60 * 1000,
    storageId: '',
    uploadMethod: 'POST' as const,
    uploadUrl,
  };
}

export async function registerFileForLifecycleTracking(
  ctx: ActionCtx,
  args: RegisterFileForLifecycleTrackingArgs,
) {
  await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
    backendMode: args.backendMode,
    canonicalBucket: args.backendMode === 's3-primary' ? undefined : undefined,
    canonicalKey:
      args.backendMode === 's3-primary'
        ? buildDeterministicStorageKey({
            organizationId: args.organizationId,
            sourceType: args.sourceType,
            storageId: args.storageId,
          })
        : undefined,
    fileSize: args.fileSize,
    malwareStatus: args.backendMode === 'convex' ? 'NOT_STARTED' : 'PENDING',
    mimeType: args.mimeType,
    mirrorStatus: args.backendMode === 's3-mirror' ? 'PENDING' : undefined,
    parentStorageId: args.parentStorageId,
    organizationId: args.organizationId,
    originalFileName: args.fileName,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    storageId: args.storageId,
  });
}

export async function finalizeUploadWithMode(ctx: ActionCtx, args: FinalizeUploadArgs) {
  await registerFileForLifecycleTracking(ctx, args);

  if (args.backendMode === 'convex') {
    await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
      actionResult: 'success',
      details: 'convex_finalized',
      eventType: 'finalized',
      storageId: args.storageId,
    });
    return;
  }

  if (args.backendMode === 's3-primary') {
    await finalizeS3PrimaryUpload(ctx, args);
    return;
  }

  await finalizeS3MirrorUpload(ctx, args);
}

async function loadS3ObjectBlob(
  _ctx: ActionCtx,
  args: {
    bucket: string;
    fallbackMimeType: string;
    key: string;
  },
) {
  const object = await getS3Object({
    bucket: args.bucket,
    key: args.key,
  });
  const body = object.Body;
  if (!body) {
    return null;
  }
  if (body instanceof Blob) {
    return body;
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const bytes = await (
      body as {
        transformToByteArray: () => Promise<Uint8Array>;
      }
    ).transformToByteArray();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy], { type: args.fallbackMimeType });
  }
  if (typeof body === 'object' && body !== null && 'transformToString' in body) {
    const text = await (body as { transformToString: () => Promise<string> }).transformToString();
    return new Blob([text], { type: args.fallbackMimeType });
  }
  return null;
}

export async function loadStoredFileBlobWithMode(
  ctx: ActionCtx,
  args: {
    fallbackMimeType?: string;
    storageId: string;
  },
): Promise<Blob> {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });

  if (!lifecycle) {
    throw new Error(`Storage lifecycle row not found for storageId=${args.storageId}.`);
  }

  const readiness = getStorageReadiness(lifecycle);
  if (!readiness.readable) {
    throw new Error(readiness.message ?? 'Stored file is not readable.');
  }

  if (lifecycle.backendMode === 'convex' || lifecycle.backendMode === 's3-mirror') {
    const blob = await asStorageReader(ctx.storage).get(asConvexStorageId(args.storageId));
    if (!blob) {
      throw new Error('Stored file was not found.');
    }
    return blob;
  }

  if (!lifecycle.canonicalBucket || !lifecycle.canonicalKey) {
    throw new Error('Stored file does not have an S3 backing object.');
  }

  const blob = await loadS3ObjectBlob(ctx, {
    bucket: lifecycle.canonicalBucket,
    fallbackMimeType: lifecycle.mimeType ?? args.fallbackMimeType ?? 'application/octet-stream',
    key: lifecycle.canonicalKey,
  });
  if (!blob) {
    throw new Error('Stored file was not found.');
  }
  return blob;
}

async function resolveDerivedParentLifecycleOrThrow(ctx: ActionCtx, parentStorageId: string) {
  const parentLifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: parentStorageId,
  });
  if (!parentLifecycle) {
    throw new Error(`Parent stored file not found for storageId=${parentStorageId}.`);
  }
  const readiness = getStorageReadiness(parentLifecycle);
  if (!readiness.readable) {
    throw new Error(readiness.message ?? 'Parent stored file is not readable.');
  }
  return parentLifecycle;
}

function resolveInheritedDerivedMalwareStatus(parentLifecycle: {
  malwareStatus?: MalwareStatus;
}): MalwareStatus {
  return parentLifecycle.malwareStatus === 'CLEAN' ? 'CLEAN' : 'NOT_STARTED';
}

export async function storeDerivedFileWithMode(
  ctx: ActionCtx,
  args: {
    blob: Blob;
    fileName: string;
    mimeType: string;
    organizationId?: string | null;
    parentStorageId: string;
    sourceId: string;
    sourceType: string;
  },
) {
  const parentLifecycle = await resolveDerivedParentLifecycleOrThrow(ctx, args.parentStorageId);
  const backendMode = getFileStorageBackendMode();
  const inheritedMalwareStatus = resolveInheritedDerivedMalwareStatus(parentLifecycle);

  if (backendMode === 's3-primary') {
    const runtimeConfig = getStorageRuntimeConfig();
    const bucket = runtimeConfig.s3FilesBucket;
    if (!bucket) {
      throw new Error(
        'AWS_S3_FILES_BUCKET environment variable is required for S3-backed storage.',
      );
    }
    const storageId = crypto.randomUUID();
    const key = buildDeterministicStorageKey({
      organizationId: args.organizationId,
      sourceType: args.sourceType,
      storageId,
    });
    const body = new Uint8Array(await args.blob.arrayBuffer());
    const result = await putS3Object({
      body,
      bucket,
      contentType: args.mimeType,
      key,
    });
    await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
      backendMode,
      canonicalBucket: bucket,
      canonicalKey: key,
      canonicalVersionId: result.VersionId,
      fileSize: args.blob.size,
      malwareStatus: inheritedMalwareStatus,
      mimeType: args.mimeType,
      organizationId: args.organizationId,
      originalFileName: args.fileName,
      parentStorageId: args.parentStorageId,
      sourceId: args.sourceId,
      sourceType: args.sourceType,
      storageId,
    });
    await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
      actionResult: 'success',
      details: 'derived_finalized',
      eventType: 'finalized',
      storageId,
    });
    return { storageId };
  }

  const storageId = (await ctx.storage.store(args.blob)) as string;
  if (backendMode === 's3-mirror') {
    const runtimeConfig = getStorageRuntimeConfig();
    await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
      backendMode,
      fileSize: args.blob.size,
      malwareStatus: inheritedMalwareStatus,
      mimeType: args.mimeType,
      mirrorDeadlineAt: Date.now() + runtimeConfig.malwareScanSlaMs,
      mirrorStatus: 'PENDING',
      organizationId: args.organizationId,
      originalFileName: args.fileName,
      parentStorageId: args.parentStorageId,
      sourceId: args.sourceId,
      sourceType: args.sourceType,
      storageId,
    });
    await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
      actionResult: 'success',
      details: 'derived_mirror_pending',
      eventType: 'finalized',
      storageId,
    });
    await ctx.scheduler.runAfter(0, internal.storageS3Mirror.runMirrorUploadInternal, {
      storageId,
    });
    return { storageId };
  }

  await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
    backendMode,
    fileSize: args.blob.size,
    malwareStatus: inheritedMalwareStatus,
    mimeType: args.mimeType,
    organizationId: args.organizationId,
    originalFileName: args.fileName,
    parentStorageId: args.parentStorageId,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    storageId,
  });
  await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
    actionResult: 'success',
    details: 'derived_convex_finalized',
    eventType: 'finalized',
    storageId,
  });
  return { storageId };
}

export async function resolveFileUrlWithMode(
  ctx: ActionCtx,
  args: ResolveFileUrlArgs,
): Promise<{ storageId: string; url: string | null }> {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });

  if (!lifecycle) {
    throw new Error(`Storage lifecycle row not found for storageId=${args.storageId}.`);
  }

  if (lifecycle.backendMode === 'convex') {
    const url = await ctx.storage.getUrl(asConvexStorageId(args.storageId));
    return { storageId: args.storageId, url };
  }

  const signedServeUrl = await issueFileAccessUrlForCurrentUser(ctx, {
    purpose: 'interactive_open',
    sourceSurface: 'storage.resolve_file_url',
    storageId: args.storageId,
  });

  return {
    storageId: args.storageId,
    url: signedServeUrl.url ?? null,
  };
}

export async function deleteStoredFileWithMode(ctx: ActionCtx, args: DeleteStoredFileArgs) {
  const children = await ctx.runQuery(internal.storageLifecycle.listByParentStorageIdInternal, {
    parentStorageId: args.storageId,
  });
  for (const child of children) {
    if (!child?.storageId || child.deletedAt) {
      continue;
    }
    await deleteStoredFileWithMode(ctx, {
      storageId: child.storageId,
    });
  }

  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });

  if (!lifecycle) {
    throw new Error(`Storage lifecycle row not found for storageId=${args.storageId}.`);
  }

  if (lifecycle.backendMode === 'convex') {
    await ctx.storage.delete(asConvexStorageId(args.storageId));
  } else if (lifecycle.backendMode === 's3-primary') {
    await deleteS3PrimaryObject(ctx, { storageId: args.storageId });
  } else {
    await ctx.storage.delete(asConvexStorageId(args.storageId));
    await deleteMirrorObject(ctx, { storageId: args.storageId });
  }

  await ctx.runMutation(internal.storageLifecycle.markDeletedInternal, {
    storageId: args.storageId,
  });
}

export const createUploadTarget = internalAction({
  args: {
    contentType: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    sourceId: v.optional(v.string()),
    organizationId: v.optional(v.union(v.string(), v.null())),
    sourceType: v.string(),
  },
  returns: uploadTargetResultValidator,
  handler: async (ctx, args) => {
    return await createUploadTargetWithMode(ctx, args);
  },
});

export const resolveFileUrl = internalAction({
  args: {
    storageId: v.string(),
  },
  returns: fileUrlResultValidator,
  handler: async (ctx, args): Promise<{ storageId: string; url: string | null }> => {
    return await resolveFileUrlWithMode(ctx, args);
  },
});

export const deleteStoredFileInternal = internalAction({
  args: {
    storageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteStoredFileWithMode(ctx, args);
    return null;
  },
});

export const finalizeUploadInternal = internalAction({
  args: {
    backendMode: storageBackendModeValidator,
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
    sourceId: v.string(),
    organizationId: v.optional(v.union(v.string(), v.null())),
    parentStorageId: v.optional(v.string()),
    sourceType: v.string(),
    storageId: v.string(),
    uploadedById: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await finalizeUploadWithMode(ctx, {
      ...args,
      uploadedById: undefined,
    });
    return null;
  },
});
