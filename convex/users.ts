import { v } from 'convex/values';
import { components } from './_generated/api';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';

/**
 * Check if there are any users in the system (for determining first admin)
 * Queries Better Auth's user table directly for accurate count
 */
export const getUserCount = query({
  args: {},
  handler: async (ctx) => {
    // Query Better Auth users directly - try different access methods
    type BetterAuthUser = {
      _id: string;
    };

    // Use Better Auth component's findMany query to get all users
    let allUsers: BetterAuthUser[] = [];
    try {
      // Query all users using component's findMany query
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth adapter return types
      const result: any = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Get all users (assuming less than 1000 for user count)
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
export const setUserRole = mutation({
  args: {
    userId: v.string(), // Better Auth user ID
    role: v.string(), // 'user' | 'admin'
  },
  handler: async (ctx, args) => {
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
    }

    return { success: true };
  },
});

// Note: User profile updates (name, phoneNumber) are handled via Better Auth's HTTP API
// in src/features/profile/server/profile.server.ts
// We don't need a Convex mutation for this since Better Auth manages user data
// and exposes update endpoints via its HTTP handler

/**
 * Get current user profile (Better Auth user data + app-specific role)
 * Combines Better Auth user data with userProfiles role
 * Requires authentication - returns current authenticated user
 */
export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    // Get Better Auth user via authComponent
    const authUser = await authComponent.getAuthUser(ctx);

    if (!authUser) {
      throw new Error('User not authenticated');
    }

    // Better Auth Convex adapter returns the Convex document with _id
    // The _id (Convex Id type) is the Better Auth user ID
    // Convert _id to string - Convex Id types can be used as strings
    const authUserAny = authUser as {
      id?: string;
      userId?: string;
      _id?: unknown;
    };

    // Extract user ID: prefer id/userId, fallback to _id converted to string
    const userId =
      authUserAny.id || authUserAny.userId || (authUserAny._id ? String(authUserAny._id) : null);

    if (!userId) {
      throw new Error('User ID not found in auth user');
    }

    // Get role from userProfiles
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
