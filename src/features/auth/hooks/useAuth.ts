import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useRef } from 'react';
import { useSession } from '~/features/auth/auth-client';

export type UserRole = 'user' | 'admin';

export function useAuth() {
  const { data: session, isPending: sessionPending, error } = useSession();

  const isAuthenticated = !!session?.user;

  // Only fetch profile if we have a session user and we're not already loading
  // This prevents unnecessary query calls when session changes rapidly
  const shouldFetchProfile = isAuthenticated && !sessionPending;

  // Always call useQuery to maintain hooks order - query returns null when not authenticated
  // We only use the result when we're supposed to fetch the profile
  const profileQuery = useQuery(api.users.getCurrentUserProfile, {});

  // Only use the profile data when we actually want to fetch it
  // profileQuery will be null when not authenticated, so we ignore it unless shouldFetchProfile is true
  const profile = shouldFetchProfile ? profileQuery : undefined;

  // Track previous state to only log when things change
  const prevStateRef = useRef<
    | {
        isAuthenticated: boolean;
        sessionPending: boolean;
        shouldFetchProfile: boolean;
        profileRole?: string;
        hasError: boolean;
      }
    | undefined
  >(undefined);

  // Log only when state changes
  useEffect(() => {
    const prevState = prevStateRef.current;
    const currentState = {
      isAuthenticated,
      sessionPending,
      shouldFetchProfile,
      profileRole: profile?.role,
      hasError: !!error,
    };

    if (
      !prevState ||
      prevState.isAuthenticated !== currentState.isAuthenticated ||
      prevState.sessionPending !== currentState.sessionPending ||
      prevState.shouldFetchProfile !== currentState.shouldFetchProfile ||
      prevState.profileRole !== currentState.profileRole ||
      prevState.hasError !== currentState.hasError
    ) {
      console.log('[useAuth] State changed:', {
        isAuthenticated,
        sessionPending,
        shouldFetchProfile,
        sessionUserId: session?.user?.id,
        profileRole: profile?.role,
        profilePhone: profile?.phoneNumber,
        hasError: !!error,
        profileQueryDefined: profileQuery !== undefined,
        profileDefined: profile !== undefined,
      });

      prevStateRef.current = currentState;
    }
  }, [
    isAuthenticated,
    sessionPending,
    shouldFetchProfile,
    profile?.role,
    error,
    session?.user?.id,
    profile?.phoneNumber,
    profileQuery,
    profile,
  ]);

  const isPending = sessionPending || (isAuthenticated && profile === undefined);

  // Determine role: use profile role if available, otherwise default to 'user'
  const role: UserRole = (profile?.role === 'admin' ? 'admin' : 'user') as UserRole;

  // Memoize return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      user: session?.user
        ? {
            ...session.user,
            role,
            phoneNumber: profile?.phoneNumber || null,
          }
        : null,
      isAuthenticated,
      isAdmin: role === 'admin',
      isPending,
      error,
    }),
    [session?.user, role, profile?.phoneNumber, isAuthenticated, isPending, error],
  );
}
