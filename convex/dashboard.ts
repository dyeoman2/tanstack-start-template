import { components } from './_generated/api';
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

    // Query Better Auth users - access via component database context
    type BetterAuthUser = {
      _id: string;
      email: string;
      name: string | null;
      emailVerified: boolean;
      createdAt: string | number;
      updatedAt: string | number;
      _creationTime: number;
    };

    // Access Better Auth users via component's findMany query
    let allAuthUsers: BetterAuthUser[] = [];
    try {
      // Use Better Auth component's findMany query to get all users
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth adapter return types
      const result: any = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Get all users for dashboard stats
          id: 0,
        },
      });
      
      // Better Auth adapter.findMany returns users in result.page array
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth adapter return types
      allAuthUsers = (result?.page || result?.data || (Array.isArray(result) ? result : [])) as BetterAuthUser[];
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
      allAuthUsers = [];
    }

    const totalUsers = allAuthUsers.length;

    // Calculate active users (users who have logged in recently - last 30 days)
    // For now, we'll use totalUsers as activeUsers since we don't track last login
    // In a real app, you'd track last activity separately
    const activeUsers = totalUsers;

    // Calculate recent signups (last 7 days)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentSignups = allAuthUsers.filter((user) => {
      const userCreatedAt =
        typeof user.createdAt === 'string'
          ? new Date(user.createdAt).getTime()
          : typeof user.createdAt === 'number'
            ? user.createdAt
            : user._creationTime;
      return userCreatedAt >= sevenDaysAgo;
    }).length;

    // Get recent audit log activity (last 10 entries)
    const recentAuditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_createdAt')
      .order('desc')
      .take(10);

    // Create a map of user IDs to emails for efficient lookups
    const userEmailsById = new Map(allAuthUsers.map((user) => [String(user._id), user.email]));

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
      userEmail: userEmailsById.get(log.userId) || 'unknown@example.com', // Real email from Better Auth
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
