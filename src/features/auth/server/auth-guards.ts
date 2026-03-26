import { api } from '@convex/_generated/api';
import { redirect } from '@tanstack/react-router';
import { getRequest } from '@tanstack/react-start/server';
import { deriveIsSiteAdmin, normalizeUserRole } from '~/features/auth/lib/user-role';
import { hasStepUpClaimForCurrentRequest } from '~/lib/server/better-auth/fresh-session.server';
import {
  buildStepUpRedirectSearch,
  STEP_UP_REQUIREMENTS,
  type StepUpRequirement,
} from '~/lib/shared/auth-policy';
import type { UserId } from '~/lib/shared/user-id';
import { normalizeUserId } from '~/lib/shared/user-id';
import type { UserRole } from '../types';
import { normalizeAppRedirectTarget } from '../lib/account-setup-routing';
import { convexAuthReactStart } from './convex-better-auth-react-start';
import { createStepUpChallengeForCurrentUser } from './step-up.server';

export interface AuthenticatedUser {
  id: UserId;
  email: string;
  role: UserRole;
  isSiteAdmin: boolean;
  emailVerified: boolean;
  requiresEmailVerification: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  requiresMfaSetup: boolean;
  recentStepUpAt: number | null;
  recentStepUpValidUntil: number | null;
  name?: string;
}

export interface AuthResult {
  user: AuthenticatedUser;
}

function getCurrentRequest(): Request | undefined {
  if (!import.meta.env.SSR && process.env.VITEST !== 'true') {
    throw new Error('Authentication utilities must run on the server');
  }

  return getRequest();
}

function getNormalizedSetupRedirectTarget(request: Request | undefined) {
  if (!request) {
    return '/app';
  }

  return normalizeAppRedirectTarget(new URL(request.url).pathname);
}

/**
 * Get the current session and user information from Convex Better Auth
 * Returns null if not authenticated
 *
 * Note: Better Auth remains the source of truth for the global role.
 * The Convex profile query returns the app projection used by routes and UI.
 */
async function getCurrentProfile() {
  let request: Request | undefined;
  try {
    request = getCurrentRequest();
  } catch {
    return null;
  }

  if (!request) {
    return null;
  }

  try {
    return await convexAuthReactStart.fetchAuthQuery(api.users.getCurrentUserProfile, {});
  } catch {
    return null;
  }
}

function mapProfileToAuthenticatedUser(
  profile: Awaited<ReturnType<typeof convexAuthReactStart.fetchAuthQuery>>,
): AuthenticatedUser | null {
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
    emailVerified: profile?.emailVerified ?? false,
    requiresEmailVerification: profile?.requiresEmailVerification ?? false,
    mfaEnabled: profile?.mfaEnabled ?? false,
    mfaRequired: profile?.mfaRequired ?? true,
    requiresMfaSetup: profile?.requiresMfaSetup ?? true,
    recentStepUpAt: profile?.recentStepUpAt ?? null,
    recentStepUpValidUntil: profile?.recentStepUpValidUntil ?? null,
    name: typeof profile?.name === 'string' ? profile.name : undefined,
  };
}

/**
 * Require authentication
 */
export async function requireAuth(): Promise<AuthResult> {
  const request = getCurrentRequest();
  const profile = await getCurrentProfile();
  if (!profile) {
    throw redirect({ to: '/login' });
  }

  if ((profile?.requiresEmailVerification && !profile.emailVerified) || profile?.requiresMfaSetup) {
    throw redirect({
      to: '/account-setup',
      search: {
        ...(typeof profile.email === 'string' && profile.email.length > 0
          ? { email: profile.email }
          : {}),
        redirectTo: getNormalizedSetupRedirectTarget(request),
      },
    });
  }

  const user = mapProfileToAuthenticatedUser(profile);
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

export async function requireRecentStepUp(
  requirement: StepUpRequirement = STEP_UP_REQUIREMENTS.organizationAdmin,
): Promise<AuthResult> {
  const result = await requireAuth();
  const isSatisfied = await hasStepUpClaimForCurrentRequest(requirement).catch(() => false);

  if (!isSatisfied) {
    const challenge = await createStepUpChallengeForCurrentUser({
      redirectTo: '/app/profile',
      requirement,
    });
    throw redirect({
      to: '/app/profile',
      search: buildStepUpRedirectSearch(challenge.challengeId),
    });
  }

  return result;
}
