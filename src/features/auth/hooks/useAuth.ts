import { useSession } from '~/features/auth/auth-client';

export type UserRole = 'user' | 'admin';

export function useAuth() {
  const { data: session, isPending, error } = useSession();

  return {
    user: session?.user
      ? {
          ...session.user,
          role: (session.user as { role?: UserRole }).role || 'user',
        }
      : null,
    isAuthenticated: !!session?.user,
    isAdmin: (session?.user as { role?: UserRole })?.role === 'admin',
    isPending,
    error,
  };
}
