import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { getCurrentAuthUserOrNull } from './auth/access';

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
 * Get dashboard statistics (admin only)
 * Returns user stats for the dashboard cards
 * OPTIMIZED: No longer fetches ALL users for stats - uses userProfiles table for counts
 *
 * NOTE: We intentionally keep this as a plain `query`.
 * Returning explicit access states lets the client render a friendly fallback
 * instead of hitting the route error boundary on authorization failures.
 */
export const getDashboardData = query({
  args: {},
  handler: async (ctx) => {
    // Return explicit access states so the client can render one stable branch.
    const currentUser = await getCurrentAuthUserOrNull(ctx);
    if (!currentUser) {
      return {
        status: 'unauthenticated' as const,
      };
    }

    if (!deriveIsSiteAdmin(normalizeUserRole((currentUser as { role?: string | string[] }).role))) {
      return {
        status: 'forbidden' as const,
      };
    }

    // Prefer cached dashboard stats, fall back to direct scan if stats doc missing
    const now = Date.now();
    const sevenDaysAgo = now - SEVEN_DAYS_MS;

    const [statsDoc, recentSignups] = await Promise.all([
      ctx.db
        .query('dashboardStats')
        .withIndex('by_key', (q) => q.eq('key', 'global'))
        .first(),
      countSignupsSince(ctx, sevenDaysAgo),
    ]);

    let totalUsers: number;
    let activeUsers: number;

    if (statsDoc) {
      totalUsers = statsDoc.totalUsers;
      activeUsers = statsDoc.activeUsers;
    } else {
      const users = await ctx.db.query('users').collect();
      totalUsers = users.length;
      activeUsers = totalUsers; // TODO: Implement proper active user logic
    }

    return {
      status: 'success' as const,
      stats: {
        totalUsers,
        activeUsers,
        recentSignups,
        lastUpdated: new Date(now).toISOString() as string & { __brand: 'IsoDateString' },
      },
    };
  },
});
