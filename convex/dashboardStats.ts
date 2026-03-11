import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

const DASHBOARD_STATS_KEY = 'global';

export const adjustUserCounts = internalMutation({
  args: {
    totalDelta: v.number(),
    activeDelta: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const statsDoc = await ctx.db
      .query('dashboardStats')
      .withIndex('by_key', (q) => q.eq('key', DASHBOARD_STATS_KEY))
      .first();

    const now = Date.now();
    const activeDelta = args.activeDelta ?? args.totalDelta;

    if (!statsDoc) {
      const users = await ctx.db.query('users').collect();
      const totalUsers = users.length;
      const activeUsers = totalUsers;

      await ctx.db.insert('dashboardStats', {
        key: DASHBOARD_STATS_KEY,
        totalUsers,
        activeUsers,
        updatedAt: now,
      });
      return;
    }

    const nextTotal = Math.max(0, statsDoc.totalUsers + args.totalDelta);
    const nextActive = Math.max(0, statsDoc.activeUsers + activeDelta);

    await ctx.db.patch(statsDoc._id, {
      totalUsers: nextTotal,
      activeUsers: nextActive,
      updatedAt: now,
    });
  },
});

export const recomputeUserCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();
    const totalUsers = users.length;
    const activeUsers = totalUsers;

    const statsDoc = await ctx.db
      .query('dashboardStats')
      .withIndex('by_key', (q) => q.eq('key', DASHBOARD_STATS_KEY))
      .first();

    const now = Date.now();

    if (!statsDoc) {
      await ctx.db.insert('dashboardStats', {
        key: DASHBOARD_STATS_KEY,
        totalUsers,
        activeUsers,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(statsDoc._id, {
        totalUsers,
        activeUsers,
        updatedAt: now,
      });
    }

    return { totalUsers, activeUsers, updatedAt: now };
  },
});
