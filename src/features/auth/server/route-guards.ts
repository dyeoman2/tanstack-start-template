import { fetchSession } from '@convex-dev/better-auth/react-start';
import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireAuth } from '~/features/auth/server/auth-guards';
import type { RouterAuthContext } from '~/router';
import type { Capability } from '../../../../convex/authz/policy.map';
import { Caps } from '../../../../convex/authz/policy.map';

// SECURITY: Removed route guard caching due to auth bypass vulnerability
// Cache was keyed only by pathname, allowing unauthenticated users to bypass
// auth checks if an authenticated user had recently visited the same route.
//
// TODO: If caching is re-implemented in the future, it must be keyed by:
// - User session identifier
// - User ID from authenticated context
// - Or some other user-specific identifier
//
// For now, we accept the performance trade-off for security.

function getCurrentRequest(): Request | undefined {
  if (!import.meta.env.SSR) {
    throw new Error('Authentication utilities must run on the server');
  }

  return getRequest();
}

/**
 * Lightweight auth guard that skips expensive server validation for most cases
 * Only validates server-side for admin routes to ensure role accuracy
 */
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

  // For admin routes, always do server-side validation to ensure role is current
  const adminRoutes = ['/app/admin'];
  const isAdminRoute = adminRoutes.some((route) => location.pathname.startsWith(route));

  if (isAdminRoute) {
    // Use capability-based guard for admin routes
    if (location.pathname.startsWith('/app/admin/users')) {
      return await routeCapabilityGuard('route:/app/admin.users', location);
    } else if (location.pathname.startsWith('/app/admin/stats')) {
      return await routeCapabilityGuard('route:/app/admin.stats', location);
    } else if (location.pathname === '/app/admin' || location.pathname.startsWith('/app/admin/')) {
      // Admin layout and other admin routes
      return await routeCapabilityGuard('route:/app/admin', location);
    } else {
      // Default admin route guard for other admin routes
      return await routeAdminGuard({ location });
    }
  }

  // For regular authenticated routes, do lightweight session checking
  try {
    const authResult = await checkSessionServerFn();

    if (!authResult) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }

    return {
      authenticated: true,
      user: null, // Will be populated client-side
    };
  } catch {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}

export async function routeAdminGuard({
  location,
}: {
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  try {
    const { user } = await getCurrentUserServerFn();
    if (user?.role !== 'admin') {
      throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
    }

    return { authenticated: true as const, user };
  } catch (_error) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}

/**
 * Standardized route guard that checks capabilities using the same system as Convex functions
 * This ensures consistency between client-side and server-side authorization
 */
export async function routeCapabilityGuard(
  cap: Capability,
  location: ParsedLocation,
): Promise<RouterAuthContext> {
  try {
    const { user } = await getCurrentUserServerFn();

    // Check if the user's role grants access to the capability
    const allowedRoles = Caps[cap] ?? [];
    if (!allowedRoles.includes(user?.role as any)) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }

    return { authenticated: true as const, user };
  } catch (_error) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}

/**
 * Lightweight server function for session checking - used for regular routes
 * Validates Better Auth JWT and returns optimistic auth (role fetched only when needed)
 */
const checkSessionServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RouterAuthContext> => {
    const request = getCurrentRequest();
    if (!request) {
      throw new Error('No request available');
    }

    // Validate JWT token using Better Auth's fetchSession
    const { session } = await fetchSession(request);

    if (!session?.user) {
      throw new Error('No valid session');
    }

    // Return optimistic auth - role will be fetched client-side when needed
    // This avoids DB hits for regular routes while maintaining performance
    return {
      authenticated: true,
      user: null, // Role fetched client-side via useAuth hook
    };
  },
);

/**
 * Server function for auth validation - only called for admin routes
 * This is expensive (hits Convex) so we minimize its usage
 */
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
