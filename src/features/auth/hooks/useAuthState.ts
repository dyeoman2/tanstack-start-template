import { useSession } from '~/features/auth/auth-client';

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

  return {
    isAuthenticated: !!session?.user,
    isPending,
    error,
    userId: session?.user?.id,
  };
}
