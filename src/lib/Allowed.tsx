import type { ReactNode } from 'react';
import { useSession } from '~/features/auth/auth-client';
import type { Capability } from '../../convex/authz/policy.map';
import { Caps } from '../../convex/authz/policy.map';

interface AllowedProps {
  cap: Capability;
  children: ReactNode;
}

/**
 * Client-side capability check component
 * Renders children only if the current user has the required capability
 * Use the generated Convex API or simple session role checks for conditional rendering
 */
export function Allowed({ cap, children }: AllowedProps) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const allowedRoles = Caps[cap] ?? [];
  if (!role || !allowedRoles.includes(role as any)) return null;
  return <>{children}</>;
}
