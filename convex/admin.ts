import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import { shapeAdminUsers } from '../src/features/admin/lib/admin-user-shaping';
import { internal } from './_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { action, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { isAdminRole } from './auth/access';
import { throwConvexError } from './auth/errors';
import {
  fetchAllBetterAuthMembers,
  fetchAllBetterAuthOrganizations,
  fetchAllBetterAuthUsers,
  findBetterAuthUserByEmail,
  normalizeBetterAuthUserProfile,
  updateBetterAuthUserRecord,
} from './lib/betterAuth';

const ADMIN_USER_INDEX_SYNC_INTERVAL_MS = 5 * 60 * 1000;

async function requireSiteAdmin(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  if (!isAdminRole((authUser as { role?: string | string[] }).role)) {
    throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
  }

  return authUser;
}

function toTimestamp(value: string | number | Date | undefined) {
  if (!value) {
    return Date.now();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

export const listUsers = query({
  args: {
    page: v.number(),
    pageSize: v.number(),
    sortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('role'),
      v.literal('emailVerified'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    secondarySortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('role'),
      v.literal('emailVerified'),
      v.literal('createdAt'),
    ),
    secondarySortOrder: v.union(v.literal('asc'), v.literal('desc')),
    search: v.string(),
    role: v.union(v.literal('all'), v.literal('admin'), v.literal('user')),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const [profiles, memberships, organizations] = await Promise.all([
      args.role === 'all'
        ? ctx.db.query('userProfiles').collect()
        : ctx.db
            .query('userProfiles')
            .withIndex('by_role', (q) => q.eq('role', args.role === 'admin' ? 'admin' : 'user'))
            .collect(),
      fetchAllBetterAuthMembers(ctx),
      fetchAllBetterAuthOrganizations(ctx),
    ]);

    const organizationsById = new Map(
      organizations.map((organization) => [organization._id ?? organization.id ?? '', organization]),
    );
    const membershipsByUserId = new Map<
      string,
      Array<{
        id: string;
        slug: string;
        name: string;
        logo: string | null;
      }>
    >();

    for (const membership of memberships) {
      const organization = organizationsById.get(membership.organizationId);
      if (!organization) {
        continue;
      }

      const organizationSummary = {
        id: organization._id ?? membership.organizationId,
        slug: organization.slug,
        name: organization.name,
        logo: organization.logo ?? null,
      };
      const userOrganizations = membershipsByUserId.get(membership.userId) ?? [];

      if (!userOrganizations.some((entry) => entry.id === organizationSummary.id)) {
        userOrganizations.push(organizationSummary);
        userOrganizations.sort((left, right) => left.name.localeCompare(right.name));
        membershipsByUserId.set(membership.userId, userOrganizations);
      }
    }

    return shapeAdminUsers(
      profiles.map((profile) => ({
        id: profile.authUserId,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        emailVerified: profile.emailVerified,
        banned: profile.banned,
        banReason: profile.banReason,
        banExpires: profile.banExpires,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        organizations: membershipsByUserId.get(profile.authUserId) ?? [],
      })),
      args,
    );
  },
});

export const ensureUserIndex = action({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ success: true; synced: boolean; totalUsers: number }> => {
    await requireSiteAdmin(ctx);

    const syncState = await ctx.runQuery(internal.admin.getUserIndexSyncStateInternal, {});
    const shouldSync =
      args.force === true ||
      !syncState ||
      Date.now() - syncState.lastFullSyncAt >= ADMIN_USER_INDEX_SYNC_INTERVAL_MS;

    if (!shouldSync) {
      return {
        success: true,
        synced: false,
        totalUsers: syncState.totalUsers,
      };
    }

    const users = await fetchAllBetterAuthUsers(ctx);
    const normalizedUsers = users.map(normalizeBetterAuthUserProfile);

    const result = await ctx.runMutation(internal.users.syncUserProfilesSnapshot, {
      users: normalizedUsers,
    });

    return {
      success: true,
      synced: true,
      totalUsers: result.totalUsers,
    };
  },
});

export const getUserIndexSyncStateInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('userProfileSyncState')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();
  },
});

export const syncUserIndexEntry = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireSiteAdmin(ctx);
    return await ctx.runMutation(internal.users.syncAuthUserProfile, {
      authUserId: args.userId,
    });
  },
});

export const deleteUserIndexEntry = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireSiteAdmin(ctx);
    return await ctx.runMutation(internal.users.deleteAuthUserProfile, {
      authUserId: args.userId,
    });
  },
});

export const getSystemStats = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const users = await fetchAllBetterAuthUsers(ctx);
    return {
      users: users.length,
      admins: users.filter((user) => isAdminRole(user.role)).length,
    };
  },
});

export const promoteUserByEmail = action({
  args: {
    token: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || args.token !== secret) {
      throw new Error('Unauthorized admin promotion access');
    }

    const email = args.email.trim().toLowerCase();
    const authUser = await findBetterAuthUserByEmail(ctx, email);
    if (!authUser) {
      throwConvexError('NOT_FOUND', 'User not found');
    }

    const authUserId = assertUserId(authUser, 'Better Auth user missing id');
    await updateBetterAuthUserRecord(ctx, authUserId, {
      role: 'admin',
    });

    await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
      authUserId,
      createdAt: toTimestamp(authUser.createdAt),
      updatedAt: Date.now(),
    });

    return {
      success: true,
      email,
      userId: authUserId,
    };
  },
});

export const truncateData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);

    const auditLogs = await ctx.db.query('auditLogs').collect();
    let deletedCount = 0;
    let failedCount = 0;

    for (const log of auditLogs) {
      try {
        await ctx.db.delete(log._id);
        deletedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`Failed to delete audit log ${log._id}:`, error);
      }
    }

    return {
      success: failedCount === 0,
      message:
        failedCount === 0
          ? 'All audit logs have been truncated successfully. User accounts and authentication data preserved.'
          : `Partial truncation completed. ${deletedCount} audit logs deleted, ${failedCount} failed. User accounts and authentication data preserved.`,
      truncatedTables: deletedCount > 0 ? 1 : 0,
      failedTables: failedCount > 0 ? 1 : 0,
      totalTables: 1,
      failedTableNames: failedCount > 0 ? ['auditLogs'] : [],
      invalidateAllCaches: true,
    };
  },
});

export const cleanupDeletedUserData = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.userId))
      .first();

    if (appUser) {
      await ctx.db.delete(appUser._id);
    }

    const auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect();
    for (const log of auditLogs) {
      await ctx.db.delete(log._id);
    }

    return {
      success: true,
      deletedAuditLogs: auditLogs.length,
      deletedAppUser: appUser ? 1 : 0,
      email: args.email,
    };
  },
});
