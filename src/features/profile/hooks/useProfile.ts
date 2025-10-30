import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { updateUserProfileServerFn, type ProfileLoaderData } from '~/features/profile/server/profile.server';

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

// Hook to update user profile - using server function for Better Auth HTTP API integration
export function useUpdateProfile() {
  // Profile updates are handled via server function to integrate with Better Auth HTTP API
  return {
    mutateAsync: async (data: UpdateProfileData) => {
      const result = await updateUserProfileServerFn({ data });
      return result;
    },
    isPending: false,
  };
}
