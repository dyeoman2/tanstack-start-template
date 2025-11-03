import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components } from './_generated/api';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { authComponent } from './auth';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function countSignupsSince(ctx: QueryCtx, since: number) {
  try {
    // Use collect() instead of pagination for counting - simpler and avoids cursor issues
    // For admin dashboard stats, the number of recent signups should be manageable
    const recentLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', since))
      .collect();

    const signupCount = recentLogs.filter((log) => log.action === 'SIGNUP').length;

    return signupCount;
  } catch (error) {
    console.error(`❌ Error counting signups:`, error);
    // Fallback: return 0 on error
    return 0;
  }
}

/**
 * Get dashboard statistics and recent activity (admin only)
 * Returns user stats and recent audit log activity
 * OPTIMIZED: No longer fetches ALL users for stats - uses userProfiles table for counts
 *
 * NOTE: We intentionally keep this as a plain `query` instead of `guarded.query`.
 * Returning `null` for non-admin callers allows the client to render a friendly
 * fallback instead of hitting the route error boundary on authorization failures.
 */
export const getDashboardData = query({
  args: {},
  handler: async (ctx) => {
    // ✅ Handle unauthenticated users gracefully - return null instead of throwing
    // This prevents errors when users navigate to dashboard after sign out
    const currentUser = await authComponent.getAuthUser(ctx);
    if (!currentUser) {
      return null;
    }

    const currentUserId = assertUserId(currentUser, 'User ID not found');

    const currentProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', currentUserId))
      .first();

    if (currentProfile?.role !== 'admin') {
      return null;
    }

    // Prefer cached dashboard stats, fall back to direct scan if stats doc missing
    const now = Date.now();
    const sevenDaysAgo = now - SEVEN_DAYS_MS;

    const [statsDoc, recentAuditLogs, recentSignups] = await Promise.all([
      ctx.db
        .query('dashboardStats')
        .withIndex('by_key', (q) => q.eq('key', 'global'))
        .first(),
      ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').take(10),
      countSignupsSince(ctx, sevenDaysAgo),
    ]);

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
      } catch {
        // Silently handle Better Auth query failures
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
        lastUpdated: new Date(now).toISOString() as string & { __brand: 'IsoDateString' },
      },
      activity,
    };
  },
});
