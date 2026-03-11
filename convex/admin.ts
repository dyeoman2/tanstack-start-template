import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, mutation, query } from './_generated/server';
import { isAdminRole } from './auth/access';
import { throwConvexError } from './auth/errors';
import { authComponent } from './auth';
import {
  fetchAllBetterAuthUsers,
  findBetterAuthUserByEmail,
  updateBetterAuthUserRecord,
} from './lib/betterAuth';

async function requireSiteAdmin(
  ctx: QueryCtx | MutationCtx,
) {
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

const LEGACY_TEAM_NAMES = new Set(['personal', 'my team']);
const SHARED_TEAM_DEFAULT_NAME = 'New Team';

export const getAllUsers = query({
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
    search: v.optional(v.string()),
    role: v.union(v.literal('all'), v.literal('user'), v.literal('admin')),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const searchValue = args.search?.trim().toLowerCase() ?? '';
    const allUsers = await fetchAllBetterAuthUsers(ctx);
    let users = allUsers.map((user) => ({
      id: assertUserId(user, 'Better Auth user missing id'),
      email: user.email,
      name: user.name ?? null,
      role: isAdminRole(user.role) ? ('admin' as const) : ('user' as const),
      emailVerified: user.emailVerified ?? false,
      createdAt: toTimestamp(user.createdAt),
      updatedAt: toTimestamp(user.updatedAt),
    }));

    if (args.role !== 'all') {
      users = users.filter((user) => user.role === args.role);
    }

    if (searchValue) {
      users = users.filter(
        (user) =>
          user.email.toLowerCase().includes(searchValue) ||
          (user.name?.toLowerCase().includes(searchValue) ?? false),
      );
    }

    const sortValue = (user: (typeof users)[number], field: typeof args.sortBy) => {
      switch (field) {
        case 'name':
          return user.name?.toLowerCase() ?? '';
        case 'email':
          return user.email.toLowerCase();
        case 'role':
          return user.role;
        case 'emailVerified':
          return user.emailVerified ? 1 : 0;
        default:
          return user.createdAt;
      }
    };

    const compareValues = (left: string | number, right: string | number, direction: 'asc' | 'desc') => {
      if (left === right) {
        return 0;
      }

      if (direction === 'asc') {
        return left > right ? 1 : -1;
      }

      return left < right ? 1 : -1;
    };

    users.sort((left, right) => {
      const primary = compareValues(
        sortValue(left, args.sortBy),
        sortValue(right, args.sortBy),
        args.sortOrder,
      );

      if (primary !== 0) {
        return primary;
      }

      return compareValues(
        sortValue(left, args.secondarySortBy),
        sortValue(right, args.secondarySortBy),
        args.secondarySortOrder,
      );
    });

    const total = users.length;
    const start = Math.max(0, (args.page - 1) * args.pageSize);
    const end = start + args.pageSize;
    const pageUsers = users.slice(start, end);

    return {
      users: pageUsers,
      pagination: {
        page: args.page,
        pageSize: args.pageSize,
        total,
        totalPages: Math.ceil(total / args.pageSize),
        hasNextPage: end < total,
        nextCursor: end < total ? String(args.page + 1) : null,
      },
    };
  },
});

export const getUserById = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const allUsers = await fetchAllBetterAuthUsers(ctx);
    const user = allUsers.find((candidate) => {
      try {
        return assertUserId(candidate, 'Better Auth user missing id') === args.userId;
      } catch {
        return false;
      }
    });

    if (!user) {
      return null;
    }

    return {
      id: assertUserId(user, 'Better Auth user missing id'),
      email: user.email,
      name: user.name ?? null,
    };
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

export const updateBetterAuthUser = mutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const updateData: Record<string, unknown> = {};
    if (args.name !== undefined) {
      updateData.name = args.name.trim();
    }
    if (args.email !== undefined) {
      updateData.email = args.email.trim().toLowerCase();
    }
    if (args.phoneNumber !== undefined) {
      updateData.phoneNumber = args.phoneNumber || null;
    }

    await updateBetterAuthUserRecord(ctx, args.userId, updateData);
    return { success: true };
  },
});

export const updateUserRole = mutation({
  args: {
    userId: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')),
  },
  handler: async (ctx, args) => {
    const currentAdmin = await requireSiteAdmin(ctx);
    const currentAdminId = assertUserId(currentAdmin, 'Current admin id not found');

    if (args.userId === currentAdminId && args.role !== 'admin') {
      const users = await fetchAllBetterAuthUsers(ctx);
      const adminCount = users.filter((user) => isAdminRole(user.role)).length;
      if (adminCount <= 1) {
        throwConvexError('VALIDATION', 'At least one site admin must remain');
      }
    }

    await updateBetterAuthUserRecord(ctx, args.userId, {
      role: args.role,
    });

    return { success: true };
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

export const cleanupLegacyTeams = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || args.token !== secret) {
      throw new Error('Unauthorized legacy team cleanup access');
    }

    const teams = await ctx.db.query('teams').collect();
    const now = Date.now();
    let renamedCount = 0;

    for (const team of teams) {
      const normalizedName = team.name.trim().toLowerCase();
      if (!LEGACY_TEAM_NAMES.has(normalizedName)) {
        continue;
      }

      await ctx.db.patch(team._id, {
        name: SHARED_TEAM_DEFAULT_NAME,
        updatedAt: now,
      });
      renamedCount += 1;
    }

    return {
      renamedCount,
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

export const deleteUser = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const currentAdmin = await requireSiteAdmin(ctx);
    const currentAdminId = assertUserId(currentAdmin, 'Current admin id not found');

    if (args.userId === currentAdminId) {
      throwConvexError('VALIDATION', 'Cannot delete your own account');
    }

    const allUsers = await fetchAllBetterAuthUsers(ctx);
    const target = allUsers.find((user) => {
      try {
        return assertUserId(user, 'Better Auth user missing id') === args.userId;
      } catch {
        return false;
      }
    });

    if (!target) {
      throwConvexError('NOT_FOUND', 'User not found');
    }

    if (isAdminRole(target.role)) {
      const adminCount = allUsers.filter((user) => isAdminRole(user.role)).length;
      if (adminCount <= 1) {
        throwConvexError('VALIDATION', 'Cannot delete the only site admin');
      }
    }

    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.userId))
      .first();

    if (appUser) {
      const [memberships, invites] = await Promise.all([
        ctx.db
          .query('teamUsers')
          .withIndex('by_user', (q) => q.eq('userId', appUser._id))
          .collect(),
        ctx.db
          .query('teamInvites')
          .withIndex('by_email', (q) => q.eq('email', target.email.toLowerCase()))
          .collect(),
      ]);

      for (const membership of memberships) {
        await ctx.db.delete(membership._id);
      }

      for (const invite of invites) {
        await ctx.db.delete(invite._id);
      }

      await ctx.db.delete(appUser._id);
    }

    const auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect();
    for (const log of auditLogs) {
      await ctx.db.delete(log._id);
    }

    await Promise.all([
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'session',
          where: [{ field: 'userId', operator: 'eq', value: args.userId }],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1000,
          id: 0,
        },
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'account',
          where: [{ field: 'userId', operator: 'eq', value: args.userId }],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1000,
          id: 0,
        },
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'verification',
          where: [{ field: 'identifier', operator: 'eq', value: target.email }],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1000,
          id: 0,
        },
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'user',
          where: [{ field: '_id', operator: 'eq', value: args.userId }],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1,
          id: 0,
        },
      }),
    ]);

    return { success: true };
  },
});
