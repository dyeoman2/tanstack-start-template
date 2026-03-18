'use node';

import { ConvexError, v } from 'convex/values';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action, internalAction } from './_generated/server';
import { requireStorageReadAccessFromActionOrThrow } from './auth/access';
import { createPresignedS3Url } from './lib/storageS3';

const FILE_SERVE_URL_TTL_MS = 15 * 60 * 1000;

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

function buildSignedServeUrl(params: {
  convexSiteUrl: string;
  expiresAt: number;
  signature: string;
  storageId: string;
}) {
  return `${params.convexSiteUrl}/api/files/serve?id=${encodeURIComponent(params.storageId)}&exp=${encodeURIComponent(String(params.expiresAt))}&sig=${encodeURIComponent(params.signature)}`;
}

export async function createFileServeSignature(storageId: string, expiresAt: number) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.fileServeSigningSecret) {
    throw new ConvexError('AWS_FILE_SERVE_SIGNING_SECRET is not configured.');
  }
  return await sign(runtimeConfig.fileServeSigningSecret, `file_serve:${storageId}:${expiresAt}`);
}

export async function verifyFileServeSignature(
  storageId: string,
  signature: string,
  expiresAt: number,
) {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ConvexError('File serve signature has expired.');
  }

  const expected = await createFileServeSignature(storageId, expiresAt);
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
    const expiresAt = Date.now() + FILE_SERVE_URL_TTL_MS;
    const signature = await createFileServeSignature(args.storageId, expiresAt);
    return {
      storageId: args.storageId,
      url: buildSignedServeUrl({
        convexSiteUrl: runtimeConfig.convexSiteUrl,
        expiresAt,
        signature,
        storageId: args.storageId,
      }),
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
  handler: async (ctx, args) => {
    await requireStorageReadAccessFromActionOrThrow(ctx, {
      storageId: args.storageId,
      sourceSurface: 'file.serve_url_create',
    });

    const runtimeConfig = getStorageRuntimeConfig();
    if (!runtimeConfig.convexSiteUrl) {
      throw new ConvexError('CONVEX_SITE_URL is not configured.');
    }
    const expiresAt = Date.now() + FILE_SERVE_URL_TTL_MS;
    const signature = await createFileServeSignature(args.storageId, expiresAt);
    return {
      storageId: args.storageId,
      url: buildSignedServeUrl({
        convexSiteUrl: runtimeConfig.convexSiteUrl,
        expiresAt,
        signature,
        storageId: args.storageId,
      }),
    };
  },
});
