import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';

type ProfileQueryResult = typeof api.users.getCurrentUserProfile._returnType;
type ProfileRecord = Exclude<ProfileQueryResult, null | undefined>;

const toProfileData = (profile: ProfileRecord) => ({
  ...profile,
  createdAt: new Date(profile.createdAt),
  updatedAt: new Date(profile.updatedAt),
  emailVerified: profile.emailVerified as boolean | null,
});

// Hook to get user profile using Convex real-time query
export function useProfile() {
  const profile = useQuery(api.users.getCurrentUserProfile);
  const hasResolved = profile !== undefined;
  const normalizedProfile = profile ? toProfileData(profile as ProfileRecord) : undefined;
  const isUnauthorized = hasResolved && profile === null;

  return {
    data: normalizedProfile,
    isLoading: profile === undefined,
    error: isUnauthorized ? new Error('UNAUTHORIZED') : null,
  };
}
