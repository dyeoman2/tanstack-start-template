import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation } from './_generated/server';
import { dashboardCountsValidator } from './lib/returnValidators';

const DASHBOARD_STATS_KEY = 'global';
const USER_COUNT_BATCH_SIZE = 256;
type DashboardStatsDoc = Doc<'dashboardStats'>;

async function countUsers(ctx: MutationCtx) {
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

async function listDashboardStatsDocs(ctx: MutationCtx) {
  return await ctx.db
    .query('dashboardStats')
    .withIndex('by_key', (q) => q.eq('key', DASHBOARD_STATS_KEY))
    .collect();
}

function selectCanonicalDashboardStatsDoc(statsDocs: DashboardStatsDoc[]) {
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

async function upsertDashboardStats(
  ctx: MutationCtx,
  nextValue: {
    totalUsers: number;
    activeUsers: number;
    updatedAt: number;
  },
) {
  const statsDocs = await listDashboardStatsDocs(ctx);
  const canonicalDoc = selectCanonicalDashboardStatsDoc(statsDocs);

  if (!canonicalDoc) {
    const insertedId = await ctx.db.insert('dashboardStats', {
      key: DASHBOARD_STATS_KEY,
      ...nextValue,
    });
    const insertedDoc = await ctx.db.get(insertedId);

    if (!insertedDoc) {
      return;
    }

    const insertedDocs = await listDashboardStatsDocs(ctx);
    await Promise.all(
      insertedDocs
        .filter((doc) => doc._id !== insertedDoc._id)
        .map((doc) => ctx.db.delete(doc._id)),
    );
    return;
  }

  await ctx.db.patch(canonicalDoc._id, nextValue);
  await Promise.all(
    statsDocs.filter((doc) => doc._id !== canonicalDoc._id).map((doc) => ctx.db.delete(doc._id)),
  );
}

export const adjustUserCounts = internalMutation({
  args: {
    totalDelta: v.number(),
    activeDelta: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const activeDelta = args.activeDelta ?? args.totalDelta;
    const statsDoc = selectCanonicalDashboardStatsDoc(await listDashboardStatsDocs(ctx));

    if (!statsDoc) {
      const totalUsers = await countUsers(ctx);
      await upsertDashboardStats(ctx, {
        totalUsers,
        activeUsers: totalUsers,
        updatedAt: now,
      });
      return null;
    }

    await upsertDashboardStats(ctx, {
      totalUsers: Math.max(0, statsDoc.totalUsers + args.totalDelta),
      activeUsers: Math.max(0, statsDoc.activeUsers + activeDelta),
      updatedAt: now,
    });

    return null;
  },
});

export const recomputeUserCounts = internalMutation({
  args: {},
  returns: dashboardCountsValidator,
  handler: async (ctx) => {
    const totalUsers = await countUsers(ctx);
    const activeUsers = totalUsers;
    const now = Date.now();

    await upsertDashboardStats(ctx, {
      totalUsers,
      activeUsers,
      updatedAt: now,
    });

    return { totalUsers, activeUsers, updatedAt: now };
  },
});
