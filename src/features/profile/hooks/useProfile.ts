import { useQuery } from 'convex/react';
import { updateUserProfileServerFn } from '~/features/profile/server/profile.server';
import { api } from '../../../../convex/_generated/api';

export interface UpdateProfileData {
  name: string;
  phoneNumber?: string;
}

// Hook to get user profile - migrated to Convex
export function useProfile() {
  const profile = useQuery(api.users.getCurrentUserProfile);

  return {
    data: profile
      ? {
          ...profile,
          createdAt: new Date(profile.createdAt),
          updatedAt: new Date(profile.updatedAt),
          emailVerified: profile.emailVerified as boolean | null,
        }
      : undefined,
    isLoading: profile === undefined,
    error: null, // Convex handles errors differently
  };
}

// Hook to update user profile - using server function for Better Auth HTTP API integration
export function useUpdateProfile() {
  // For now, return a mock mutation since profile updates are handled via server function
  // TODO: Implement proper Convex mutation when profile updates are migrated
  return {
    mutateAsync: async (data: UpdateProfileData) => {
      const result = await updateUserProfileServerFn({ data });
      return result;
    },
    isPending: false,
  };
}
