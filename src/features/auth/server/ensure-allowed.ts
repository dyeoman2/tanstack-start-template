import { api } from '@convex/_generated/api';
import { createAuth } from '@convex/auth';
import { fetchSession, setupFetchClient } from '@convex-dev/better-auth/react-start';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import type { Capability } from '../../../../convex/authz/policy.map';
import { Caps } from '../../../../convex/authz/policy.map';

/**
 * Client-side capability check for route guards
 * Returns whether the current user has the required capability
 */
export async function ensureAllowed(cap: Capability): Promise<{
  allowed: boolean;
  reason: 'unauthenticated' | 'unauthorized';
}> {
  // SSR check - route guards should only run on client
  if (import.meta.env.SSR) {
    return { allowed: true, reason: 'unauthenticated' };
  }

  const request = getRequest();
  if (!request) {
    return { allowed: false, reason: 'unauthenticated' };
  }

  try {
    // Validate Better Auth session
    const { session } = await fetchSession(request);
    if (!session?.user) {
      return { allowed: false, reason: 'unauthenticated' };
    }

    // Use Convex to check if user has the capability
    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
    const userProfile = await fetchQuery(api.users.getCurrentUserProfile, {});

    if (!userProfile) {
      return { allowed: false, reason: 'unauthenticated' };
    }

    // Check if the user's role grants access to the capability
    const allowedRoles = Caps[cap] ?? [];
    if (!allowedRoles.includes(userProfile.role as any)) {
      return { allowed: false, reason: 'unauthorized' };
    }

    return { allowed: true, reason: 'unauthenticated' };
  } catch (error) {
    console.warn('[ensureAllowed] Error checking capability:', error);
    return { allowed: false, reason: 'unauthenticated' };
  }
}
