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

type AutumnInstance = InstanceType<typeof Autumn>;
type TrackArgs = Parameters<AutumnInstance['track']>[1];
type TrackResult = Awaited<ReturnType<AutumnInstance['track']>>;
type CheckArgs = Parameters<AutumnInstance['check']>[1];
type CheckResult = Awaited<ReturnType<AutumnInstance['check']>>;
type CheckoutArgs = Parameters<AutumnInstance['checkout']>[1];
type CheckoutResult = Awaited<ReturnType<AutumnInstance['checkout']>>;
type AutumnApi = ReturnType<AutumnInstance['api']>;

const FALLBACK_AUTUMN_API = {
  track: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  check: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  attach: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  checkout: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  createCustomer: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  listProducts: async () => ({ data: [], error: AUTUMN_NOT_CONFIGURED_ERROR }),
  usage: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  query: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  cancel: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  setupPayment: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  billingPortal: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  createReferralCode: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  redeemReferralCode: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  createEntity: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
  getEntity: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }),
} as unknown as AutumnApi;

interface AutumnClientLike {
  track: (ctx: AuthCtx, args: TrackArgs) => Promise<TrackResult>;
  check: (ctx: AuthCtx, args: CheckArgs) => Promise<CheckResult>;
  checkout: (ctx: AuthCtx, args: CheckoutArgs) => Promise<CheckoutResult>;
  api: () => AutumnApi;
}

const FALLBACK_AUTUMN_CLIENT: AutumnClientLike = {
  track: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }) as TrackResult,
  check: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }) as CheckResult,
  checkout: async () => ({ data: null, error: AUTUMN_NOT_CONFIGURED_ERROR }) as CheckoutResult,
  api: () => FALLBACK_AUTUMN_API,
};

let cachedAutumn: Autumn | null = null;
let autumnInitPromise: Promise<Autumn> | null = null;

function createAutumnInstance(): Autumn {
  return new Autumn(components.autumn, {
    secretKey: AUTUMN_SECRET_KEY,
    identify: async (ctx: AuthCtx) => {
      const authUser = await authComponent.getAuthUser(ctx);
      if (!authUser) {
        return null;
      }

      const customerId = assertUserId(authUser, 'Unable to resolve user id for Autumn.');
      return {
        customerId,
        customerData: {
          name: typeof authUser.name === 'string' ? authUser.name : undefined,
          email: typeof authUser.email === 'string' ? authUser.email : undefined,
        },
      };
    },
  });
}

async function getAutumnClient(): Promise<AutumnClientLike> {
  if (!isAutumnConfigured()) {
    return FALLBACK_AUTUMN_CLIENT;
  }

  if (cachedAutumn) {
    return cachedAutumn;
  }

  if (autumnInitPromise) {
    await autumnInitPromise;
    if (!cachedAutumn) {
      throw new Error('Autumn client was not initialized properly');
    }
    return cachedAutumn;
  }

  autumnInitPromise = Promise.resolve(createAutumnInstance());
  cachedAutumn = await autumnInitPromise;
  autumnInitPromise = null;

  return cachedAutumn;
}

export const autumn = {
  api: async () => {
    const client = await getAutumnClient();
    return client.api();
  },
} as unknown as Pick<Autumn, 'api'>;

export function isAutumnConfigured(): boolean {
  return AUTUMN_SECRET_KEY.length > 0;
}

export function ensureAutumnConfigured(): void {
  if (!isAutumnConfigured()) {
    throw new Error(AUTUMN_NOT_CONFIGURED_ERROR.message);
  }
}

export async function trackAutumnUsage(ctx: AuthCtx, args: TrackArgs): Promise<TrackResult> {
  const client = await getAutumnClient();
  return await client.track(ctx, args);
}

export async function checkAutumnAccess(ctx: AuthCtx, args: CheckArgs): Promise<CheckResult> {
  const client = await getAutumnClient();
  return await client.check(ctx, args);
}

export async function checkoutAutumn(ctx: AuthCtx, args: CheckoutArgs): Promise<CheckoutResult> {
  const client = await getAutumnClient();
  return await client.checkout(ctx, args);
}

export const isAutumnReady = action({
  args: {},
  handler: async (_ctx: ActionCtx) => ({
    configured: isAutumnConfigured(),
  }),
});
