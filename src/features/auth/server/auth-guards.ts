import { api } from '@convex/_generated/api';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { redirect } from '@tanstack/react-router';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import type { UserId } from '~/lib/shared/user-id';
import { normalizeUserId } from '~/lib/shared/user-id';
import type { UserRole } from '../types';
import { USER_ROLES } from '../types';

export interface AuthenticatedUser {
  id: UserId;
  email: string;
  role: UserRole;
  name?: string;
}

export interface AuthResult {
  user: AuthenticatedUser;
}

function getCurrentRequest(): Request | undefined {
  if (!import.meta.env.SSR) {
    throw new Error('Authentication utilities must run on the server');
  }

  return getRequest();
}

/**
 * Get the current session and user information from Convex Better Auth
 * Returns null if not authenticated
 *
 * Note: This calls the Convex Better Auth HTTP handler to get the session,
 * then fetches the role from the userProfiles table via Convex.
 */
async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    if (!getCurrentRequest()) {
      return null;
    }

    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
    const profile = await fetchQuery(api.users.getCurrentUserProfile, {});

    const sessionUserId = normalizeUserId(profile);
    if (!sessionUserId) {
      return null;
    }

    const sessionUserEmail =
      typeof profile?.email === 'string' && profile.email.length > 0 ? profile.email : null;
    if (!sessionUserEmail) {
      return null;
    }

    return {
      id: sessionUserId,
      email: sessionUserEmail,
      role: profile?.role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.USER,
      name: typeof profile?.name === 'string' ? profile.name : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Require authentication
 */
export async function requireAuth(): Promise<AuthResult> {
  const user = await getCurrentUser();

  if (!user) {
    throw redirect({ to: '/login' });
  }

  return { user };
}
