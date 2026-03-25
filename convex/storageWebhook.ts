'use node';

import { ConvexError, v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { tryFinalizeStorageDecision } from './storageDecision';

const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

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

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) {
      return false;
    }
    mismatch |= leftByte ^ rightByte;
  }
  return mismatch === 0;
}

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, '0')).join(
    '',
  );
}

export async function verifyWebhookSignature(args: {
  payload: string;
  signature: string | null;
  timestamp: string | null;
}) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.malwareWebhookSharedSecret) {
    throw new ConvexError('AWS_MALWARE_WEBHOOK_SHARED_SECRET is not configured.');
  }
  if (!args.signature || !args.timestamp) {
    throw new ConvexError('Missing required webhook signature headers.');
  }

  const timestampMs = Number.parseInt(args.timestamp, 10);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > WEBHOOK_MAX_AGE_MS) {
    throw new ConvexError('Webhook timestamp is stale.');
  }

  const expected = await sign(
    runtimeConfig.malwareWebhookSharedSecret,
    `${args.timestamp}.${args.payload}`,
  );
  if (!timingSafeEqual(expected, args.signature)) {
    throw new ConvexError('Webhook signature verification failed.');
  }
}

export function parseGuardDutyWebhookPayload(payload: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ConvexError('Webhook payload is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('bucket' in parsed) ||
    !('findingId' in parsed) ||
    !('status' in parsed) ||
    !('scannedAt' in parsed) ||
    !('type' in parsed)
  ) {
    throw new ConvexError('Webhook payload is malformed.');
  }

  const candidate = parsed as
    | {
        type: 'guardduty_finding';
        bucket: string;
        findingId: string;
        key: string;
        scannedAt: number;
        status: 'CLEAN' | 'INFECTED';
        versionId?: string;
      }
    | {
        type: 'promotion_result';
        bucket: string;
        failureReason?: string;
        findingId: string;
        promotedBucket?: string;
        promotedKey?: string;
        promotedVersionId?: string;
        quarantineKey: string;
        scannedAt: number;
        status: 'PROMOTED' | 'PROMOTION_FAILED';
      };

  if (candidate.type === 'guardduty_finding') {
    if (!('key' in candidate)) {
      throw new ConvexError('GuardDuty finding payload is malformed.');
    }
    if (candidate.status !== 'CLEAN' && candidate.status !== 'INFECTED') {
      throw new ConvexError('Webhook status is not supported.');
    }
    return candidate;
  }

  if (!('quarantineKey' in candidate)) {
    throw new ConvexError('Promotion result payload is malformed.');
  }

  if (candidate.status !== 'PROMOTED' && candidate.status !== 'PROMOTION_FAILED') {
    throw new ConvexError('Promotion result status is not supported.');
  }

  return candidate;
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
  if (runtimeConfig.s3FilesBucket && args.bucket !== runtimeConfig.s3FilesBucket) {
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
  if (runtimeConfig.s3FilesBucket && args.bucket !== runtimeConfig.s3FilesBucket) {
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

export const createWebhookSignatureForPayload = internalAction({
  args: { payload: v.string(), timestamp: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const runtimeConfig = getStorageRuntimeConfig();
    if (!runtimeConfig.malwareWebhookSharedSecret) {
      throw new ConvexError('AWS_MALWARE_WEBHOOK_SHARED_SECRET is not configured.');
    }
    return await sign(
      runtimeConfig.malwareWebhookSharedSecret,
      `${args.timestamp}.${args.payload}`,
    );
  },
});
