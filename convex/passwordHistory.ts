import { v } from 'convex/values';
import { verifyPassword } from 'better-auth/crypto';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';

const PASSWORD_HISTORY_MAX_ENTRIES = 6;

/**
 * Check whether a candidate password matches any of the user's recent
 * password hashes. Uses scrypt comparison via Better Auth's crypto utilities.
 *
 * This is an internalAction (not a mutation) because scrypt verification
 * is CPU-intensive and must not block the deterministic mutation layer.
 */
export const checkPasswordHistory = internalAction({
  args: {
    authUserId: v.string(),
    candidatePassword: v.string(),
  },
  returns: v.object({
    reused: v.boolean(),
  }),
  handler: async (ctx, { authUserId, candidatePassword }) => {
    const entries = await ctx.runQuery(internal.passwordHistory.getRecentHashes, {
      authUserId,
    });

    for (const entry of entries) {
      const matches = await verifyPassword({
        hash: entry.passwordHash,
        password: candidatePassword,
      });
      if (matches) {
        return { reused: true };
      }
    }

    return { reused: false };
  },
});

/**
 * Internal query to fetch the most recent password hashes for a user.
 * Called by the checkPasswordHistory action above.
 */
export const getRecentHashes = internalQuery({
  args: {
    authUserId: v.string(),
  },
  returns: v.array(v.object({ passwordHash: v.string() })),
  handler: async (ctx, { authUserId }) => {
    const entries = await ctx.db
      .query('passwordHistory')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
      .collect();

    // Sort descending by createdAt and take the most recent entries.
    entries.sort((a, b) => b.createdAt - a.createdAt);
    return entries
      .slice(0, PASSWORD_HISTORY_MAX_ENTRIES)
      .map((e) => ({ passwordHash: e.passwordHash }));
  },
});

/**
 * Record a password hash in the history table and prune entries beyond
 * the maximum retention count.
 */
export const recordPasswordHash = internalMutation({
  args: {
    authUserId: v.string(),
    passwordHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { authUserId, passwordHash }) => {
    await ctx.db.insert('passwordHistory', {
      authUserId,
      passwordHash,
      createdAt: Date.now(),
    });

    // Prune entries beyond the limit.
    const entries = await ctx.db
      .query('passwordHistory')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
      .collect();

    entries.sort((a, b) => b.createdAt - a.createdAt);
    const toDelete = entries.slice(PASSWORD_HISTORY_MAX_ENTRIES);
    for (const entry of toDelete) {
      await ctx.db.delete(entry._id);
    }

    return null;
  },
});
