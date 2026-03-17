'use node';

import { ConvexError, v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { createPresignedS3Url } from './lib/storageS3';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index]! ^ rightBytes[index]!;
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
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, '0')).join('');
}

export async function createFileServeSignature(storageId: string) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.fileServeSigningSecret) {
    throw new ConvexError('AWS_FILE_SERVE_SIGNING_SECRET is not configured.');
  }
  return await sign(runtimeConfig.fileServeSigningSecret, `file_serve:${storageId}`);
}

export async function verifyFileServeSignature(storageId: string, signature: string) {
  const expected = await createFileServeSignature(storageId);
  if (!timingSafeEqual(expected, signature)) {
    throw new ConvexError('Invalid file serve signature.');
  }
}

export async function resolveServeRedirect(ctx: ActionCtx, storageId: string) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId,
  });
  if (!lifecycle) {
    throw new ConvexError('Stored file not found.');
  }
  if (
    lifecycle.malwareStatus === 'INFECTED' ||
    lifecycle.malwareStatus === 'QUARANTINED_UNSCANNED'
  ) {
    throw new ConvexError('Stored file is quarantined.');
  }

  const bucket =
    lifecycle.backendMode === 's3-primary' ? lifecycle.canonicalBucket : lifecycle.mirrorBucket;
  const key = lifecycle.backendMode === 's3-primary' ? lifecycle.canonicalKey : lifecycle.mirrorKey;

  if (!bucket || !key) {
    throw new ConvexError('Stored file does not have an S3 backing object.');
  }

  const presigned = await createPresignedS3Url({
    bucket,
    key,
    method: 'GET',
  });

  return {
    storageId,
    url: presigned.url,
  };
}

export const createSignedServeUrlInternal = internalAction({
  args: { storageId: v.string() },
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
  }),
  handler: async (_ctx, args) => {
    const runtimeConfig = getStorageRuntimeConfig();
    if (!runtimeConfig.convexSiteUrl) {
      throw new ConvexError('CONVEX_SITE_URL is not configured.');
    }
    const signature = await createFileServeSignature(args.storageId);
    return {
      storageId: args.storageId,
      url: `${runtimeConfig.convexSiteUrl}/api/files/serve?id=${encodeURIComponent(args.storageId)}&sig=${encodeURIComponent(signature)}`,
    };
  },
});

export const resolveServeRedirectInternal = internalAction({
  args: { storageId: v.string() },
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    return await resolveServeRedirect(ctx, args.storageId);
  },
});

export const createSignedServeUrl = action({
  args: { storageId: v.string() },
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
  }),
  handler: async (_ctx, args) => {
    const runtimeConfig = getStorageRuntimeConfig();
    if (!runtimeConfig.convexSiteUrl) {
      throw new ConvexError('CONVEX_SITE_URL is not configured.');
    }
    const signature = await createFileServeSignature(args.storageId);
    return {
      storageId: args.storageId,
      url: `${runtimeConfig.convexSiteUrl}/api/files/serve?id=${encodeURIComponent(args.storageId)}&sig=${encodeURIComponent(signature)}`,
    };
  },
});
