import { query } from './_generated/server';
import { authComponent } from './auth';

/**
 * Get dashboard statistics and recent activity (admin only)
 * Returns user stats and recent audit log activity
 */
export const getDashboardData = query({
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

    // Get user statistics from userProfiles
    const allProfiles = await ctx.db.query('userProfiles').collect();
    const totalUsers = allProfiles.length;
    const adminCount = allProfiles.filter((p) => p.role === 'admin').length;
    const _userCount = totalUsers - adminCount;

    // For now, return placeholder data for active users and recent signups
    // In a real app, you'd track these metrics differently
    const activeUsers = totalUsers; // Placeholder: assume all users are "active"
    const recentSignups = 0; // Placeholder: would need signup tracking

    // Get recent audit log activity (last 10 entries)
    const recentAuditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_createdAt')
      .order('desc')
      .take(10);

    // Convert audit logs to activity items
    const activity = recentAuditLogs.map((log) => ({
      id: log.id,
      type: (log.action === 'LOGIN'
        ? 'login'
        : log.action === 'SIGNUP'
          ? 'signup'
          : log.action === 'TRUNCATE_ALL_DATA'
            ? 'unknown'
            : 'unknown') as 'signup' | 'login' | 'purchase' | 'unknown',
      userEmail: 'user@example.com', // Would need to join with user data
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
