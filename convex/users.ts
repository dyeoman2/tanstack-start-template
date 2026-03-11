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
} from './auth/access';
import { throwConvexError } from './auth/errors';
import { authComponent } from './auth';
import {
  type BetterAuthOrganization,
  createBetterAuthMember,
  createBetterAuthOrganization,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
} from './lib/betterAuth';

type EnsureUserContextArgs = {
  authUserId: string;
  createdAt: number;
  updatedAt: number;
};

type EnsureUserContextResult = {
  userId: Id<'users'>;
  organizationId: string;
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function resolveActiveOrganizationForUser(
  ctx: MutationCtx,
  authUserId: string,
  preferredOrganizationId?: string,
) {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  if (memberships.length === 0) {
    const organization = await createDefaultOrganization(ctx, authUserId, Date.now());
    const organizationId = organization._id ?? organization.id;
    if (!organizationId) {
      throw new Error('Failed to initialize default organization');
    }

    return {
      organization,
      organizationId,
    };
  }

  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const organizationsById = new Map(
    organizations.map((organization) => [organization._id ?? organization.id, organization]),
  );

  if (preferredOrganizationId) {
    const preferredOrganization = organizationsById.get(preferredOrganizationId);
    if (preferredOrganization) {
      return {
        organization: preferredOrganization,
        organizationId: preferredOrganization._id ?? preferredOrganizationId,
      };
    }
  }

  for (const membership of memberships) {
    const organization = organizationsById.get(membership.organizationId);
    if (organization) {
      return {
        organization,
        organizationId: organization._id ?? membership.organizationId,
      };
    }
  }

  const organization = await createDefaultOrganization(ctx, authUserId, Date.now());
  const organizationId = organization._id ?? organization.id;
  if (!organizationId) {
    throw new Error('Failed to initialize default organization');
  }

  return {
    organization,
    organizationId,
  };
}

async function patchAiOwnershipToOrganization(
  ctx: MutationCtx,
  authUserId: string,
  organizationId: string,
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
      .filter((doc) => doc.organizationId !== organizationId)
      .map((doc) => ctx.db.patch(doc._id, { organizationId, updatedAt: Date.now() })),
    ...responseDocs
      .filter((doc) => doc.organizationId !== organizationId)
      .map((doc) => ctx.db.patch(doc._id, { organizationId, updatedAt: Date.now() })),
  ]);
}

async function createDefaultOrganization(
  ctx: MutationCtx,
  authUserId: string,
  now: number,
): Promise<BetterAuthOrganization> {
  const slug = `${slugify(`org-${authUserId.slice(0, 8)}`)}-${now.toString(36)}`;
  const organization = await createBetterAuthOrganization(ctx, {
    name: 'New Organization',
    slug,
    createdAt: now,
  });

  await createBetterAuthMember(ctx, {
    organizationId: organization._id ?? organization.id,
    userId: authUserId,
    role: 'owner',
    createdAt: now,
  });

  return organization;
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

  const resolvedOrganization = await resolveActiveOrganizationForUser(
    ctx,
    args.authUserId,
    user?.lastActiveOrganizationId,
  );
  const organizationId = resolvedOrganization.organizationId;

  if (!user) {
    const userId = await ctx.db.insert('users', {
      authUserId: args.authUserId,
      lastActiveOrganizationId: organizationId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
    user = await ctx.db.get(userId);
  } else if (user.lastActiveOrganizationId !== organizationId) {
    await ctx.db.patch(user._id, {
      lastActiveOrganizationId: organizationId,
      updatedAt: now,
    });
  }

  if (!user) {
    throw new Error('Failed to initialize user context');
  }

  await patchAiOwnershipToOrganization(ctx, args.authUserId, organizationId);

  return {
    userId: user._id,
    organizationId,
  };
}

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
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'user',
          update: {
            updatedAt: Date.now(),
            role: args.role,
          },
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
      const isSiteAdmin = isAdminRole(
        (authUser as BetterAuthAdapterUserDoc & { role?: string | string[] }).role,
      );

      return {
        id: authUserId,
        email: authUser.email ?? '',
        name: authUser.name ?? null,
        phoneNumber: authUser.phoneNumber ?? null,
        role: isSiteAdmin ? 'admin' : 'user',
        isSiteAdmin,
        emailVerified: authUser.emailVerified ?? false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        currentOrganization: null,
        organizations: [],
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
