import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { redirect } from '@tanstack/react-router';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import type { UserId } from '~/lib/shared/user-id';
import { normalizeUserId } from '~/lib/shared/user-id';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

// Type definitions for user roles
export type UserRole = 'user' | 'admin';

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
    const authUser = await fetchQuery(api.auth.getCurrentUser, {});

    const sessionUserId = normalizeUserId(authUser);
    const sessionUserEmail = typeof authUser?.email === 'string' ? authUser.email : null;
    const sessionUserName = typeof authUser?.name === 'string' ? authUser.name : undefined;

    if (!sessionUserId || !sessionUserEmail) {
      return null;
    }

    // Fetch role from userProfiles table via Convex
    // Role is stored separately from Better Auth's user table
    try {
      const profile = await fetchQuery(api.users.getCurrentUserProfile, {});

      return {
        id: sessionUserId,
        email: sessionUserEmail,
        role: (profile?.role === 'admin' ? 'admin' : 'user') as UserRole,
        name: sessionUserName,
      };
    } catch (profileError) {
      // If profile fetch fails, still return user but with default role
      // This can happen if user hasn't been fully set up yet
      console.warn('[Auth Guard] Failed to fetch user profile, using default role:', profileError);
      return {
        id: sessionUserId,
        email: sessionUserEmail,
        role: 'user',
        name: sessionUserName,
      };
    }
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

/**
 * Require admin role
 */
export async function requireAdmin(): Promise<AuthResult> {
  const { user } = await requireAuth();

  if (user.role !== 'admin') {
    throw new Error('Admin access required');
  }

  return { user };
}
