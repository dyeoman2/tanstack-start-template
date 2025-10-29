import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { redirect } from '@tanstack/react-router';
import { getCookie, getRequest } from '@tanstack/react-start/server';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

// Type definitions for user roles
export type UserRole = 'user' | 'admin';

export interface AuthenticatedUser {
  id: string;
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
    const request = getCurrentRequest();
    if (!request) {
      return null;
    }

    // Get the Convex site URL from environment
    const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
    if (!convexSiteUrl) {
      throw new Error('VITE_CONVEX_SITE_URL environment variable is required');
    }

    // Call Convex Better Auth HTTP handler to get session
    // Forward the original request headers (including cookies) to Convex
    const headers = new Headers(request.headers);
    headers.set('accept-encoding', 'application/json');

    const response = await fetch(`${convexSiteUrl}/api/auth/get-session`, {
      method: 'GET',
      headers,
      redirect: 'manual',
    });

    if (!response.ok) {
      return null;
    }

    const sessionData = await response.json();

    if (!sessionData?.user?.id) {
      return null;
    }

    // Fetch role from userProfiles table via Convex
    // Role is stored separately from Better Auth's user table
    try {
      const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
      const profile = await fetchQuery(api.users.getCurrentUserProfile, {});

      return {
        id: sessionData.user.id,
        email: sessionData.user.email,
        role: (profile?.role === 'admin' ? 'admin' : 'user') as UserRole,
        name: sessionData.user.name,
      };
    } catch (profileError) {
      // If profile fetch fails, still return user but with default role
      // This can happen if user hasn't been fully set up yet
      console.warn('[Auth Guard] Failed to fetch user profile, using default role:', profileError);
      return {
        id: sessionData.user.id,
        email: sessionData.user.email,
        role: 'user',
        name: sessionData.user.name,
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
