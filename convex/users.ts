import { v } from 'convex/values';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { action, internalMutation, mutation, query } from './_generated/server';
import {
  type CurrentUserProfile,
  buildCurrentUserProfile,
  getCurrentAuthUserOrNull,
  getCurrentUserOrNull,
  isAdminRole,
  normalizeTeamName,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import { authComponent } from './auth';

type EnsureUserContextArgs = {
  authUserId: string;
  createdAt: number;
  updatedAt: number;
};

type EnsureUserContextResult = {
  userId: Id<'users'>;
  teamId: Id<'teams'>;
};

async function findFirstTeamForUser(ctx: MutationCtx, userId: Id<'users'>) {
  const memberships = await ctx.db
    .query('teamUsers')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();

  for (const membership of memberships) {
    const team = await ctx.db.get(membership.teamId);
    if (team) {
      return {
        team,
        membership,
      };
    }
  }

  return null;
}

async function patchAiOwnershipToTeam(
  ctx: MutationCtx,
  authUserId: string,
  teamId: Id<'teams'>,
) {
  const [usageDocs, responseDocs] = await Promise.all([
    ctx.db
      .query('aiMessageUsage')
      .withIndex('by_userId', (q) => q.eq('userId', authUserId))
      .collect(),
    ctx.db
      .query('aiResponses')
      .withIndex('by_userId_createdAt', (q) => q.eq('userId', authUserId))
      .collect(),
  ]);

  await Promise.all([
    ...usageDocs
      .filter((doc) => doc.teamId !== teamId)
      .map((doc) => ctx.db.patch(doc._id, { teamId, updatedAt: Date.now() })),
    ...responseDocs
      .filter((doc) => doc.teamId !== teamId)
      .map((doc) => ctx.db.patch(doc._id, { teamId, updatedAt: Date.now() })),
  ]);
}

async function ensureUserContextRecord(
  ctx: MutationCtx,
  args: EnsureUserContextArgs,
): Promise<EnsureUserContextResult> {
  const now = Date.now();
  let user = await ctx.db
    .query('users')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.authUserId))
    .first();

  if (!user) {
    const userId = await ctx.db.insert('users', {
      authUserId: args.authUserId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
    user = await ctx.db.get(userId);
  }

  if (!user) {
    throw new Error('Failed to initialize user context');
  }

  const existingTeam = await findFirstTeamForUser(ctx, user._id);
  if (existingTeam) {
    const normalizedTeamName = normalizeTeamName(existingTeam.team.name);
    if (normalizedTeamName !== existingTeam.team.name) {
      await ctx.db.patch(existingTeam.team._id, {
        name: normalizedTeamName,
        updatedAt: now,
      });
    }

    if (user.lastActiveTeamId !== existingTeam.team._id) {
      await ctx.db.patch(user._id, {
        lastActiveTeamId: user.lastActiveTeamId ?? existingTeam.team._id,
        updatedAt: now,
      });
    }

    await patchAiOwnershipToTeam(ctx, args.authUserId, existingTeam.team._id);

    return {
      userId: user._id,
      teamId: existingTeam.team._id,
    };
  }

  const teamId = await ctx.db.insert('teams', {
    name: 'New Team',
    createdById: user._id,
    updatedById: user._id,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert('teamUsers', {
    userId: user._id,
    teamId,
    role: 'admin',
    createdById: user._id,
    updatedById: user._id,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(user._id, {
    lastActiveTeamId: teamId,
    updatedAt: now,
  });

  await patchAiOwnershipToTeam(ctx, args.authUserId, teamId);

  return {
    userId: user._id,
    teamId,
  };
}

/**
 * Check if there are any users in the system (for determining first admin)
 */
export const getUserCount = query({
  args: {},
  handler: async (ctx) => {
    let allUsers: BetterAuthAdapterUserDoc[] = [];
    try {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000,
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
      allUsers = normalized.page;
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
    }

    return {
      totalUsers: allUsers.length,
      isFirstUser: allUsers.length === 0,
    };
  },
});

export const ensureUserContextForAuthUser = internalMutation({
  args: {
    authUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ensureUserContextRecord(ctx, args);
  },
});

export const bootstrapUserContext = action({
  args: {
    token: v.string(),
    authUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
  },
  handler: async (ctx, args): Promise<EnsureUserContextResult> => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || args.token !== secret) {
      throw new Error('Unauthorized bootstrap access');
    }

    if (args.role) {
      const update: Record<string, unknown> = {
        updatedAt: Date.now(),
        role: args.role,
      };
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'user',
          update,
          where: [
            {
              field: '_id',
              operator: 'eq',
              value: args.authUserId,
            },
          ],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1,
          id: 0,
        },
      });
    }

    return await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
      authUserId: args.authUserId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
  },
});

export const ensureCurrentUserContext = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const authUserId = assertUserId(authUser, 'User ID not found in auth user');
    return await ensureUserContextRecord(ctx, {
      authUserId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update current user's Better Auth profile data.
 */
export const updateCurrentUserProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const userId = assertUserId(authUser, 'User ID not found in auth user');

    const updateData: {
      name?: string;
      phoneNumber?: string | null;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updateData.name = args.name.trim();
    }

    if (args.phoneNumber !== undefined) {
      updateData.phoneNumber = args.phoneNumber || null;
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        update: updateData,
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: userId,
          },
        ],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        id: 0,
      },
    });

    return { success: true };
  },
});

/**
 * Get current user profile with active team summary.
 */
export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx): Promise<CurrentUserProfile | null> => {
    const authUser = await getCurrentAuthUserOrNull(ctx);
    if (!authUser) {
      return null;
    }

    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      const authUserId = assertUserId(authUser, 'User ID not found in auth user');
      const authUserTyped = authUser as unknown as BetterAuthAdapterUserDoc & {
        role?: string | string[];
      };
      const isSiteAdmin = isAdminRole(authUserTyped.role);

      return {
        id: authUserId,
        email: authUserTyped.email ?? '',
        name: authUserTyped.name ?? null,
        phoneNumber: authUserTyped.phoneNumber ?? null,
        role: isSiteAdmin ? 'admin' : 'user',
        isSiteAdmin,
        emailVerified: authUserTyped.emailVerified ?? false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentTeam: null,
        teams: [],
      };
    }

    return await buildCurrentUserProfile(ctx, user);
  },
});

export const getCurrentAppUser = query({
  args: {},
  handler: async (ctx) => {
    return await getCurrentUserOrNull(ctx);
  },
});
