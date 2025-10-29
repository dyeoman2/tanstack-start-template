import { v } from 'convex/values';
import { components } from './_generated/api';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';

/**
 * Get all users with pagination, sorting, and filtering (admin only)
 * Combines Better Auth user data with userProfiles role
 */
export const getAllUsers = query({
  args: {
    page: v.number(),
    pageSize: v.number(),
    sortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('role'),
      v.literal('emailVerified'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    secondarySortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('role'),
      v.literal('emailVerified'),
      v.literal('createdAt'),
    ),
    secondarySortOrder: v.union(v.literal('asc'), v.literal('desc')),
    search: v.optional(v.string()),
    role: v.union(v.literal('all'), v.literal('user'), v.literal('admin')),
  },
  handler: async (ctx, args) => {
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

    // Query Better Auth's user table directly
    // Component tables might be: 'betterAuth_user', 'betterAuth_users', or accessed via component db
    type BetterAuthUser = {
      _id: string;
      email: string;
      name: string | null;
      emailVerified: boolean;
      phoneNumber?: string | null;
      createdAt: string | number;
      updatedAt: string | number;
      _creationTime: number;
    };

    // Access Better Auth users via component's adapter.findMany query
    // Component tables are accessed through the component's internal queries
    let allAuthUsers: BetterAuthUser[] = [];
    try {
      // Use Better Auth component's findMany query to get all users
      // This is the proper way to query component tables in Convex
      // Query all users using component's findMany query with pagination
      const batchSize = 1000; // Get all users in batches
      let cursor: string | null = null;
      let hasMore = true;

      while (hasMore) {
        // biome-ignore lint/suspicious/noExplicitAny: Better Auth adapter return types
        const result: any = await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'user',
          paginationOpts: {
            cursor,
            numItems: batchSize,
            id: 0, // Not used, but required by the API
          },
        });

        // Result format: { continueCursor: string, isDone: boolean, page: [...] }

        // Better Auth adapter.findMany returns users in result.page array
        // Format: { continueCursor: string, isDone: boolean, page: [...] }
        let users: BetterAuthUser[] = [];
        if (Array.isArray(result)) {
          // Direct array response
          users = result as BetterAuthUser[];
        } else if (result?.page && Array.isArray(result.page)) {
          // { page: [...] } format - this is the actual format used by Better Auth
          users = result.page as BetterAuthUser[];
        } else if (result?.data && Array.isArray(result.data)) {
          // { data: [...] } format (fallback)
          users = result.data as BetterAuthUser[];
        } else if (result?.results && Array.isArray(result.results)) {
          // { results: [...] } format (fallback)
          users = result.results as BetterAuthUser[];
        } else if (result?.items && Array.isArray(result.items)) {
          // { items: [...] } format (fallback)
          users = result.items as BetterAuthUser[];
        }

        if (users.length > 0) {
          allAuthUsers.push(...users);
        }

        // Check if there are more results
        // Better Auth uses continueCursor and isDone for pagination
        const continueCursor = result?.continueCursor;
        const isDone = result?.isDone === true;

        // Parse continueCursor - it's a JSON string like "[]" when done
        let nextCursor: string | null = null;
        if (continueCursor && continueCursor !== '[]' && !isDone) {
          try {
            const parsed = JSON.parse(continueCursor);
            if (parsed && parsed.length > 0) {
              nextCursor = continueCursor;
            }
          } catch {
            // If it's not JSON, use it as-is if it's not empty
            if (continueCursor && continueCursor.trim() !== '[]') {
              nextCursor = continueCursor;
            }
          }
        }

        hasMore = !isDone && !!nextCursor && users.length === batchSize;
        cursor = nextCursor;

        // Safety check: if we got fewer than batchSize, we're done
        if (users.length < batchSize) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('Failed to query Better Auth users via component API:', error);
      allAuthUsers = [];
    }

    // Get all userProfiles to join roles
    const allUserProfiles = await ctx.db.query('userProfiles').collect();
    const profilesByUserId = new Map(allUserProfiles.map((profile) => [profile.userId, profile]));

    // Combine Better Auth user data with userProfiles roles
    let combinedUsers = allAuthUsers.map((authUser) => {
      // Extract user ID from Better Auth document
      // Better Auth uses _id as the document ID, which is also the user.id
      const userId = String(authUser._id);
      const profile = profilesByUserId.get(userId);

      // Convert Better Auth timestamps to Unix timestamps
      const authCreatedAt =
        typeof authUser.createdAt === 'string'
          ? new Date(authUser.createdAt).getTime()
          : typeof authUser.createdAt === 'number'
            ? authUser.createdAt
            : Date.now();
      const authUpdatedAt =
        typeof authUser.updatedAt === 'string'
          ? new Date(authUser.updatedAt).getTime()
          : typeof authUser.updatedAt === 'number'
            ? authUser.updatedAt
            : Date.now();

      return {
        id: userId,
        email: authUser.email,
        name: authUser.name || null,
        role: (profile?.role || 'user') as 'user' | 'admin',
        emailVerified: authUser.emailVerified || false,
        createdAt: profile ? profile.createdAt : authCreatedAt, // Use profile timestamp if available
        updatedAt: profile ? profile.updatedAt : authUpdatedAt,
      };
    });

    // Filter by role if needed
    if (args.role !== 'all') {
      combinedUsers = combinedUsers.filter((user) => user.role === args.role);
    }

    // Apply search filter
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      combinedUsers = combinedUsers.filter(
        (user) =>
          user.name?.toLowerCase().includes(searchLower) ||
          user.email.toLowerCase().includes(searchLower),
      );
    }

    // Apply sorting
    const getSortValue = (
      user: (typeof combinedUsers)[number],
      field: typeof args.sortBy,
    ): string | number => {
      switch (field) {
        case 'name':
          return user.name?.toLowerCase() || '';
        case 'email':
          return user.email.toLowerCase();
        case 'role':
          return user.role;
        case 'emailVerified':
          return user.emailVerified ? 1 : 0;
        case 'createdAt':
          return user.createdAt;
        default:
          return user.createdAt;
      }
    };

    combinedUsers.sort((a, b) => {
      const primaryA = getSortValue(a, args.sortBy);
      const primaryB = getSortValue(b, args.sortBy);
      const primaryCompare =
        args.sortOrder === 'asc'
          ? primaryA > primaryB
            ? 1
            : primaryA < primaryB
              ? -1
              : 0
          : primaryA < primaryB
            ? 1
            : primaryA > primaryB
              ? -1
              : 0;

      if (primaryCompare !== 0) {
        return primaryCompare;
      }

      // Secondary sort
      const secondaryA = getSortValue(a, args.secondarySortBy);
      const secondaryB = getSortValue(b, args.secondarySortBy);
      return args.secondarySortOrder === 'asc'
        ? secondaryA > secondaryB
          ? 1
          : secondaryA < secondaryB
            ? -1
            : 0
        : secondaryA < secondaryB
          ? 1
          : secondaryA > secondaryB
            ? -1
            : 0;
    });

    // Apply pagination
    const total = combinedUsers.length;
    const offset = (args.page - 1) * args.pageSize;
    const paginatedUsers = combinedUsers.slice(offset, offset + args.pageSize);

    return {
      users: paginatedUsers,
      pagination: {
        page: args.page,
        pageSize: args.pageSize,
        total,
        totalPages: Math.ceil(total / args.pageSize),
      },
    };
  },
});

/**
 * Get system statistics (admin only)
 */
export const getSystemStats = query({
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

    // Query Better Auth users directly via component's findMany query
    type BetterAuthUser = {
      _id: string;
    };

    let allUsers: BetterAuthUser[] = [];
    try {
      // Use Better Auth component's findMany query
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth adapter return types
      const result: any = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Get all users for count
          id: 0,
        },
      });

      // Better Auth adapter.findMany returns users in result.page array
      allUsers = (result?.page ||
        result?.data ||
        (Array.isArray(result) ? result : [])) as BetterAuthUser[];
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
      allUsers = [];
    }

    return {
      users: allUsers.length,
    };
  },
});

/**
 * Update Better Auth user data (name, email) (admin only)
 * Uses Better Auth component adapter's updateMany mutation
 */
export const updateBetterAuthUser = mutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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

    // Build update object - only include fields that are provided
    const updateData: {
      name?: string;
      email?: string;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updateData.name = args.name.trim();
    }

    if (args.email !== undefined) {
      updateData.email = args.email.toLowerCase().trim();
    }

    // Use Better Auth component adapter's updateMany mutation
    // This allows admin updates including email changes
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        update: updateData,
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: args.userId,
          },
        ],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1, // Only updating one user
        id: 0, // Not used but required
      },
    });

    return { success: true };
  },
});

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
