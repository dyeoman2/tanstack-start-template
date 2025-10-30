import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { requireAuth } from '~/features/auth/server/auth-guards';
import type { RouterAuthContext } from '~/router';

export async function routeAuthGuard({
  location,
}: {
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  // Exclude public routes from auth check
  const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password'];
  const isPublicRoute = publicRoutes.some(
    (route) => location.pathname === route || location.pathname.startsWith('/reset-password'),
  );
  if (isPublicRoute) {
    return { authenticated: false, user: null };
  }

  const { user } = await getCurrentUserServerFn();
  return { authenticated: true, user };
}

export async function routeAdminGuard({
  location,
}: {
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  const { user } = await getCurrentUserServerFn();
  if (user?.role !== 'admin') {
    throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
  }
  return { authenticated: true, user };
}

const getCurrentUserServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Extract<RouterAuthContext, { authenticated: true }>> => {
    try {
      const { user } = await requireAuth();
      return {
        authenticated: true as const,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    } catch (_error) {
      throw redirect({ to: '/login' });
    }
  },
);
