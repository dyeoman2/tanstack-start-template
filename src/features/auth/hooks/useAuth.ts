import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import { useSession } from '~/features/auth/auth-client';
import type { UserRole } from '../types';
import { DEFAULT_ROLE, USER_ROLES } from '../types';
import { useAuthState } from './useAuthState';

export interface AuthOptions {
  /** Whether to fetch role data from the database. Defaults to true for backward compatibility. */
  fetchRole?: boolean;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name?: string;
    phoneNumber?: string | null;
    role: UserRole;
  } | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isPending: boolean;
  error: Error | null;
}

export function useAuth(options: AuthOptions = {}): AuthResult {
  const { fetchRole = true } = options;

  // Use the lightweight auth state hook
  const authState = useAuthState();
  const { data: session, isPending: sessionPending, error } = useSession();

  // Only fetch profile if we have a session user, we're not already loading, AND role fetching is enabled
  const shouldFetchProfile = authState.isAuthenticated && !sessionPending && fetchRole;

  // Pass "skip" to avoid running the Convex query when profile data is not needed
  const profileQuery = useQuery(api.users.getCurrentUserProfile, shouldFetchProfile ? {} : 'skip');

  // Only use profile data when we should be fetching it
  const profile = shouldFetchProfile ? profileQuery : undefined;

  const isPending =
    sessionPending || (authState.isAuthenticated && shouldFetchProfile && profile === undefined);

  // Determine role: use profile role if available, otherwise default to user
  // If we're not fetching roles, default to user
  const role: UserRole = shouldFetchProfile
    ? profile?.role === USER_ROLES.ADMIN
      ? USER_ROLES.ADMIN
      : USER_ROLES.USER
    : DEFAULT_ROLE;

  // Memoize return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      user: session?.user
        ? {
            ...session.user,
            role,
            phoneNumber: shouldFetchProfile ? profile?.phoneNumber || null : null,
          }
        : null,
      isAuthenticated: authState.isAuthenticated,
      isAdmin: role === USER_ROLES.ADMIN,
      isPending,
      error,
    }),
    [
      session?.user,
      role,
      profile?.phoneNumber,
      authState.isAuthenticated,
      isPending,
      error,
      shouldFetchProfile,
    ],
  );
}
