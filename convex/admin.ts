import { mutation } from './_generated/server';
import { authComponent } from './auth';

/**
 * Truncate application data (admin only)
 * Deletes all audit logs, preserves user data
 */
export const truncateData = mutation({
  args: {},
  handler: async (ctx) => {
    // Ensure user is authenticated and is admin
    const currentUser = await authComponent.getAuthUser(ctx);
    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const currentUserAny = currentUser as {
      id?: string;
      userId?: string;
      _id?: unknown;
    };
    const currentUserId =
      currentUserAny.id ||
      currentUserAny.userId ||
      (currentUserAny._id ? String(currentUserAny._id) : null);

    if (!currentUserId) {
      throw new Error('User ID not found');
    }

    const currentProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', currentUserId))
      .first();

    if (currentProfile?.role !== 'admin') {
      throw new Error('Admin access required');
    }

    // Delete all audit logs
    const auditLogs = await ctx.db.query('auditLogs').collect();
    let deletedCount = 0;
    let failedCount = 0;

    for (const log of auditLogs) {
      try {
        await ctx.db.delete(log._id);
        deletedCount++;
      } catch (error) {
        failedCount++;
        console.error(`Failed to delete audit log ${log._id}:`, error);
      }
    }

    // Log the truncation in audit log (before we delete it, so it won't be persisted)
    // Actually, we can't log it since we're deleting all logs
    // So we'll just return success

    return {
      success: failedCount === 0,
      message:
        failedCount === 0
          ? `All audit logs have been truncated successfully. User accounts and authentication data preserved.`
          : `Partial truncation completed. ${deletedCount} audit logs deleted, ${failedCount} failed. User accounts and authentication data preserved.`,
      truncatedTables: deletedCount > 0 ? 1 : 0,
      failedTables: failedCount > 0 ? 1 : 0,
      totalTables: 1,
      failedTableNames: failedCount > 0 ? ['auditLogs'] : [],
      invalidateAllCaches: true,
    };
  },
});
