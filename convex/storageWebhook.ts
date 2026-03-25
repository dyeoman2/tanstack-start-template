'use node';

import { ConvexError, v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { parseGuardDutyWebhookPayload as parseSharedGuardDutyWebhookPayload } from '../src/lib/shared/storage-webhook-payload';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { tryFinalizeStorageDecision } from './storageDecision';

export const guardDutyFindingPayloadValidator = v.object({
  type: v.literal('guardduty_finding'),
  bucket: v.string(),
  findingId: v.string(),
  key: v.string(),
  scannedAt: v.number(),
  status: v.union(v.literal('CLEAN'), v.literal('INFECTED')),
  versionId: v.optional(v.string()),
});

export const guardDutyPromotionResultPayloadValidator = v.object({
  type: v.literal('promotion_result'),
  bucket: v.string(),
  failureReason: v.optional(v.string()),
  findingId: v.string(),
  promotedBucket: v.optional(v.string()),
  promotedKey: v.optional(v.string()),
  promotedVersionId: v.optional(v.string()),
  quarantineKey: v.string(),
  scannedAt: v.number(),
  status: v.union(v.literal('PROMOTED'), v.literal('PROMOTION_FAILED')),
});

export const guardDutyWebhookPayloadValidator = v.union(
  guardDutyFindingPayloadValidator,
  guardDutyPromotionResultPayloadValidator,
);

export function parseGuardDutyWebhookPayload(payload: string) {
  try {
    return parseSharedGuardDutyWebhookPayload(payload);
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : 'Webhook payload is malformed.');
  }
}

export async function applyGuardDutyFinding(
  ctx: ActionCtx,
  args: {
    bucket: string;
    findingId: string;
    key: string;
    scannedAt: number;
    status: 'CLEAN' | 'INFECTED';
  },
) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (
    runtimeConfig.storageBuckets.quarantine.bucket &&
    args.bucket !== runtimeConfig.storageBuckets.quarantine.bucket
  ) {
    return { applied: false, reason: 'wrong_bucket' as const };
  }

  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByAnyS3KeyInternal, {
    bucket: args.bucket,
    key: args.key,
  });
  if (!lifecycle) {
    return { applied: false, reason: 'missing_lifecycle' as const };
  }

  if (
    lifecycle.malwareFindingId === args.findingId ||
    (args.status === 'CLEAN' && lifecycle.malwareStatus === 'CLEAN') ||
    (args.status === 'INFECTED' && lifecycle.malwareStatus === 'INFECTED')
  ) {
    return { applied: false, reason: 'duplicate_finding' as const };
  }

  if (args.status === 'CLEAN') {
    await ctx.runMutation(internal.storageLifecycle.markCleanInternal, {
      scannedAt: args.scannedAt,
      storageId: lifecycle.storageId,
    });
    if (lifecycle.backendMode === 's3-primary') {
      await tryFinalizeStorageDecision(ctx, { storageId: lifecycle.storageId });
    } else {
      await ctx.runAction(internal.agentChatActions.processPendingChatAttachmentInternal, {
        storageId: lifecycle.storageId,
      });
      await ctx.runAction(internal.pdfParseActions.processPendingPdfParseJobInternal, {
        storageId: lifecycle.storageId,
      });
    }
  } else {
    await ctx.runMutation(internal.storageLifecycle.markInfectedInternal, {
      findingId: args.findingId,
      scannedAt: args.scannedAt,
      storageId: lifecycle.storageId,
    });
    await ctx.runMutation(internal.agentChat.quarantineAttachmentByStorageIdInternal, {
      reason: 'Attachment blocked by GuardDuty malware finding.',
      storageId: lifecycle.storageId,
    });
    if (lifecycle.backendMode === 's3-primary') {
      await tryFinalizeStorageDecision(ctx, { storageId: lifecycle.storageId });
    } else {
      await ctx.runAction(internal.pdfParseActions.processPendingPdfParseJobInternal, {
        storageId: lifecycle.storageId,
      });
    }
  }

  return { applied: true, reason: 'ok' as const };
}

export async function applyGuardDutyPromotionResult(
  ctx: ActionCtx,
  args: {
    bucket: string;
    failureReason?: string;
    findingId: string;
    promotedBucket?: string;
    promotedKey?: string;
    promotedVersionId?: string;
    quarantineKey: string;
    scannedAt: number;
    status: 'PROMOTED' | 'PROMOTION_FAILED';
  },
) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (
    runtimeConfig.storageBuckets.quarantine.bucket &&
    args.bucket !== runtimeConfig.storageBuckets.quarantine.bucket
  ) {
    return { applied: false, reason: 'wrong_bucket' as const };
  }

  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByQuarantineS3KeyInternal, {
    bucket: args.bucket,
    key: args.quarantineKey,
  });
  if (!lifecycle) {
    return { applied: false, reason: 'missing_lifecycle' as const };
  }

  if (args.status === 'PROMOTION_FAILED') {
    await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
      actionResult: 'failure',
      details: args.failureReason ?? 'promotion_failed',
      eventType: 's3_primary_promotion_failed',
      storageId: lifecycle.storageId,
    });
    return { applied: false, reason: 'promotion_failed' as const };
  }

  if (!args.promotedBucket || !args.promotedKey) {
    throw new ConvexError('Promotion result is missing the promoted object location.');
  }

  if (
    lifecycle.storagePlacement === 'PROMOTED' &&
    lifecycle.malwareStatus === 'CLEAN' &&
    lifecycle.canonicalBucket === args.promotedBucket &&
    lifecycle.canonicalKey === args.promotedKey &&
    (lifecycle.canonicalVersionId ?? null) === (args.promotedVersionId ?? null)
  ) {
    return { applied: false, reason: 'already_promoted' as const };
  }

  await ctx.runMutation(internal.storageLifecycle.markCleanInternal, {
    canonicalBucket: args.promotedBucket,
    canonicalKey: args.promotedKey,
    canonicalVersionId: args.promotedVersionId ?? null,
    scannedAt: args.scannedAt,
    storageId: lifecycle.storageId,
    storagePlacement: 'PROMOTED',
  });
  await ctx.runMutation(internal.storageLifecycle.appendLifecycleEventInternal, {
    actionResult: 'success',
    details: args.promotedKey,
    eventType: 's3_primary_promoted',
    storageId: lifecycle.storageId,
  });
  await ctx.runAction(internal.agentChatActions.processPendingChatAttachmentInternal, {
    storageId: lifecycle.storageId,
  });
  await ctx.runAction(internal.pdfParseActions.processPendingPdfParseJobInternal, {
    storageId: lifecycle.storageId,
  });

  return { applied: true, reason: 'ok' as const };
}

export const applyGuardDutyFindingInternal = internalAction({
  args: guardDutyFindingPayloadValidator,
  returns: v.object({
    applied: v.boolean(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    return await applyGuardDutyFinding(ctx, args);
  },
});

export const applyGuardDutyPromotionResultInternal = internalAction({
  args: guardDutyPromotionResultPayloadValidator,
  returns: v.object({
    applied: v.boolean(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    return await applyGuardDutyPromotionResult(ctx, args);
  },
});
