import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components } from './_generated/api';
import { query } from './_generated/server';
import { authComponent } from './auth';

/**
 * Get dashboard statistics and recent activity (admin only)
 * Returns user stats and recent audit log activity
 * OPTIMIZED: No longer fetches ALL users for stats - uses userProfiles table for counts
 */
export const getDashboardData = query({
  args: {},
  handler: async (ctx) => {
    // Ensure user is authenticated and is admin
    const currentUser = await authComponent.getAuthUser(ctx);
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const currentUserId = assertUserId(currentUser, 'User ID not found');

    const currentProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', currentUserId))
      .first();

    if (currentProfile?.role !== 'admin') {
      throw new Error('Admin access required');
    }

    // Prefer cached dashboard stats, fall back to direct scan if stats doc missing
    const statsDoc = await ctx.db
      .query('dashboardStats')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();

    let totalUsers: number;
    let activeUsers: number;

    if (statsDoc) {
      totalUsers = statsDoc.totalUsers;
      activeUsers = statsDoc.activeUsers;
    } else {
      const profiles = await ctx.db.query('userProfiles').collect();
      totalUsers = profiles.length;
      activeUsers = totalUsers; // TODO: Implement proper active user logic
    }

    // Get recent signups (last 7 days) - still need to query Better Auth for this
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let recentSignups = 0;
    try {
      // Query Better Auth users created in the last 7 days (reasonable limit)
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Reasonable limit for recent signups
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
      const recentAuthUsers = normalized.page.filter((user) => {
        const userCreatedAt =
          typeof user.createdAt === 'string'
            ? new Date(user.createdAt).getTime()
            : typeof user.createdAt === 'number'
              ? user.createdAt
              : user._creationTime;
        return userCreatedAt >= sevenDaysAgo;
      });
      recentSignups = recentAuthUsers.length;
    } catch (error) {
      console.error('Failed to query recent Better Auth users:', error);
      recentSignups = 0;
    }

    // Get recent audit log activity (last 10 entries)
    const recentAuditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_createdAt')
      .order('desc')
      .take(10);

    // Create a map of user IDs to emails - only for users with recent activity
    // This is much more efficient than fetching ALL users
    const userIds = [...new Set(recentAuditLogs.map((log) => log.userId))];
    const userEmailsById = new Map<string, string>();

    // Fetch all users at once (but only the ones we need for activity)
    if (userIds.length > 0) {
      try {
        // Get all users with recent activity (typically < 10 users)
        const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'user',
          paginationOpts: {
            cursor: null,
            numItems: Math.min(userIds.length * 2, 100), // Reasonable limit based on userIds
            id: 0,
          },
        });

        const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
        for (const authUser of normalized.page) {
          const authUserId = assertUserId(authUser, 'Better Auth user missing id');
          if (userIds.includes(authUserId)) {
            userEmailsById.set(authUserId, authUser.email);
          }
        }
      } catch (error) {
        console.error('Failed to query Better Auth users for activity:', error);
      }
    }

    // Convert audit logs to activity items with real user emails
    const activity = recentAuditLogs.map((log) => ({
      id: log.id,
      type: (log.action === 'LOGIN'
        ? 'login'
        : log.action === 'SIGNUP'
          ? 'signup'
          : log.action === 'TRUNCATE_ALL_DATA'
            ? 'unknown'
            : 'unknown') as 'signup' | 'login' | 'purchase' | 'unknown',
      userEmail: userEmailsById.get(log.userId) || 'unknown@example.com',
      description: `${log.action} by user`,
      timestamp: new Date(log.createdAt).toISOString() as string & { __brand: 'IsoDateString' },
    }));

    return {
      status: 'success' as const,
      stats: {
        totalUsers,
        activeUsers,
        recentSignups,
        lastUpdated: new Date().toISOString() as string & { __brand: 'IsoDateString' },
      },
      activity,
    };
  },
});
