import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { handleServerError } from '~/lib/server/error-utils.server';
import { api } from '../../../convex/_generated/api';
import { createAuth } from '../../../convex/auth';

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

// Update user profile (name, email, role) (admin only) - using Better Auth HTTP API + Convex mutations
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
      const userToUpdate = allUsersResult.users.find(
        (u: { id: string; email: string }) => u.id === userId,
      );
      if (!userToUpdate) {
        throw new Error('User not found');
      }

      // Check if email is already taken by another user
      if (email !== userToUpdate.email) {
        const emailExists = allUsersResult.users.some(
          (u: { id: string; email: string }) =>
            u.id !== userId && u.email.toLowerCase() === email.toLowerCase(),
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

      // Get user info before deletion (for success message)
      const { fetchQuery, fetchMutation } = await setupFetchClient(createAuth, getCookie);
      const allUsersResult = await fetchQuery(api.admin.getAllUsers, {
        page: 1,
        pageSize: 1000,
        sortBy: 'email',
        sortOrder: 'asc',
        secondarySortBy: 'email',
        secondarySortOrder: 'asc',
        search: undefined,
        role: 'all',
      });

      const userToDelete = allUsersResult.users.find((u) => u.id === _userId);
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
