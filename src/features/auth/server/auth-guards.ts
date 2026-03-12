import { api } from '@convex/_generated/api';
import { redirect } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';
import { deriveIsSiteAdmin, normalizeUserRole } from '~/features/auth/lib/user-role';
import type { UserId } from '~/lib/shared/user-id';
import { normalizeUserId } from '~/lib/shared/user-id';
import { convexAuthReactStart } from './convex-better-auth-react-start';
import type { UserRole } from '../types';

export interface AuthenticatedUser {
  id: UserId;
  email: string;
  role: UserRole;
  isSiteAdmin: boolean;
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
 * Note: Better Auth remains the source of truth for the global role.
 * The Convex profile query returns the app projection used by routes and UI.
 */
async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    if (!getCurrentRequest()) {
      return null;
    }

    const profile = await convexAuthReactStart.fetchAuthQuery(api.users.getCurrentUserProfile, {});
    const role = normalizeUserRole(profile?.role);

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
      role,
      isSiteAdmin: deriveIsSiteAdmin(role),
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

export async function requireAdmin(): Promise<AuthResult> {
  const result = await requireAuth();
  if (!result.user.isSiteAdmin) {
    throw redirect({ to: '/login' });
  }

  return result;
}
