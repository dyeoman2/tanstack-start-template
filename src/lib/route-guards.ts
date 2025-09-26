import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { checkAdminServerFn, getCurrentUserServerFn } from '~/features/auth/server/auth-checks';
import type { RouterAuthContext } from '~/router';

export async function ensureAuthenticatedContext({
  context,
  location,
}: {
  context?: RouterAuthContext;
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  if (context?.authenticated) return context;

  // Exclude public routes from auth check
  const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password'];
  const isPublicRoute = publicRoutes.some(
    (route) => location.pathname === route || location.pathname.startsWith('/reset-password'),
  );
  if (isPublicRoute) return context ?? { user: null, authenticated: false };

  const fresh = await getCurrentUserServerFn();
  if (!fresh.authenticated) {
    throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
  }
  return fresh;
}

export async function ensureAdminContext({
  context,
  location,
}: {
  context?: RouterAuthContext;
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  // Fast path: already hydrated and admin
  if (context?.authenticated && context.user?.role === 'admin') return context;

  // Definitive server check
  const result = await checkAdminServerFn(); // recommend this throws typed errors
  if (!result.authenticated || result.user?.role !== 'admin') {
    throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
  }

  const ctx: RouterAuthContext = { authenticated: true, user: result.user };
  return ctx;
}
