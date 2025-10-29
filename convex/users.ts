import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { authComponent } from './auth';

/**
 * Check if there are any users in the system (for determining first admin)
 * Note: Better Auth manages users in betterAuth.user table
 * We check userProfiles as a proxy - if profiles exist, users exist
 * If no profiles exist, we check if this is truly the first user by checking
 * if any Better Auth user exists (via signup attempt - if it fails with USER_ALREADY_EXISTS, users exist)
 */
export const getUserCount = query({
  args: {},
  handler: async (ctx) => {
    // Check user profiles first (more reliable for determining if we've set up any users)
    const profiles = await ctx.db.query('userProfiles').collect();

    // If profiles exist, users definitely exist
    if (profiles.length > 0) {
      return {
        totalUsers: profiles.length,
        isFirstUser: false,
      };
    }

    // If no profiles exist, it could mean:
    // 1. This is truly the first user
    // 2. Users exist in Better Auth but haven't gotten profiles yet (edge case)
    // For now, we'll assume first user if no profiles exist
    // The signup flow will handle duplicate email errors from Better Auth
    return {
      totalUsers: 0,
      isFirstUser: true,
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
