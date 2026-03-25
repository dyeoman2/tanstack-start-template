'use node';

import { v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { reconcileOrphanedMirrorObjects } from './storageS3Mirror';

async function deleteStaleUpload(ctx: ActionCtx, storageId: string) {
  await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
    storageId,
  });
}

export const cleanupStaleUploadsInternal = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const runtimeConfig = getStorageRuntimeConfig();
    const cutoff = Date.now() - runtimeConfig.storageStaleUploadTtlMs;
    const staleTokens = await ctx.runQuery(
      internal.agentChat.listExpiredAttachmentUploadTokensInternal,
      {
        cutoff,
      },
    );

    for (const token of staleTokens) {
      await deleteStaleUpload(ctx, token.storageId);
      await ctx.runMutation(internal.agentChat.deleteAttachmentUploadTokenInternal, {
        tokenId: token._id,
      });
    }

    const staleEvidenceUploads = await ctx.runQuery(
      internal.storageCleanupData.listStaleEvidenceUploadsInternal,
      {
        cutoff,
      },
    );

    for (const upload of staleEvidenceUploads) {
      await deleteStaleUpload(ctx, upload.storageId);
    }

    return null;
  },
});

export const enforceMalwareDeadlinesInternal = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.runQuery(
      internal.storageLifecycle.listExpiredLifecycleByDeadlineInternal,
      {
        now: Date.now(),
      },
    );
    for (const row of rows) {
      if (row.deletedAt || row.malwareStatus === 'CLEAN' || row.malwareStatus === 'INFECTED') {
        continue;
      }
      await ctx.runMutation(internal.storageLifecycle.markDeadlineMissedInternal, {
        storageId: row.storageId,
      });
      await ctx.runAction(internal.storageDecision.tryFinalizeStorageDecisionInternal, {
        storageId: row.storageId,
      });
    }
    return null;
  },
});

export const reconcileOrphanedMirrorObjectsInternal = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await reconcileOrphanedMirrorObjects(ctx);
    return null;
  },
});
