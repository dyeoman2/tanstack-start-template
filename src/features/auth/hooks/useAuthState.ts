import { useEffect } from 'react';
import { clearSigningOutState, useIsSigningOut, useSession } from '~/features/auth/auth-client';

export interface AuthState {
  isAuthenticated: boolean;
  isPending: boolean;
  error: Error | null;
  userId: string | undefined;
}

/**
 * Lightweight hook for authentication state only
 * No database calls - just checks Better Auth session
 * Use this for basic auth checks where role data isn't needed
 */
export function useAuthState(): AuthState {
  const { data: session, isPending, error } = useSession();
  const isSigningOut = useIsSigningOut();

  useEffect(() => {
    if (!isSigningOut || isPending || session?.user) {
      return;
    }

    clearSigningOutState();
  }, [isPending, isSigningOut, session?.user]);

  return {
    isAuthenticated: !isSigningOut && !!session?.user,
    isPending: isSigningOut ? false : isPending,
    error,
    userId: isSigningOut ? undefined : session?.user?.id,
  };
}
