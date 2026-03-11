import { v } from 'convex/values';
import { getE2ETestSecret, isE2ETestAuthEnabled } from '../src/lib/server/env.server';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import { type MutationCtx, mutation } from './_generated/server';

type BetterAuthUserRecord = {
  _id?: string;
  id?: string;
  email?: string;
};

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

async function findAuthUserByEmail(ctx: MutationCtx, email: string) {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [
      {
        field: 'email',
        operator: 'eq',
        value: email,
      },
    ],
  })) as BetterAuthUserRecord | null;

  return user;
}

export const ensurePrincipalRole = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')),
  },
  handler: async (ctx, args) => {
    assertE2EAccess(args.secret);

    const authUser = await findAuthUserByEmail(ctx, args.email);
    if (!authUser) {
      return {
        found: false as const,
      };
    }

    const userId = assertUserId(authUser, 'E2E auth user id not found');
    const existingProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const now = Date.now();

    if (!existingProfile) {
      await ctx.db.insert('userProfiles', {
        userId,
        role: args.role,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.runMutation(internal.dashboardStats.adjustUserCounts, {
        totalDelta: 1,
      });
    } else if (existingProfile.role !== args.role) {
      await ctx.db.patch(existingProfile._id, {
        role: args.role,
        updatedAt: now,
      });
    }

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

    const authUser = await findAuthUserByEmail(ctx, args.email);
    if (!authUser) {
      return {
        deleted: false as const,
      };
    }

    const userId = assertUserId(authUser, 'E2E auth user id not found');
    const existingProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
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

    if (existingProfile) {
      await ctx.db.delete(existingProfile._id);
      await ctx.runMutation(internal.dashboardStats.recomputeUserCounts, {});
    }

    return {
      deleted: true as const,
      userId,
    };
  },
});
