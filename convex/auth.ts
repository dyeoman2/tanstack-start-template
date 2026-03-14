import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { betterAuth } from 'better-auth';
import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import {
  getBetterAuthSecret,
  isTrustedBetterAuthOrigin,
} from '../src/lib/server/env.server';
import {
  createSharedBetterAuthOptions,
  type SharedSendInvitationEmail,
} from './betterAuth/sharedOptions';
import { createAuthAuditPlugin } from './lib/authAudit';
import betterAuthSchema from './betterAuth/schema';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { internalAction, query } from './_generated/server';

const secret = getBetterAuthSecret();

function resolveAuthEmailUrl(url: string, request?: Request): string {
  if (!request) {
    return url;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    if (!isTrustedBetterAuthOrigin(requestOrigin)) {
      return url;
    }

    const nextUrl = new URL(url);
    const nextOrigin = new URL(requestOrigin);
    nextUrl.protocol = nextOrigin.protocol;
    nextUrl.host = nextOrigin.host;
    return nextUrl.toString();
  } catch {
    return url;
  }
}

export const authComponent = createClient<DataModel, typeof betterAuthSchema>(
  components.betterAuth,
  {
    local: {
      schema: betterAuthSchema,
    },
  },
);

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  const ctxWithRunMutation = ctx as GenericCtx<DataModel> & {
    runMutation?: (fn: unknown, args: unknown) => Promise<unknown>;
  };

  const recordAuditEvent = async (event: {
    eventType: string;
    userId?: string;
    organizationId?: string;
    identifier?: string;
    metadata?: string;
    ipAddress?: string;
    userAgent?: string;
    createdAt?: number;
  }) => {
    if (!ctxWithRunMutation.runMutation) {
      return;
    }

    await ctxWithRunMutation.runMutation(anyApi.audit.insertAuditLog, {
      ...event,
    });
  };

  const sharedOptions = createSharedBetterAuthOptions({
    sendResetPassword: async ({ user, url, token }, request) => {
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
              url: resolveAuthEmailUrl(url, request),
              token,
            },
          );
        } else {
          // Fallback: if no scheduler, we could call the action via HTTP
          // But this is an edge case - Better Auth should provide scheduler
          throw new Error('Cannot send email: scheduler not available');
        }
      },
    sendVerificationEmail: async ({ user, url, token }, request) => {
      const ctxWithScheduler = ctx as GenericCtx<DataModel> & {
        scheduler?: {
          runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
        };
      };

      if (!ctxWithScheduler.scheduler) {
        throw new Error('Cannot send verification email: scheduler not available');
      }

      await ctxWithScheduler.scheduler.runAfter(0, internal.emails.sendVerificationEmailMutation, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name || null,
        },
        url: resolveAuthEmailUrl(url, request),
        token,
      });
    },
    afterEmailVerification: async (user) => {
      if (!ctxWithRunMutation.runMutation) {
        return;
      }

      await ctxWithRunMutation.runMutation(internal.users.syncAuthUserProfile, {
        authUserId: user.id,
      });
    },
    sendInvitationEmail: async (
      data: Parameters<SharedSendInvitationEmail>[0],
      request?: Request,
    ) => {
      const ctxWithScheduler = ctx as GenericCtx<DataModel> & {
        scheduler?: {
          runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
        };
      };

      if (!ctxWithScheduler.scheduler) {
        throw new Error('Cannot send organization invitation email: scheduler not available');
      }

      const inviteUrl = resolveAuthEmailUrl(`/invite/${data.id}`, request);
      await ctxWithScheduler.scheduler.runAfter(
        0,
        internal.emails.sendOrganizationInviteEmailMutation,
        {
          email: data.email,
          inviteUrl,
          inviterName: data.inviter.user.name ?? data.inviter.user.email,
          organizationName: data.organization.name,
          role: data.role,
        },
      );
    },
  });

  return betterAuth({
    ...sharedOptions,
    logger: {
      disabled: optionsOnly,
    },
    secret,
    database: authComponent.adapter(ctx),
    plugins: [...(sharedOptions.plugins ?? []), createAuthAuditPlugin(recordAuditEvent)],
  });
};

type RotatedJwk = {
  alg?: string;
  createdAt?: Date | number | string;
  expiresAt?: Date | number | string;
  id: string;
  privateKey: string;
  publicKey: string;
};

const isRotatedJwk = (value: unknown): value is RotatedJwk => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const isTimestampLike = (timestamp: unknown) =>
    timestamp === undefined ||
    typeof timestamp === 'string' ||
    typeof timestamp === 'number' ||
    timestamp instanceof Date;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.privateKey === 'string' &&
    typeof candidate.publicKey === 'string' &&
    (candidate.alg === undefined || typeof candidate.alg === 'string') &&
    isTimestampLike(candidate.createdAt) &&
    isTimestampLike(candidate.expiresAt)
  );
};

const parseRotatedJwks = (value: unknown): RotatedJwk[] => {
  if (!Array.isArray(value) || !value.every(isRotatedJwk)) {
    throw new Error('Invalid JWKS response from Better Auth');
  }

  return value;
};

// Action wrapper for rate limiting (callable from server functions)
export const rateLimitAction = internalAction({
  args: {
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
    return await ctx.runMutation(components.rateLimiter.lib.rateLimit, args);
  },
});

export const rotateKeys = internalAction({
  args: {},
  handler: async (ctx, args) => {
    void args;
    const auth = createAuth(ctx);
    const jwksResult: unknown = await (
      auth.api as unknown as {
        rotateKeys: () => Promise<unknown>;
      }
    ).rotateKeys();
    const jwks = parseRotatedJwks(jwksResult);
    return JSON.stringify(
      jwks.map((key: RotatedJwk) => ({
        ...key,
        createdAt:
          key.createdAt instanceof Date ? key.createdAt.getTime() : (key.createdAt ?? Date.now()),
        expiresAt:
          key.expiresAt instanceof Date ? key.expiresAt.getTime() : (key.expiresAt ?? undefined),
      })),
    );
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
