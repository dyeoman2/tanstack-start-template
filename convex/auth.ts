import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth';
import { components, internal } from './_generated/api';
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
      sendResetPassword: async ({ user, url, token }) => {
        // Call the email action which schedules the mutation using the Resend component
        // This ensures queueing, batching, durable execution, and rate limiting
        // We need to call it via the HTTP API since Better Auth callbacks don't have direct access to ctx.runAction
        // For now, schedule the internal mutation directly if ctx has scheduler
        // Better Auth callbacks run in Convex context, so ctx should have scheduler
        // Use type assertion since GenericCtx might not expose scheduler in types
        // Using unknown instead of any for better type safety
        const ctxWithScheduler = ctx as GenericCtx<DataModel> & {
          scheduler?: {
            runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
          };
        };
        if (ctxWithScheduler.scheduler) {
          await ctxWithScheduler.scheduler.runAfter(
            0,
            internal.emails.sendPasswordResetEmailMutation,
            {
              user: {
                id: user.id,
                email: user.email,
                name: user.name || null,
              },
              url,
              token,
            },
          );
        } else {
          // Fallback: if no scheduler, we could call the action via HTTP
          // But this is an edge case - Better Auth should provide scheduler
          throw new Error('Cannot send email: scheduler not available');
        }
      },
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
