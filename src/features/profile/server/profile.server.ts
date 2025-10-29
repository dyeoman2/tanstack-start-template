import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { handleServerError } from '~/lib/server/error-utils.server';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

// Zod schemas for profile operations
const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  phoneNumber: z.string().optional(),
});

// Update user profile via Better Auth HTTP API and Convex
export const updateUserProfileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(updateProfileSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const { name, phoneNumber } = data;

      // Get request for cookies and determine site URL
      const request = getRequest();
      const siteUrl =
        import.meta.env.SITE_URL || import.meta.env.VITE_SITE_URL || 'http://localhost:3000';

      // Forward cookies from the request for authentication
      const cookieHeader = request?.headers.get('cookie') || '';

      // Call Better Auth's /api/auth/update-user endpoint directly via TanStack Start proxy
      // The proxy route at /api/auth/$ forwards to Convex's Better Auth HTTP handler
      const updateResponse = await fetch(`${siteUrl}/api/auth/update-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader,
          Origin: siteUrl,
        },
        credentials: 'include',
        body: JSON.stringify({
          name,
          phoneNumber: phoneNumber || null,
        }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        let errorData: { message?: string } = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = {
            message: errorText || updateResponse.statusText || 'Failed to update profile',
          };
        }
        console.error('[Profile Update] Better Auth update-user error:', {
          status: updateResponse.status,
          statusText: updateResponse.statusText,
          body: errorText,
        });
        throw new Error(errorData.message || 'Failed to update user profile');
      }

      const updateResult = await updateResponse.json();

      // Better Auth's update-user endpoint returns the updated user data
      // Use that if available, otherwise fetch from Convex
      let profile: {
        id: string;
        email: string;
        name: string | null;
        phoneNumber: string | null;
        role: string;
        emailVerified: boolean;
        createdAt: number;
        updatedAt: number;
      };
      if (updateResult?.user) {
        // Use the user data returned from Better Auth
        // Still need to fetch role from userProfiles
        const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
        const currentProfile = await fetchQuery(api.users.getCurrentUserProfile, {});

        profile = {
          id: updateResult.user.id || currentProfile.id,
          email: updateResult.user.email || currentProfile.email,
          name: updateResult.user.name || null,
          phoneNumber: updateResult.user.phoneNumber || null,
          role: currentProfile.role, // Role is stored in userProfiles, not Better Auth
          emailVerified: updateResult.user.emailVerified || currentProfile.emailVerified,
          createdAt: updateResult.user.createdAt
            ? typeof updateResult.user.createdAt === 'string'
              ? new Date(updateResult.user.createdAt).getTime()
              : updateResult.user.createdAt
            : currentProfile.createdAt,
          updatedAt: updateResult.user.updatedAt
            ? typeof updateResult.user.updatedAt === 'string'
              ? new Date(updateResult.user.updatedAt).getTime()
              : updateResult.user.updatedAt
            : currentProfile.updatedAt,
        };
      } else {
        // Fallback: fetch from Convex if Better Auth didn't return user data
        // Delay ensures Better Auth update is committed to Convex (eventual consistency)
        await new Promise((resolve) => setTimeout(resolve, 500));
        const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
        const fetchedProfile = await fetchQuery(api.users.getCurrentUserProfile, {});

        profile = {
          id: fetchedProfile.id,
          email: fetchedProfile.email,
          name: fetchedProfile.name,
          phoneNumber: fetchedProfile.phoneNumber,
          role: fetchedProfile.role,
          emailVerified: fetchedProfile.emailVerified,
          createdAt: fetchedProfile.createdAt,
          updatedAt: fetchedProfile.updatedAt,
        };
      }

      return {
        success: true,
        profile: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          phoneNumber: profile.phoneNumber,
          role: profile.role,
          emailVerified: profile.emailVerified,
          createdAt: new Date(profile.createdAt),
          updatedAt: new Date(profile.updatedAt),
        },
        message: 'Profile updated successfully',
      };
    } catch (error) {
      throw handleServerError(error, 'Update user profile');
    }
  });
