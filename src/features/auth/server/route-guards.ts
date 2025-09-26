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
  if (isPublicRoute) return { user: null, authenticated: false };

  const { user } = await getCurrentUserServerFn();
  return { user, authenticated: true };
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
  return { user, authenticated: true };
}

const getCurrentUserServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { user } = await requireAuth();
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      authenticated: true,
    };
  } catch (_error) {
    throw redirect({ to: '/login' });
  }
});
