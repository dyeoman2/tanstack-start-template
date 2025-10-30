import { useQuery } from 'convex/react';
import { useSession } from '~/features/auth/auth-client';
import { api } from '../../../../convex/_generated/api';

export type UserRole = 'user' | 'admin';

export function useAuth() {
  const { data: session, isPending: sessionPending, error } = useSession();

  // Fetch user profile with role from Convex (only if authenticated)
  // This query will throw if not authenticated, so we handle that gracefully
  const profile = useQuery(api.users.getCurrentUserProfile, session?.user ? {} : 'skip');

  const isAuthenticated = !!session?.user;
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
