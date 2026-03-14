import { v } from 'convex/values';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { getVerifiedCurrentAuthUserOrNull } from './auth/access';
import { dashboardDataValidator } from './lib/returnValidators';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const USER_COUNT_BATCH_SIZE = 256;

async function countUsers(ctx: QueryCtx) {
  let cursor: string | null = null;
  let totalUsers = 0;

  while (true) {
    const result = await ctx.db.query('users').paginate({
      cursor,
      numItems: USER_COUNT_BATCH_SIZE,
    });

    totalUsers += result.page.length;

    if (result.isDone) {
      return totalUsers;
    }

    cursor = result.continueCursor;
  }
}

async function countSignupsSince(ctx: QueryCtx, since: number) {
  try {
    const recentLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_eventType_and_createdAt', (q) =>
        q.eq('eventType', 'user_signed_up').gte('createdAt', since),
      )
      .collect();

    return recentLogs.length;
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
  args: {
    asOf: v.number(),
  },
  returns: dashboardDataValidator,
  handler: async (ctx, args) => {
    // Return explicit access states so the client can render one stable branch.
    const currentUser = await getVerifiedCurrentAuthUserOrNull(ctx);
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
    const sevenDaysAgo = args.asOf - SEVEN_DAYS_MS;

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
      totalUsers = await countUsers(ctx);
      activeUsers = totalUsers; // TODO: Implement proper active user logic
    }

    return {
      status: 'success' as const,
      stats: {
        totalUsers,
        activeUsers,
        recentSignups,
        lastUpdated: new Date(args.asOf).toISOString() as string & { __brand: 'IsoDateString' },
      },
    };
  },
});
