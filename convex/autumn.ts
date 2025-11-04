import { Autumn } from 'autumn-js';
import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { authComponent } from './auth';

const AUTUMN_SECRET_KEY = process.env.AUTUMN_SECRET_KEY ?? '';

export const AUTUMN_NOT_CONFIGURED_ERROR = {
  message: 'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI usage.',
  code: 'AUTUMN_NOT_CONFIGURED',
} as const;

type AuthCtx = Parameters<typeof authComponent.getAuthUser>[0];

let cachedAutumn: Autumn | null = null;

function getAutumnClient(): Autumn {
  if (!isAutumnConfigured()) {
    throw new Error(AUTUMN_NOT_CONFIGURED_ERROR.message);
  }

  if (!cachedAutumn) {
    cachedAutumn = new Autumn({
      secretKey: AUTUMN_SECRET_KEY,
    });
  }

  return cachedAutumn;
}

export function isAutumnConfigured(): boolean {
  return AUTUMN_SECRET_KEY.length > 0;
}

export function ensureAutumnConfigured(): void {
  if (!isAutumnConfigured()) {
    throw new Error(AUTUMN_NOT_CONFIGURED_ERROR.message);
  }
}

export async function trackAutumnUsage(
  ctx: AuthCtx,
  args: { featureId: string; value: number; properties?: Record<string, unknown> },
) {
  if (!isAutumnConfigured()) {
    return { data: null, error: AUTUMN_NOT_CONFIGURED_ERROR };
  }

  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return { data: null, error: { message: 'Authentication required', code: 'UNAUTHENTICATED' } };
  }

  const customer_id = assertUserId(authUser, 'Unable to resolve user id for Autumn.');
  const client = getAutumnClient();
  return await client.track({
    customer_id,
    feature_id: args.featureId,
    value: args.value,
    properties: args.properties,
  });
}

export async function checkAutumnAccess(ctx: AuthCtx, args: { featureId: string }) {
  if (!isAutumnConfigured()) {
    return { data: null, error: AUTUMN_NOT_CONFIGURED_ERROR };
  }

  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return { data: null, error: { message: 'Authentication required', code: 'UNAUTHENTICATED' } };
  }

  const customer_id = assertUserId(authUser, 'Unable to resolve user id for Autumn.');
  const client = getAutumnClient();
  return await client.check({ customer_id, feature_id: args.featureId });
}

export const checkoutAutumn = action({
  args: { productId: v.string(), successUrl: v.optional(v.string()) },
  handler: async (ctx: ActionCtx, args: { productId: string; successUrl?: string }) => {
    if (!isAutumnConfigured()) {
      return { data: null, error: AUTUMN_NOT_CONFIGURED_ERROR };
    }

    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { data: null, error: { message: 'Authentication required', code: 'UNAUTHENTICATED' } };
    }

    const customer_id = assertUserId(authUser, 'Unable to resolve user id for Autumn.');
    const client = getAutumnClient();

    const checkoutParams: {
      customer_id: string;
      product_id: string;
      successUrl?: string;
    } = {
      customer_id,
      product_id: args.productId,
    };

    // Add success URL if provided
    if (args.successUrl) {
      checkoutParams.successUrl = args.successUrl;
    }

    return await client.checkout(checkoutParams);
  },
});

export const isAutumnReady = action({
  args: {},
  handler: async (_ctx: ActionCtx) => ({
    configured: isAutumnConfigured(),
  }),
});
