import { v } from 'convex/values';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';

/**
 * Check if there are any users in the system (for determining first admin)
 * Queries Better Auth's user table directly for accurate count
 */
export const getUserCount = query({
  args: {},
  handler: async (ctx) => {
    // Use Better Auth component's findMany query to get all users
    let allUsers: BetterAuthAdapterUserDoc[] = [];
    try {
      // Query all users using component's findMany query
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Get all users (assuming less than 1000 for user count)
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
      allUsers = normalized.page;
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
      allUsers = [];
    }

    const totalUsers = allUsers.length;
    const isFirstUser = totalUsers === 0;

    return {
      totalUsers,
      isFirstUser,
    };
  },
});

/**
 * Create or update a user profile with role
 * This stores app-specific user data separate from Better Auth's user table
 */
export const setUserRole = guarded.mutation(
  'user.bootstrap', // Public capability but with strict bootstrap logic
  {
    userId: v.string(), // Better Auth user ID
    role: v.string(), // 'user' | 'admin'
    allowBootstrap: v.optional(v.boolean()), // Special flag for first user signup
  },
  async (ctx, args, role) => {
    // Validate role
    if (args.role !== 'user' && args.role !== 'admin') {
      throw new Error('Invalid role. Must be "user" or "admin"');
    }

    // Check if this is a bootstrap operation (first user creation)
    // Allow bootstrap without admin authentication for initial setup
    if (!args.allowBootstrap) {
      // For non-bootstrap operations, ensure caller has admin role
      if (role !== 'admin') {
        throw new Error('Admin privileges required for role management');
      }
    } else {
      // BOOTSTRAP: Allow only when no other user profiles exist (idempotent for the same user)
      const existingProfiles = await ctx.db.query('userProfiles').collect();
      const nonBootstrapProfile = existingProfiles.find(
        (profile) => profile.userId !== args.userId,
      );

      if (nonBootstrapProfile) {
        throw new Error('Bootstrap not allowed - another user profile already exists');
      }
    }

    // Check if profile already exists
    const existingProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    const now = Date.now();

    if (existingProfile) {
      // Update existing profile
      await ctx.db.patch(existingProfile._id, {
        role: args.role,
        updatedAt: now,
      });
    } else {
      // Create new profile
      await ctx.db.insert('userProfiles', {
        userId: args.userId,
        role: args.role,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.runMutation(internal.dashboardStats.adjustUserCounts, {
        totalDelta: 1,
      });
    }

    return { success: true };
  },
);

/**
 * Update current user's profile (name, phoneNumber)
 * Uses Better Auth component adapter's updateMany mutation
 * Only allows users to update their own profile
 */
export const updateCurrentUserProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get current user
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('User not authenticated');
    }

    const userId = assertUserId(authUser, 'User ID not found in auth user');

    // Build update object - only include fields that are provided
    const updateData: {
      name?: string;
      phoneNumber?: string | null;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updateData.name = args.name.trim();
    }

    if (args.phoneNumber !== undefined) {
      updateData.phoneNumber = args.phoneNumber || null;
    }

    // Use Better Auth component adapter's updateMany mutation
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        update: updateData,
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: userId,
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
 * Get current user profile (Better Auth user data + app-specific role)
 * Combines Better Auth user data with userProfiles role
 * Returns null if user is not authenticated (for useAuth hook compatibility)
 */
export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    // Get Better Auth user via authComponent
    // Note: This should be cached by Convex since we're in an authenticated context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let authUser: any;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {
      // Better Auth throws "Unauthenticated" error when session is invalid
      // Return null to allow conditional usage in useAuth hook
      return null;
    }

    if (!authUser) {
      // Return null instead of throwing to allow conditional usage in useAuth hook
      return null;
    }

    // Better Auth Convex adapter returns the Convex document with _id
    const userId = assertUserId(authUser, 'User ID not found in auth user');

    // Get role from userProfiles - this is a fast indexed query
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    // Convert Better Auth timestamps (ISO strings or numbers) to Unix timestamps
    const createdAt = authUser.createdAt
      ? typeof authUser.createdAt === 'string'
        ? new Date(authUser.createdAt).getTime()
        : authUser.createdAt
      : Date.now();
    const updatedAt = authUser.updatedAt
      ? typeof authUser.updatedAt === 'string'
        ? new Date(authUser.updatedAt).getTime()
        : authUser.updatedAt
      : Date.now();

    return {
      id: userId, // Better Auth user ID
      email: authUser.email,
      name: authUser.name || null,
      phoneNumber: authUser.phoneNumber || null,
      role: profile?.role || 'user', // Default to 'user' if no profile exists
      emailVerified: authUser.emailVerified || false,
      createdAt,
      updatedAt,
    };
  },
});

/**
 * Update user role (for admin operations)
 * SECURITY: Requires authenticated admin caller
 */
export const updateUserRole = guarded.mutation(
  'user.write',
  {
    userId: v.string(),
    role: v.string(),
  },
  async (ctx, args, _role) => {
    // Validate role
    if (args.role !== 'user' && args.role !== 'admin') {
      throw new Error('Invalid role. Must be "user" or "admin"');
    }

    // Update role in userProfiles
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (!profile) {
      throw new Error('User profile not found');
    }

    await ctx.db.patch(profile._id, {
      role: args.role,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
);
