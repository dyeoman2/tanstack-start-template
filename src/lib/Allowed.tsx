import type { ReactNode } from 'react';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { USER_ROLES } from '~/features/auth/types';
import type { Capability } from '../../convex/authz/policy.map';
import { Caps, PublicCaps } from '../../convex/authz/policy.map';

interface AllowedProps {
  cap: Capability;
  children: ReactNode;
}

/**
 * Client-side capability check component
 * Renders children only if the current user has the required capability
 * Uses proper role checking with conditional database queries
 */
export function Allowed({ cap, children }: AllowedProps) {
  const authState = useAuthState();

  // Always call useAuth, but only fetch roles when authenticated
  const { isAdmin } = useAuth({ fetchRole: authState.isAuthenticated });

  // For public capabilities, allow without authentication
  if (PublicCaps.has(cap)) {
    return <>{children}</>;
  }

  // For protected capabilities, check role when authenticated
  const allowedRoles = Caps[cap] ?? [];
  const userRole = isAdmin ? USER_ROLES.ADMIN : USER_ROLES.USER;

  if (!allowedRoles.some((allowedRole) => allowedRole === userRole)) {
    return null;
  }

  return <>{children}</>;
}
