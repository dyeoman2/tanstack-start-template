import { Autumn } from '@useautumn/convex';
import { assertUserId } from '../src/lib/shared/user-id';
import { components } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { authComponent } from './auth';

const AUTUMN_SECRET_KEY = process.env.AUTUMN_SECRET_KEY ?? '';

export const AUTUMN_NOT_CONFIGURED_ERROR = {
  message: 'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI usage.',
  code: 'AUTUMN_NOT_CONFIGURED',
} as const;

type AuthCtx = Parameters<typeof authComponent.getAuthUser>[0];

// Initialize the Autumn component client
export const autumn = new Autumn(components.autumn, {
  secretKey: AUTUMN_SECRET_KEY,
  identify: async (ctx: AuthCtx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'Unable to resolve user id for Autumn.');
    return {
      customerId: userId,
      customerData: {
        name: authUser.name,
        email: authUser.email,
      },
    };
  },
});

// Export component API functions for use by AutumnProvider and hooks
// These are automatically registered as public actions by the component
export const {
  track,
  check,
  checkout,
  attach,
  cancel,
  query,
  usage,
  setupPayment,
  createCustomer,
  listProducts,
  billingPortal,
  createReferralCode,
  redeemReferralCode,
  createEntity,
  getEntity,
} = autumn.api();

export function isAutumnConfigured(): boolean {
  return AUTUMN_SECRET_KEY.length > 0;
}

export function ensureAutumnConfigured(): void {
  if (!isAutumnConfigured()) {
    throw new Error(AUTUMN_NOT_CONFIGURED_ERROR.message);
  }
}

// Re-export checkout with a custom name for backward compatibility with CreditPurchase component
export const checkoutAutumn = checkout;

export const isAutumnReady = action({
  args: {},
  handler: async (_ctx: ActionCtx) => ({
    configured: isAutumnConfigured(),
  }),
});
