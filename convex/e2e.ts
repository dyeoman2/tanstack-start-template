import { v } from 'convex/values';
import { getE2ETestSecret, isE2ETestAuthEnabled } from '../src/lib/server/env.server';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import { mutation } from './_generated/server';
import { findBetterAuthUserByEmail, updateBetterAuthUserRecord } from './lib/betterAuth';

const deletePaginationOpts = {
  cursor: null,
  id: 0,
  numItems: 1000,
} as const;

function assertE2EAccess(secret: string) {
  if (!isE2ETestAuthEnabled()) {
    throw new Error('E2E test auth is disabled');
  }

  if (secret !== getE2ETestSecret()) {
    throw new Error('Unauthorized e2e access');
  }
}

export const ensurePrincipalRole = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')),
  },
  handler: async (ctx, args) => {
    assertE2EAccess(args.secret);

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

export const resetPrincipalByEmail = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    assertE2EAccess(args.secret);

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
      const [memberships, invites, logs] = await Promise.all([
        ctx.db
          .query('teamUsers')
          .withIndex('by_user', (q) => q.eq('userId', appUser._id))
          .collect(),
        ctx.db
          .query('teamInvites')
          .withIndex('by_email', (q) => q.eq('email', args.email.toLowerCase()))
          .collect(),
        ctx.db
          .query('auditLogs')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
          .collect(),
      ]);

      for (const membership of memberships) {
        await ctx.db.delete(membership._id);
      }
      for (const invite of invites) {
        await ctx.db.delete(invite._id);
      }
      for (const log of logs) {
        await ctx.db.delete(log._id);
      }

      const teams = await ctx.db
        .query('teams')
        .withIndex('by_created_by_id', (q) => q.eq('createdById', appUser._id))
        .collect();
      for (const team of teams) {
        await ctx.db.delete(team._id);
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
