import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { checkAdminServerFn, getCurrentUserServerFn } from '~/features/auth/server/auth-checks';
import type { RouterAuthContext } from '~/router';

export async function ensureAuthenticatedContext({
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

  const fresh = await getCurrentUserServerFn();
  if (!fresh.authenticated) {
    throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
  }
  return fresh;
}

export async function ensureAdminContext({
  location,
}: {
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  const result = await checkAdminServerFn();
  if (!result.authenticated || result.user?.role !== 'admin') {
    throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
  }

  const ctx: RouterAuthContext = { authenticated: true, user: result.user };
  return ctx;
}
