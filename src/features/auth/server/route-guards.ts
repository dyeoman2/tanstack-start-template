import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { requireAuth } from '~/features/auth/server/auth-guards';
import type { RouterAuthContext } from '~/router';
import type { Capability } from '../../../../convex/authz/policy.map';
import { Caps } from '../../../../convex/authz/policy.map';

export async function routeAdminGuard({
  location,
}: {
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  try {
    const { user } = await getCurrentUserServerFn();

    // Use capability-based checking for consistency with the RBAC system
    const adminCapability: Capability = 'route:/app/admin';
    const allowedRoles = Caps[adminCapability] ?? [];
    if (!user?.role || !(allowedRoles as readonly string[]).includes(user.role)) {
      throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
    }

    return { authenticated: true as const, user };
  } catch (_error) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}

/**
 * Server function for auth validation - only called for admin routes
 * This is expensive (hits Convex) so we minimize its usage
 */
const getCurrentUserServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Extract<RouterAuthContext, { authenticated: true }>> => {
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
  },
);
