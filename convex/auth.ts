import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';

const siteUrl = process.env.SITE_URL;
if (!siteUrl) {
  throw new Error('SITE_URL environment variable is required');
}
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required');
}

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth({
    logger: {
      disabled: optionsOnly,
    },
    baseURL: siteUrl,
    secret,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        // Note: role is NOT included here because the Convex adapter validator
        // doesn't accept additionalFields during user creation. We set role
        // after user creation via a Convex mutation (see user-management.ts)
        phoneNumber: {
          type: 'string',
          required: false,
        },
      },
    },
    plugins: [convex()],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
