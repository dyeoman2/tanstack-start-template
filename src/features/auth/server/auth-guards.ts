import { redirect } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';
import { eq } from 'drizzle-orm';
import * as schema from '~/db/schema';
import { getDb } from '~/lib/server/db-config.server';
import { auth } from './betterAuth';

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
 * Get the current session and user information
 * Returns null if not authenticated
 */
async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  try {
    const request = getCurrentRequest();
    if (!request) {
      return null;
    }

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      return null;
    }

    // Fetch the user role from the database since it's not included in the session
    const userRecord = await getDb()
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, session.user.id))
      .limit(1);

    if (userRecord.length === 0) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      role: userRecord[0].role as UserRole,
      name: session.user.name,
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
