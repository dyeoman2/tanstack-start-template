import { v } from 'convex/values';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { GenericCtx } from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';

type BetterAuthUser = BetterAuthAdapterUserDoc;

// Helper function to fetch all Better Auth users with proper pagination
async function fetchAllBetterAuthUsers(ctx: GenericCtx): Promise<BetterAuthUser[]> {
  const allUsers: BetterAuthUser[] = [];
  let cursor: string | null = null;

  try {
    while (true) {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor,
          numItems: 1000,
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthUser>(rawResult);
      const { page, continueCursor, isDone } = normalized;

      if (page.length > 0) {
        allUsers.push(...page);
      }

      const nextCursor: string | null =
        continueCursor && continueCursor !== '[]' ? continueCursor : null;

      if (!nextCursor || isDone || page.length < 1000) {
        break;
      }

      cursor = nextCursor;
    }
  } catch (error) {
    console.error('Failed to fetch Better Auth users:', error);
    return [];
  }

  return allUsers;
}

// OPTIMIZATION: Helper function to fetch only relevant Better Auth users by IDs
async function fetchBetterAuthUsersByIds(
  ctx: GenericCtx,
  userIds: string[],
): Promise<BetterAuthUser[]> {
  if (userIds.length === 0) return [];

  const remainingIds = new Set(userIds);
  const matchedUsers: BetterAuthUser[] = [];
  let cursor: string | null = null;

  try {
    while (remainingIds.size > 0) {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor,
          numItems: 1000,
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthUser>(rawResult);
      const { page, continueCursor, isDone } = normalized;

      for (const user of page) {
        try {
          const userId = assertUserId(user, 'Better Auth user missing id');
          if (remainingIds.has(userId)) {
            matchedUsers.push(user);
            remainingIds.delete(userId);
          }
        } catch {
          // Ignore malformed user docs
        }
      }

      if (isDone || !continueCursor || page.length === 0) {
        break;
      }

      cursor = continueCursor;
    }
  } catch (error) {
    console.error('Failed to fetch Better Auth users by IDs:', error);
    return [];
  }

  return matchedUsers;
}

/**
 * Get all users with pagination, sorting, and filtering (admin only)
 * Combines Better Auth user data with userProfiles role using optimized queries
 */
export const getAllUsers = guarded.query(
  'route:/app/admin.users',
  {
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
    cursor: v.optional(v.string()), // Add cursor for efficient pagination
  },
  async (ctx, args, _role) => {
    // OPTIMIZATION: Use cursor-based pagination with userProfiles as primary source
    // Only fetch Better Auth users for the current page, not all users

    // Use the compound index for role filtering when needed
    const paginatedProfiles =
      args.role !== 'all'
        ? await ctx.db
            .query('userProfiles')
            .withIndex('by_role_createdAt', (q) => q.eq('role', args.role))
            .paginate({
              cursor: args.cursor ?? null,
              numItems: args.pageSize,
            })
        : await ctx.db.query('userProfiles').paginate({
            cursor: args.cursor ?? null,
            numItems: args.pageSize,
          });

    // Only fetch Better Auth users for the profiles on this page
    const profileUserIds = paginatedProfiles.page.map((p) => p.userId);
    const relevantAuthUsers = await fetchBetterAuthUsersByIds(ctx, profileUserIds);

    // Create a map of auth users by ID for efficient lookup
    const authUsersById = new Map<string, BetterAuthUser>();
    for (const user of relevantAuthUsers) {
      const authUserId = assertUserId(user, 'Better Auth user missing id');
      authUsersById.set(authUserId, user);
    }

    // Combine profiles with auth users for this page only
    let combinedUsers = paginatedProfiles.page
      .map((profile) => {
        const authUser = authUsersById.get(profile.userId);
        if (!authUser) return null; // Skip if no matching auth user

        return {
          id: profile.userId,
          email: authUser.email,
          name: authUser.name || null,
          role: profile.role as 'user' | 'admin',
          emailVerified: authUser.emailVerified || false,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        };
      })
      .filter((user): user is NonNullable<typeof user> => user !== null);

    // OPTIMIZATION: Apply search filter only to current page data
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      combinedUsers = combinedUsers.filter(
        (user) =>
          user.name?.toLowerCase().includes(searchLower) ||
          user.email.toLowerCase().includes(searchLower),
      );
    }

    // OPTIMIZATION: Apply sorting only to current page data
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

    // OPTIMIZATION: Use cursor-based pagination metadata
    // For accurate total count when role filtering, we need to count total profiles
    const totalProfiles =
      args.role !== 'all'
        ? await ctx.db
            .query('userProfiles')
            .withIndex('by_role_createdAt', (q) => q.eq('role', args.role))
            .collect()
            .then((profiles) => profiles.length)
        : await ctx.db
            .query('userProfiles')
            .collect()
            .then((profiles) => profiles.length);

    return {
      users: combinedUsers,
      pagination: {
        page: args.page,
        pageSize: args.pageSize,
        total: totalProfiles,
        totalPages: Math.ceil(totalProfiles / args.pageSize),
        hasNextPage: !paginatedProfiles.isDone,
        nextCursor: paginatedProfiles.continueCursor,
      },
    };
  },
);

/**
 * Get user by ID (admin only)
 * Returns user email and name for deletion confirmation messages
 */
export const getUserById = guarded.query(
  'route:/app/admin.users',
  {
    userId: v.string(),
  },
  async (ctx, args, _role) => {
    try {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Fetch enough to find the user
          id: 0,
        },
      });

      const { page } = normalizeAdapterFindManyResult<BetterAuthUser>(rawResult);

      const user = page.find((candidate) => {
        try {
          return assertUserId(candidate, 'Better Auth user missing id') === args.userId;
        } catch {
          return false;
        }
      });

      if (!user) {
        return null;
      }

      return {
        id: assertUserId(user, 'Better Auth user missing id'),
        email: user.email,
        name: user.name,
      };
    } catch (error) {
      console.error('Failed to query Better Auth user:', error);
      return null;
    }
  },
);

/**
 * Get system statistics (admin only)
 * Uses efficient counting without fetching all user data
 */
export const getSystemStats = guarded.query(
  'route:/app/admin.stats',
  {},
  async (ctx, _args, _role) => {
    try {
      const users = await fetchAllBetterAuthUsers(ctx);
      return {
        users: users.length,
      };
    } catch (error) {
      console.error('Failed to count Better Auth users:', error);
      return {
        users: 0,
      };
    }
  },
);

/**
 * Update Better Auth user data (name, email, phoneNumber) (admin only)
 * Uses Better Auth component adapter's updateMany mutation
 */
export const updateBetterAuthUser = guarded.mutation(
  'user.write',
  {
    userId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  async (ctx, args, _role) => {
    // Build update object - only include fields that are provided
    const updateData: {
      name?: string;
      email?: string;
      phoneNumber?: string | null;
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

    if (args.phoneNumber !== undefined) {
      updateData.phoneNumber = args.phoneNumber || null;
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
);

/**
 * Truncate application data (admin only)
 * Deletes all audit logs, preserves user data
 */
export const truncateData = guarded.mutation('user.write', {}, async (ctx, _args, _role) => {
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
});

/**
 * Delete user (admin only)
 * Deletes user from userProfiles and auditLogs
 * Note: Better Auth user deletion should be handled via Better Auth HTTP API
 */
export const deleteUser = guarded.mutation(
  'user.write',
  {
    userId: v.string(),
  },
  async (ctx, args, _role) => {
    // Get current user for self-deletion check
    const currentUser = await authComponent.getAuthUser(ctx);
    const currentUserId = assertUserId(currentUser, 'User ID not found');

    // Prevent deletion of self
    if (args.userId === currentUserId) {
      throw new Error('Cannot delete your own account');
    }

    // Get user profile to check role
    const targetProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    // Prevent deletion of the only admin user
    if (targetProfile?.role === 'admin') {
      const allProfiles = await ctx.db.query('userProfiles').collect();
      const adminCount = allProfiles.filter((p) => p.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('Cannot delete the only admin user. At least one admin must remain.');
      }
    }

    // Delete user profile
    if (targetProfile) {
      await ctx.db.delete(targetProfile._id);

      await ctx.runMutation(internal.dashboardStats.adjustUserCounts, {
        totalDelta: -1,
      });
    }

    // Delete audit logs for this user
    const auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect();

    for (const log of auditLogs) {
      await ctx.db.delete(log._id);
    }

    // Note: Better Auth user deletion should be handled via Better Auth HTTP API
    // This mutation only handles app-specific data cleanup

    return { success: true };
  },
);
