import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { checkAdminServerFn, getCurrentUserServerFn } from '~/features/auth/server/auth-checks';
import type { RouterAuthContext } from '~/router';

// Simple 60s TTL to avoid repeated fetches during quick navs
let cachedUser: { ctx: RouterAuthContext | null; ts: number } = { ctx: null, ts: 0 };
const TTL_MS = 60_000;
const now = () => Date.now();

export async function ensureAuthenticatedContext({
  context,
  location,
}: {
  context?: RouterAuthContext;
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  if (context?.authenticated) return context;

  if (cachedUser.ctx && now() - cachedUser.ts < TTL_MS) return cachedUser.ctx;

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
  cachedUser = { ctx: fresh, ts: now() };
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

  // TTL cache reuse if present
  if (cachedUser.ctx && now() - cachedUser.ts < TTL_MS) {
    if (cachedUser.ctx.user?.role === 'admin') return cachedUser.ctx;
  }

  // Definitive server check
  const result = await checkAdminServerFn(); // recommend this throws typed errors
  if (!result.authenticated || result.user?.role !== 'admin') {
    throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
  }

  const ctx: RouterAuthContext = { authenticated: true, user: result.user };
  cachedUser = { ctx, ts: now() };
  return ctx;
}
