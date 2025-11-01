import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import type { ProfileLoaderData } from '~/features/profile/server/profile.server';
import { useOptimisticMutation } from '../../admin/hooks/useOptimisticUpdates';

export interface UpdateProfileData {
  name: string;
  phoneNumber?: string;
}

type LoaderProfile = Exclude<ProfileLoaderData, null>;

const toProfileData = (profile: LoaderProfile) => ({
  ...profile,
  createdAt: new Date(profile.createdAt),
  updatedAt: new Date(profile.updatedAt),
  emailVerified: profile.emailVerified as boolean | null,
});

// Hook to get user profile using Convex real-time query with SSR fallback
export function useProfile(initialData?: ProfileLoaderData) {
  const profile = useQuery(api.users.getCurrentUserProfile);
  const fallbackProfile = initialData ?? null;
  const resolvedProfile = profile ?? fallbackProfile ?? null;

  return {
    data: resolvedProfile ? toProfileData(resolvedProfile) : undefined,
    isLoading: profile === undefined && fallbackProfile === null,
    error: null, // Convex handles errors differently
  };
}

// Hook to update user profile with optimistic updates and rollback
export function useUpdateProfile() {
  // Use optimistic mutation utility for automatic rollback on error
  const updateProfileOptimistic = useOptimisticMutation(api.users.updateCurrentUserProfile, {
    onSuccess: () => {
      // Profile updated successfully - Convex automatically updates queries
    },
    onError: (error) => {
      console.error('Profile update failed:', error);
    },
  });

  return {
    mutateAsync: async (data: UpdateProfileData) => {
      // Optimistic mutation with automatic rollback on error
      await updateProfileOptimistic({
        name: data.name || undefined,
        phoneNumber: data.phoneNumber || undefined,
      });

      // Convex automatically invalidates queries, so the profile data will update
      return {
        success: true,
        message: 'Profile updated successfully',
      };
    },
    isPending: false, // Convex mutations don't provide loading state in the same way
  };
}
