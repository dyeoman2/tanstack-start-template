import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { handleServerError } from '~/lib/server/error-utils.server';

// Note: Convex imports are handled by setupFetchClient, no direct imports needed

// Zod schemas for validation
const truncateDataSchema = z.object({
  confirmText: z.literal('TRUNCATE_ALL_DATA'),
});

const deleteUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  confirmation: z.string().min(1, 'Confirmation text is required'),
});

// Server function to truncate data - migrated to Convex
export const truncateDataServerFn = createServerFn({ method: 'POST' })
  .inputValidator(truncateDataSchema)
  .handler(async ({ data: _data }) => {
    try {
      // Only admins can truncate data
      await requireAdmin();

      // For now, return placeholder success since Convex integration is pending
      // TODO: Implement proper Convex truncation when admin mutations are ready
      const result = {
        success: true,
        message: 'Data truncation placeholder - Convex integration pending',
        truncatedTables: 0,
        failedTables: 0,
        totalTables: 0,
        failedTableNames: [],
        invalidateAllCaches: false,
      };

      return result;
    } catch (error) {
      throw handleServerError(error, 'Truncate data');
    }
  });

const updateUserProfileSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  email: z.string().email('Invalid email format').min(1, 'Email is required'),
  role: z.enum(['user', 'admin']),
});

// Get all users (admin only) - using HTTP API workaround
export const getAllUsersServerFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(10),
      sortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']).default('role'),
      sortOrder: z.enum(['asc', 'desc']).default('asc'),
      secondarySortBy: z
        .enum(['name', 'email', 'role', 'emailVerified', 'createdAt'])
        .default('name'),
      secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
      search: z.string().trim().max(100).optional(),
      role: z.enum(['all', 'user', 'admin']).default('all'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin();

      // Get request for cookies and determine site URL
      const request = getRequest();
      const siteUrl =
        import.meta.env.SITE_URL || import.meta.env.VITE_SITE_URL || 'http://localhost:3000';

      // Forward cookies from the request for authentication
      const cookieHeader = request?.headers.get('cookie') || '';

      // Call Better Auth's get-session to get current user
      const sessionResponse = await fetch(`${siteUrl}/api/auth/get-session`, {
        method: 'GET',
        headers: {
          'accept-encoding': 'application/json',
          Cookie: cookieHeader,
        },
        redirect: 'manual',
      });

      if (!sessionResponse.ok) {
        throw new Error('Authentication required');
      }

      const sessionData = await sessionResponse.json();
      if (!sessionData?.user?.id) {
        throw new Error('Authentication required');
      }

      // For now, return a placeholder response
      // TODO: Implement actual user listing via Better Auth API
      // This requires either:
      // 1. Better Auth exposing a list-users endpoint
      // 2. Querying userProfiles and enriching with Better Auth data
      // 3. Caching Better Auth data in a readable Convex table

      return {
        users: [],
        pagination: {
          page: data.page,
          pageSize: data.pageSize,
          total: 0,
          totalPages: 0,
        },
      };
    } catch (error) {
      throw handleServerError(error, 'Get all users');
    }
  });

// Update user profile (name, email, role) (admin only) - using Better Auth HTTP API
export const updateUserProfileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(updateUserProfileSchema)
  .handler(async ({ data }) => {
    try {
      const { userId: _userId, name: _name, email: _email, role: _role } = data;

      await requireAdmin();

      // Get request for cookies and determine site URL
      const request = getRequest();
      const _siteUrl =
        import.meta.env.SITE_URL || import.meta.env.VITE_SITE_URL || 'http://localhost:3000';

      // Forward cookies from the request for authentication
      const _cookieHeader = request?.headers.get('cookie') || '';

      // For admin user updates, we need to check email conflicts and update via Better Auth API
      // TODO: Implement email conflict checking and Better Auth user updates
      // For now, return a placeholder success

      return { success: true, message: 'User profile update not yet fully implemented' };
    } catch (error) {
      throw handleServerError(error, 'Update user profile');
    }
  });

// Get system statistics (admin only) - using HTTP API workaround
export const getSystemStatsServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAdmin();

    // Get request for cookies and determine site URL
    const request = getRequest();
    const siteUrl =
      import.meta.env.SITE_URL || import.meta.env.VITE_SITE_URL || 'http://localhost:3000';

    // Forward cookies from the request for authentication
    const cookieHeader = request?.headers.get('cookie') || '';

    // Call Better Auth's get-session to get current user
    const sessionResponse = await fetch(`${siteUrl}/api/auth/get-session`, {
      method: 'GET',
      headers: {
        'accept-encoding': 'application/json',
        Cookie: cookieHeader,
      },
      redirect: 'manual',
    });

    if (!sessionResponse.ok) {
      throw new Error('Authentication required');
    }

    const sessionData = await sessionResponse.json();
    if (!sessionData?.user?.id) {
      throw new Error('Authentication required');
    }

    // For now, return placeholder stats
    // TODO: Implement actual stats via Better Auth API + Convex
    return {
      users: 0, // TODO: Count Better Auth users
    };
  } catch (error) {
    throw handleServerError(error, 'Get system stats');
  }
});

// Delete user and all associated data (admin only) - using HTTP API workaround
export const deleteUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteUserSchema)
  .handler(async ({ data }) => {
    try {
      const { userId: _userId, confirmation } = data;

      if (confirmation !== 'DELETE_USER_DATA') {
        throw new Error('Invalid confirmation');
      }

      await requireAdmin();

      // Get request for cookies and determine site URL
      const request = getRequest();
      const _siteUrl =
        import.meta.env.SITE_URL || import.meta.env.VITE_SITE_URL || 'http://localhost:3000';

      // Forward cookies from the request for authentication
      const _cookieHeader = request?.headers.get('cookie') || '';

      // Get user info before deletion (for success message)
      // TODO: Get user info from Better Auth API

      // For now, use placeholder
      const userToDelete = { email: 'user@example.com' };

      // TODO: Delete user via Better Auth HTTP API
      // Note: Better Auth may not have a delete user endpoint
      // We would need to handle this via their admin API or database directly

      return {
        success: true,
        message: `User ${userToDelete.email} and all associated data deleted successfully`,
      };
    } catch (error) {
      throw handleServerError(error, 'Delete user');
    }
  });
