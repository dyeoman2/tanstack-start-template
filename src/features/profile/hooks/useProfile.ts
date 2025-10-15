import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getUserProfileServerFn,
  updateUserProfileServerFn,
} from '~/features/profile/server/profile.server';
import { queryInvalidators, queryKeys } from '~/lib/query-keys';

// Types
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  role: string;
  emailVerified: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateProfileData {
  name: string;
  phoneNumber?: string;
}

// Hook to get user profile
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.auth.currentProfile(),
    queryFn: async () => {
      const result = await getUserProfileServerFn();
      return result.profile as UserProfile;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Hook to update user profile
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateProfileData) => {
      const result = await updateUserProfileServerFn({ data });
      return result;
    },
    onSuccess: () => {
      // Invalidate profile queries
      queryInvalidators.auth.profile(queryClient);
    },
  });
}
