import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { handleServerError } from '~/lib/server/error-utils.server';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

const deleteUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  confirmation: z.string().min(1, 'Confirmation text is required'),
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

// Update user profile (name, email, role) (admin only) via Better Auth HTTP API and Convex mutations
export const updateUserProfileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(updateUserProfileSchema)
  .handler(async ({ data }) => {
    try {
      const { userId, name, email, role } = data;

      await requireAdmin();

      // Check if email is being changed - need to verify it's not already taken
      // Get all users to check for email conflicts
      const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
      const allUsersResult = await fetchQuery(api.admin.getAllUsers, {
        page: 1,
        pageSize: 1000, // Get all users to check email
        sortBy: 'email',
        sortOrder: 'asc',
        secondarySortBy: 'email',
        secondarySortOrder: 'asc',
        search: undefined,
        role: 'all',
      });

      // Find user being updated
      const userToUpdate = allUsersResult.users.find((u) => u.id === userId);
      if (!userToUpdate) {
        throw new Error('User not found');
      }

      // Check if email is already taken by another user
      if (email !== userToUpdate.email) {
        const emailExists = allUsersResult.users.some(
          (u) => u.id !== userId && u.email.toLowerCase() === email.toLowerCase(),
        );
        if (emailExists) {
          throw new Error('Email address is already in use by another user');
        }
      }

      // Update name/email via Convex mutation using Better Auth component adapter
      // The HTTP API doesn't allow email updates, so we use the component adapter directly
      if (name !== userToUpdate.name || email !== userToUpdate.email) {
        const { fetchMutation } = await setupFetchClient(createAuth, getCookie);

        // Build update object - only include fields that changed
        const updateData: {
          name?: string;
          email?: string;
        } = {};

        if (name !== userToUpdate.name) {
          updateData.name = name.trim();
        }

        if (email !== userToUpdate.email) {
          updateData.email = email.toLowerCase().trim();
        }

        await fetchMutation(api.admin.updateBetterAuthUser, {
          userId,
          ...updateData,
        });
      }

      // Update role via Convex mutation (if changed)
      if (role !== userToUpdate.role) {
        const { fetchMutation } = await setupFetchClient(createAuth, getCookie);
        await fetchMutation(api.users.setUserRole, {
          userId,
          role,
        });
      }

      return { success: true, message: 'User profile updated successfully' };
    } catch (error) {
      throw handleServerError(error, 'Update user profile');
    }
  });

// Delete user and all associated data (admin only) via Convex mutations
export const deleteUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteUserSchema)
  .handler(async ({ data }) => {
    try {
      const { userId: _userId, confirmation } = data;

      if (confirmation !== 'DELETE_USER_DATA') {
        throw new Error('Invalid confirmation');
      }

      await requireAdmin();

      // Get user info before deletion (for success message)
      const { fetchQuery, fetchMutation } = await setupFetchClient(createAuth, getCookie);
      const userToDelete = await fetchQuery(api.admin.getUserById, {
        userId: _userId,
      });

      if (!userToDelete) {
        throw new Error('User not found');
      }

      // Delete user via Convex mutation (removes from userProfiles and auditLogs)
      await fetchMutation(api.admin.deleteUser, {
        userId: _userId,
      });

      // Note: Better Auth user deletion should be handled via Better Auth HTTP API
      // This mutation only deletes app-specific data (userProfiles, auditLogs)

      return {
        success: true,
        message: `User ${userToDelete.email} and all associated data deleted successfully`,
      };
    } catch (error) {
      throw handleServerError(error, 'Delete user');
    }
  });

// Get all users (admin only) via Convex query
export const getAllUsersServerFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      page: z.number().int().positive().default(1),
      pageSize: z.number().int().positive().max(100).default(10),
      sortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']).default('email'),
      sortOrder: z.enum(['asc', 'desc']).default('asc'),
      secondarySortBy: z
        .enum(['name', 'email', 'role', 'emailVerified', 'createdAt'])
        .default('email'),
      secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
      search: z.string().optional(),
      role: z.enum(['all', 'user', 'admin']).default('all'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      await requireAdmin();

      const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
      const result = await fetchQuery(api.admin.getAllUsers, {
        page: data.page,
        pageSize: data.pageSize,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        secondarySortBy: data.secondarySortBy,
        secondarySortOrder: data.secondarySortOrder,
        search: data.search,
        role: data.role,
      });

      return result;
    } catch (error) {
      throw handleServerError(error, 'Get all users');
    }
  });

// Get system statistics (admin only) via Convex query
export const getSystemStatsServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAdmin();

    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
    const result = await fetchQuery(api.admin.getSystemStats, {});

    return result;
  } catch (error) {
    throw handleServerError(error, 'Get system stats');
  }
});

// Truncate all application data (admin only) via Convex mutation
export const truncateDataServerFn = createServerFn({ method: 'POST' }).handler(async () => {
  try {
    await requireAdmin();

    const { fetchMutation } = await setupFetchClient(createAuth, getCookie);
    const result = await fetchMutation(api.admin.truncateData, {});

    return result;
  } catch (error) {
    throw handleServerError(error, 'Truncate data');
  }
});
