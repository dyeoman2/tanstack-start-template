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
  buildPromotedStorageKey,
  deleteS3PrimaryObject,
  finalizeS3PrimaryUpload,
  generateS3PrimaryUploadTarget,
} from './storageS3Primary';
import { createDownloadPresignedStorageUrl } from './lib/storageS3';
import {
  deleteStorageObject,
  promoteQuarantineObject,
  putCleanObject,
} from './lib/storageS3Control';
import {
  type CreateUploadTargetArgs,
  type DeleteStoredFileArgs,
  type FinalizeUploadArgs,
  type InspectionStatus,
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
      sha256Hex: args.sha256Hex,
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
    fileSize: args.fileSize,
    inspectionStatus: args.backendMode === 's3-primary' ? 'PENDING' : undefined,
    malwareStatus: args.backendMode === 'convex' ? 'NOT_STARTED' : 'PENDING',
    mimeType: args.mimeType,
    mirrorStatus: args.backendMode === 's3-mirror' ? 'PENDING' : undefined,
    parentStorageId: args.parentStorageId,
    organizationId: args.organizationId,
    originalFileName: args.fileName,
    sha256Hex: args.sha256Hex,
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
    fallbackMimeType: string;
    key: string;
  },
) {
  const presigned = await createDownloadPresignedStorageUrl({
    bucketKind: 'clean',
    key: args.key,
  });
  const response = await fetch(presigned.url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch S3-backed file: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? args.fallbackMimeType;
  return new Blob([await response.arrayBuffer()], { type: contentType });
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

function resolveDerivedTrustState(args: {
  parentLifecycle: {
    malwareStatus?: MalwareStatus;
  };
  trustLevel: 'inherit_parent' | 'validated_clean';
}): {
  inspectionStatus?: InspectionStatus;
  malwareStatus: MalwareStatus;
} {
  if (args.trustLevel === 'validated_clean') {
    return {
      inspectionStatus: 'PASSED',
      malwareStatus: 'CLEAN',
    };
  }

  const inheritedMalwareStatus = resolveInheritedDerivedMalwareStatus(args.parentLifecycle);
  return {
    inspectionStatus: inheritedMalwareStatus === 'CLEAN' ? 'PASSED' : undefined,
    malwareStatus: inheritedMalwareStatus,
  };
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
    stagedQuarantineKey?: string;
    trustLevel?: 'inherit_parent' | 'validated_clean';
  },
) {
  const parentLifecycle = await resolveDerivedParentLifecycleOrThrow(ctx, args.parentStorageId);
  const backendMode = getFileStorageBackendMode();
  const trustState = resolveDerivedTrustState({
    parentLifecycle,
    trustLevel: args.trustLevel ?? 'inherit_parent',
  });

  if (backendMode === 's3-primary') {
    const runtimeConfig = getStorageRuntimeConfig();
    const bucket = runtimeConfig.storageBuckets.clean.bucket;
    if (!bucket) {
      throw new Error(
        'AWS_S3_CLEAN_BUCKET environment variable is required for S3-backed storage.',
      );
    }
    const storageId = crypto.randomUUID();
    const key = buildPromotedStorageKey({
      organizationId: args.organizationId,
      sourceType: args.sourceType,
      storageId,
    });
    const result =
      args.trustLevel === 'validated_clean' && args.stagedQuarantineKey
        ? await promoteQuarantineObject({
            contentType: args.mimeType,
            destinationKey: key,
            sourceKey: args.stagedQuarantineKey,
          })
        : await putCleanObject({
            body: new Uint8Array(await args.blob.arrayBuffer()),
            contentType: args.mimeType,
            key,
          });
    if (args.trustLevel === 'validated_clean' && args.stagedQuarantineKey) {
      await deleteStorageObject({
        bucketKind: 'quarantine',
        key: args.stagedQuarantineKey,
      });
    }
    await ctx.runMutation(internal.storageLifecycle.upsertLifecycleInternal, {
      backendMode,
      canonicalBucket: bucket,
      canonicalKey: key,
      canonicalVersionId: result.VersionId,
      fileSize: args.blob.size,
      inspectionStatus: trustState.inspectionStatus,
      malwareStatus: trustState.malwareStatus,
      mimeType: args.mimeType,
      organizationId: args.organizationId,
      originalFileName: args.fileName,
      parentStorageId: args.parentStorageId,
      sourceId: args.sourceId,
      sourceType: args.sourceType,
      storageId,
      storagePlacement: 'PROMOTED',
    });
    await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
      actionResult: 'success',
      details:
        args.trustLevel === 'validated_clean' ? 'validated_derived_promoted' : 'derived_finalized',
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
      inspectionStatus: trustState.inspectionStatus,
      malwareStatus: trustState.malwareStatus,
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
      details:
        args.trustLevel === 'validated_clean'
          ? 'validated_derived_mirror_pending'
          : 'derived_mirror_pending',
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
    inspectionStatus: trustState.inspectionStatus,
    malwareStatus: trustState.malwareStatus,
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
    details:
      args.trustLevel === 'validated_clean'
        ? 'validated_derived_convex_finalized'
        : 'derived_convex_finalized',
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
    sha256Hex: v.optional(v.string()),
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
