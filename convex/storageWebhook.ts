'use node';

import { ConvexError, v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';

const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

export const guardDutyWebhookPayloadValidator = v.object({
  bucket: v.string(),
  findingId: v.string(),
  key: v.string(),
  scannedAt: v.number(),
  status: v.union(v.literal('CLEAN'), v.literal('INFECTED')),
  versionId: v.optional(v.string()),
});

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
    !('key' in parsed) ||
    !('findingId' in parsed) ||
    !('status' in parsed) ||
    !('scannedAt' in parsed)
  ) {
    throw new ConvexError('Webhook payload is malformed.');
  }

  const candidate = parsed as {
    bucket: string;
    findingId: string;
    key: string;
    scannedAt: number;
    status: 'CLEAN' | 'INFECTED';
    versionId?: string;
  };

  if (candidate.status !== 'CLEAN' && candidate.status !== 'INFECTED') {
    throw new ConvexError('Webhook status is not supported.');
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

  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByS3Key, {
    bucket: args.bucket,
    key: args.key,
  });
  if (!lifecycle) {
    return { applied: false, reason: 'missing_lifecycle' as const };
  }

  if (lifecycle.malwareFindingId === args.findingId) {
    return { applied: false, reason: 'duplicate_finding' as const };
  }

  if (args.status === 'CLEAN') {
    await ctx.runMutation(internal.storageLifecycle.markCleanInternal, {
      scannedAt: args.scannedAt,
      storageId: lifecycle.storageId,
    });
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
  }

  return { applied: true, reason: 'ok' as const };
}

export const applyGuardDutyFindingInternal = internalAction({
  args: guardDutyWebhookPayloadValidator,
  returns: v.object({
    applied: v.boolean(),
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    return await applyGuardDutyFinding(ctx, args);
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
