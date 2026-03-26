import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

const LOCKOUT_WINDOW_MS = 15 * 60 * 1_000; // 15 minutes
const LOCKOUT_MAX_FAILURES = 5;

/**
 * Record a failed sign-in attempt for an email address.
 *
 * Prunes stale timestamps outside the lockout window, appends the current
 * timestamp, and returns whether the threshold has been reached.
 */
export const recordFailedAttempt = internalMutation({
  args: {
    email: v.string(),
  },
  returns: v.object({
    shouldLock: v.boolean(),
  }),
  handler: async (ctx, { email }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('authLockoutAttempts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();

    const previousAttempts = existing?.attempts ?? [];
    const recentAttempts = previousAttempts.filter((ts) => now - ts < LOCKOUT_WINDOW_MS);
    recentAttempts.push(now);

    if (existing) {
      await ctx.db.patch(existing._id, {
        attempts: recentAttempts,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('authLockoutAttempts', {
        email,
        attempts: recentAttempts,
        updatedAt: now,
      });
    }

    return { shouldLock: recentAttempts.length >= LOCKOUT_MAX_FAILURES };
  },
});

/**
 * Clear all failed sign-in attempts for an email address.
 *
 * Called after a successful sign-in or after a lockout ban is applied
 * so the counter resets cleanly.
 */
export const clearFailedAttempts = internalMutation({
  args: {
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query('authLockoutAttempts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});
