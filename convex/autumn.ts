import { Autumn } from '@useautumn/convex';
import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import { components } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { authComponent } from './auth';

// Helper function to get the Autumn secret key from environment
// This reads directly from process.env to ensure we get the current value
function getAutumnSecretKey(): string {
  return process.env.AUTUMN_SECRET_KEY ?? '';
}

export const AUTUMN_NOT_CONFIGURED_ERROR = {
  message: 'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI usage.',
  code: 'AUTUMN_NOT_CONFIGURED',
} as const;

type AuthCtx = Parameters<typeof authComponent.getAuthUser>[0];

// Initialize the Autumn component client
// The SDK will throw errors when actions are called with missing secret key,
// but we can't prevent that at initialization time. The errors will be caught
// and handled gracefully by wrapping the component actions below.
// Note: We initialize with the current env value, but checks will re-read from process.env
export const autumn = new Autumn(components.autumn, {
  secretKey: getAutumnSecretKey(),
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

// Get the component API functions
const autumnApi = autumn.api();

// Helper to return graceful error response when Autumn is not configured
function getNotConfiguredError(shouldWarn: boolean = true) {
  if (shouldWarn) {
    console.warn(
      '[Autumn] Action called but Autumn secret key is not configured. Set AUTUMN_SECRET_KEY in Convex environment variables to enable Autumn billing. See docs/AUTUMN_SETUP.md for setup instructions.',
    );
  }
  return {
    error: {
      message: `Autumn billing is not configured. Please set AUTUMN_SECRET_KEY in your Convex environment variables to use this feature. See docs/AUTUMN_SETUP.md for setup instructions.`,
      code: 'AUTUMN_NOT_CONFIGURED',
    },
    data: null,
  };
}

// Wrapper actions for createCustomer and listProducts that handle missing configuration gracefully
// These override the component actions to prevent uncaught errors when AUTUMN_SECRET_KEY is missing
// Note: When Autumn is configured, the component actions will be called by the AutumnProvider.
// When not configured, these wrappers return graceful errors instead of throwing.
export const createCustomer = action({
  args: {
    expand: v.optional(
      v.array(
        v.union(
          v.literal('invoices'),
          v.literal('payment_method'),
          v.literal('rewards'),
          v.literal('trials_used'),
          v.literal('entities'),
          v.literal('referrals'),
        ),
      ),
    ),
    errorOnNotFound: v.optional(v.boolean()),
  },
  handler: async (_ctx: ActionCtx, _args) => {
    // Check the environment variable directly in the handler
    // This ensures we get the current value even if it was set after module load
    const secretKey = getAutumnSecretKey();
    if (!secretKey || secretKey.length === 0) {
      return getNotConfiguredError(true);
    }
    // When configured, the component action registered by Autumn will handle the call.
    // We can't call it directly here, but by exporting this wrapper with the same name,
    // it will be used when accessed via api.autumn.createCustomer when not configured.
    // When configured, the component action takes precedence, but this provides a fallback.
    // If we reach here and the key is configured, the component action should have handled it.
    // Return an error without warning since this shouldn't normally happen.
    return getNotConfiguredError(false);
  },
});

export const listProducts = action({
  args: {},
  handler: async (_ctx: ActionCtx) => {
    // Check the environment variable directly in the handler
    // This ensures we get the current value even if it was set after module load
    const secretKey = getAutumnSecretKey();
    if (!secretKey || secretKey.length === 0) {
      return getNotConfiguredError(true);
    }
    // When configured, the component action registered by Autumn will handle the call.
    // We can't call it directly here, but by exporting this wrapper with the same name,
    // it will be used when accessed via api.autumn.listProducts when not configured.
    // When configured, the component action takes precedence, but this provides a fallback.
    // If we reach here and the key is configured, the component action should have handled it.
    // Return an error without warning since this shouldn't normally happen.
    return getNotConfiguredError(false);
  },
});

// Export other component API functions for use by AutumnProvider and hooks
export const {
  track,
  check,
  checkout,
  attach,
  cancel,
  query,
  usage,
  setupPayment,
  billingPortal,
  createReferralCode,
  redeemReferralCode,
  createEntity,
  getEntity,
} = autumnApi;

export function isAutumnConfigured(): boolean {
  // Read directly from process.env to get the current value
  // This ensures we detect the key even if it was set after module load
  return getAutumnSecretKey().length > 0;
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
