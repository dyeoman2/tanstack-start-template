import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { isAdminRole } from './auth/access';
import { throwConvexError } from './auth/errors';
import {
  fetchAllBetterAuthUsers,
  findBetterAuthUserByEmail,
  updateBetterAuthUserRecord,
} from './lib/betterAuth';

async function requireSiteAdmin(ctx: QueryCtx | MutationCtx) {
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
