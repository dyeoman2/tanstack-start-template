import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useSession } from '~/features/auth/auth-client';

export type UserRole = 'user' | 'admin';

export function useAuth() {
  const { data: session, isPending: sessionPending, error } = useSession();

  const isAuthenticated = !!session?.user;

  // Only fetch profile if we have a session user and we're not already loading
  // This prevents unnecessary query calls when session changes rapidly
  const shouldFetchProfile = isAuthenticated && !sessionPending;

  // Fetch user profile with role from Convex (only when needed)
  // Convex's built-in caching should prevent duplicate calls
  const profile = useQuery(api.users.getCurrentUserProfile, shouldFetchProfile ? {} : 'skip');

  const isPending = sessionPending || (isAuthenticated && profile === undefined);

  // Determine role: use profile role if available, otherwise default to 'user'
  const role: UserRole = (profile?.role === 'admin' ? 'admin' : 'user') as UserRole;

  return {
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
  };
}
