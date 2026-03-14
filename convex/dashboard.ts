import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { getVerifiedCurrentAuthUserOrNull } from './auth/access';
import { dashboardDataValidator } from './lib/returnValidators';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNUP_COUNT_BATCH_SIZE = 256;
type DashboardStatsDoc = Doc<'dashboardStats'>;
type UserProfileSyncStateDoc = Doc<'userProfileSyncState'>;

async function countSignupsSince(ctx: QueryCtx, since: number) {
  try {
    let cursor: string | null = null;
    let count = 0;

    while (true) {
      const result = await ctx.db
        .query('auditLogs')
        .withIndex('by_eventType_and_createdAt', (q) =>
          q.eq('eventType', 'user_signed_up').gte('createdAt', since),
        )
        .paginate({
          cursor,
          numItems: SIGNUP_COUNT_BATCH_SIZE,
        });

      count += result.page.length;

      if (result.isDone) {
        return count;
      }

      cursor = result.continueCursor;
    }
  } catch (error) {
    console.error(`❌ Error counting signups:`, error);
    // Fallback: return 0 on error
    return 0;
  }
}

async function getCanonicalDashboardStats(ctx: QueryCtx) {
  const statsDocs = await ctx.db
    .query('dashboardStats')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .collect();

  return statsDocs.reduce<DashboardStatsDoc | null>((current, candidate) => {
    if (!current) {
      return candidate;
    }

    if (candidate.updatedAt !== current.updatedAt) {
      return candidate.updatedAt > current.updatedAt ? candidate : current;
    }

    return candidate._creationTime > current._creationTime ? candidate : current;
  }, null);
}

async function getCanonicalUserProfileSyncState(ctx: QueryCtx) {
  const syncStates = await ctx.db
    .query('userProfileSyncState')
    .withIndex('by_key', (q) => q.eq('key', 'global'))
    .collect();

  return syncStates.reduce<UserProfileSyncStateDoc | null>((current, candidate) => {
    if (!current) {
      return candidate;
    }

    if (candidate.lastFullSyncAt !== current.lastFullSyncAt) {
      return candidate.lastFullSyncAt > current.lastFullSyncAt ? candidate : current;
    }

    return candidate._creationTime > current._creationTime ? candidate : current;
  }, null);
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

    // Prefer cached aggregates and lightweight sync state over full-table scans.
    const sevenDaysAgo = args.asOf - SEVEN_DAYS_MS;

    const [statsDoc, syncState, recentSignups] = await Promise.all([
      getCanonicalDashboardStats(ctx),
      getCanonicalUserProfileSyncState(ctx),
      countSignupsSince(ctx, sevenDaysAgo),
    ]);

    const totalUsers = statsDoc?.totalUsers ?? syncState?.totalUsers ?? 0;
    const activeUsers = statsDoc?.activeUsers ?? totalUsers;
    const lastUpdated = statsDoc?.updatedAt ?? syncState?.lastFullSyncAt ?? args.asOf;

    return {
      status: 'success' as const,
      stats: {
        totalUsers,
        activeUsers,
        recentSignups,
        lastUpdated: new Date(lastUpdated).toISOString() as string & { __brand: 'IsoDateString' },
      },
    };
  },
});
