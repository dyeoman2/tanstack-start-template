import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth';
import { v } from 'convex/values';
import { getBetterAuthSecret, getSiteUrl } from '../src/lib/server/env.server';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { action, query } from './_generated/server';

const siteUrl = getSiteUrl();
const secret = getBetterAuthSecret();

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
    // Rate limiting at top level - Better Auth only inspects options.rateLimit
    rateLimit: {
      // Global rate limit - applies to all endpoints
      window: 60 * 60, // 1 hour in seconds
      max: 100, // 100 requests per hour per IP
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      sendResetPassword: async ({ user, url, token }) => {
        // Apply server-side rate limiting for password reset (defense-in-depth)
        const ctxWithRunMutation = ctx as GenericCtx<DataModel> & {
          runMutation?: (
            fn: unknown,
            args: unknown,
          ) => Promise<{ ok: boolean; retryAfter?: number }>;
        };

        if (!ctxWithRunMutation.runMutation) {
          throw new Error('Rate limiter mutation unavailable in current context');
        }

        const rateLimitResult = await ctxWithRunMutation.runMutation(
          components.rateLimiter.lib.rateLimit,
          {
            name: 'passwordReset',
            key: `passwordReset:${user.email}`,
            config: {
              kind: 'token bucket',
              rate: 3, // 3 requests
              period: 60 * 60 * 1000, // per hour
              capacity: 3,
            },
          },
        );

        if (!rateLimitResult.ok) {
          throw new Error(
            `Rate limit exceeded. Too many password reset requests. Please try again in ${Math.ceil(
              (rateLimitResult.retryAfter ?? 0) / (60 * 1000),
            )} minutes.`,
          );
        }

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

const internalRateLimitToken = process.env.BETTER_AUTH_SECRET;
if (!internalRateLimitToken) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required');
}

// Action wrapper for rate limiting (callable from server functions)
export const rateLimitAction = action({
  args: {
    token: v.string(),
    name: v.string(),
    key: v.string(),
    config: v.union(
      v.object({
        kind: v.literal('token bucket'),
        rate: v.number(),
        period: v.number(),
        capacity: v.number(),
      }),
      v.object({
        kind: v.literal('fixed window'),
        rate: v.number(),
        period: v.number(),
        capacity: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.token !== internalRateLimitToken) {
      throw new Error('Unauthorized rate limit access');
    }

    const { token: _token, ...rateLimitArgs } = args;
    return await ctx.runMutation(components.rateLimiter.lib.rateLimit, rateLimitArgs);
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
