import { v } from 'convex/values';
import { isE2ETestAuthEnabled } from '../src/lib/server/env.server';
import { normalizeAuditIdentifier } from '../src/lib/shared/auth-audit';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { findBetterAuthUserByEmail, updateBetterAuthUserRecord } from './lib/betterAuth';
import {
  e2eEnsurePrincipalRoleValidator,
  e2eResetPrincipalValidator,
} from './lib/returnValidators';

const deletePaginationOpts = {
  cursor: null,
  id: 0,
  numItems: 1000,
} as const;

function assertE2EAccess() {
  if (!isE2ETestAuthEnabled()) {
    throw new Error('E2E test auth is disabled');
  }
}

export const ensurePrincipalRole = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')),
  },
  returns: e2eEnsurePrincipalRoleValidator,
  handler: async (ctx, args) => {
    assertE2EAccess();

    const authUser = await findBetterAuthUserByEmail(ctx, args.email);
    if (!authUser) {
      return {
        found: false as const,
      };
    }

    const userId = assertUserId(authUser, 'E2E auth user id not found');
    await updateBetterAuthUserRecord(ctx, userId, { role: args.role });
    await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
      authUserId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      found: true as const,
      userId,
      role: args.role,
    };
  },
});

export const resetPrincipalByEmail = internalMutation({
  args: {
    email: v.string(),
  },
  returns: e2eResetPrincipalValidator,
  handler: async (ctx, args) => {
    assertE2EAccess();

    const authUser = await findBetterAuthUserByEmail(ctx, args.email);
    if (!authUser) {
      return {
        deleted: false as const,
      };
    }

    const userId = assertUserId(authUser, 'E2E auth user id not found');
    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', userId))
      .first();

    await Promise.all([
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'session',
          where: [{ field: 'userId', operator: 'eq', value: userId }],
        },
        paginationOpts: deletePaginationOpts,
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'account',
          where: [{ field: 'userId', operator: 'eq', value: userId }],
        },
        paginationOpts: deletePaginationOpts,
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'verification',
          where: [{ field: 'identifier', operator: 'eq', value: args.email }],
        },
        paginationOpts: deletePaginationOpts,
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'user',
          where: [{ field: '_id', operator: 'eq', value: userId }],
        },
        paginationOpts: deletePaginationOpts,
      }),
    ]);

    if (appUser) {
      const normalizedEmail = normalizeAuditIdentifier(args.email);
      const logsByUserId = await ctx.db
        .query('auditLogs')
        .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
        .collect();
      const logsByIdentifier = normalizedEmail
        ? await ctx.db
            .query('auditLogs')
            .withIndex('by_identifier_and_createdAt', (q) => q.eq('identifier', normalizedEmail))
            .collect()
        : [];
      const logsById = new Map(
        [...logsByUserId, ...logsByIdentifier].map((log) => [log._id, log] as const),
      );

      await Promise.all([
        ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: {
            model: 'member',
            where: [{ field: 'userId', operator: 'eq', value: userId }],
          },
          paginationOpts: deletePaginationOpts,
        }),
        ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: {
            model: 'invitation',
            where: [{ field: 'email', operator: 'eq', value: args.email.toLowerCase() }],
          },
          paginationOpts: deletePaginationOpts,
        }),
      ]);

      for (const log of Array.from(logsById.values())) {
        await ctx.db.delete(log._id);
      }

      await ctx.db.delete(appUser._id);
      await ctx.runMutation(internal.dashboardStats.recomputeUserCounts, {});
    }

    return {
      deleted: true as const,
      userId,
    };
  },
});
