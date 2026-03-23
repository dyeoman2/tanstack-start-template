'use node';

import { v } from 'convex/values';
import { getFileStorageBackendMode } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { deleteMirrorObject, finalizeS3MirrorUpload } from './storageS3Mirror';
import {
  buildDeterministicStorageKey,
  deleteS3PrimaryObject,
  finalizeS3PrimaryUpload,
  generateS3PrimaryUploadTarget,
} from './storageS3Primary';
import {
  type CreateUploadTargetArgs,
  type DeleteStoredFileArgs,
  type FinalizeUploadArgs,
  fileUrlResultValidator,
  type RegisterFileForLifecycleTrackingArgs,
  type ResolveFileUrlArgs,
  storageBackendModeValidator,
  uploadTargetResultValidator,
} from './storageTypes';

function asConvexStorageId(storageId: string) {
  return storageId as Id<'_storage'>;
}

export async function createUploadTargetWithMode(ctx: ActionCtx, args: CreateUploadTargetArgs) {
  const backendMode = getFileStorageBackendMode();
  if (backendMode === 's3-primary') {
    const storageId = crypto.randomUUID();
    return await generateS3PrimaryUploadTarget({
      contentType: args.contentType,
      fileName: args.fileName,
      fileSize: args.fileSize,
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
      args.backendMode === 's3-primary' ? buildDeterministicStorageKey(args.storageId) : undefined,
    fileSize: args.fileSize,
    malwareStatus: args.backendMode === 'convex' ? 'NOT_STARTED' : 'PENDING',
    mimeType: args.mimeType,
    mirrorStatus: args.backendMode === 's3-mirror' ? 'PENDING' : undefined,
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

export async function resolveFileUrlWithMode(
  ctx: ActionCtx,
  args: ResolveFileUrlArgs,
): Promise<{ storageId: string; url: string | null }> {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });

  if (!lifecycle) {
    return { storageId: args.storageId, url: null };
  }

  if (lifecycle.backendMode === 'convex') {
    const url = await ctx.storage.getUrl(asConvexStorageId(args.storageId));
    return { storageId: args.storageId, url };
  }

  const signedServeUrl: { storageId: string; url: string | null } = await ctx.runAction(
    internal.fileServing.createSignedServeUrlInternal,
    {
      storageId: args.storageId,
    },
  );

  return {
    storageId: args.storageId,
    url: signedServeUrl.url,
  };
}

export async function deleteStoredFileWithMode(ctx: ActionCtx, args: DeleteStoredFileArgs) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });

  if (!lifecycle) {
    return;
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
