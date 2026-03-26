import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRequestMock = vi.fn();
const fetchAuthQueryMock = vi.fn();
const redirectMock = vi.fn((options: unknown) => {
  return new Response(JSON.stringify(options), { status: 302 });
});
const hasStepUpClaimForCurrentRequestMock = vi.fn();
const createStepUpChallengeForCurrentUserMock = vi.fn();

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => getRequestMock(),
}));

vi.mock('@tanstack/react-router', () => ({
  redirect: (options: unknown) => redirectMock(options),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    stepUp: {
      hasCurrentClaim: 'stepUp.hasCurrentClaim',
    },
    users: {
      getCurrentUserProfile: 'getCurrentUserProfile',
    },
  },
}));

vi.mock('./convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthQuery: (...args: unknown[]) => fetchAuthQueryMock(...args),
  },
}));

vi.mock('~/lib/server/better-auth/fresh-session.server', () => ({
  hasStepUpClaimForCurrentRequest: () => hasStepUpClaimForCurrentRequestMock(),
}));

vi.mock('./step-up.server', () => ({
  createStepUpChallengeForCurrentUser: (...args: unknown[]) =>
    createStepUpChallengeForCurrentUserMock(...args),
}));

import { USER_ROLES } from '../types';
import { requireAdmin, requireAuth, requireRecentStepUp } from './auth-guards';

describe('auth-guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(
      (import.meta as ImportMeta & { env: Record<string, unknown> }).env,
      'SSR',
      {
        value: true,
        configurable: true,
      },
    );
    getRequestMock.mockReturnValue(new Request('http://127.0.0.1:3000/app'));
    hasStepUpClaimForCurrentRequestMock.mockResolvedValue(false);
    createStepUpChallengeForCurrentUserMock.mockResolvedValue({
      challengeId: '550e8400-e29b-41d4-a716-446655440000',
      redirectTo: '/app/profile',
      requirement: 'organization_admin',
    });
  });

  it('redirects to login when the profile is missing required session fields', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      role: USER_ROLES.USER,
    });

    await expect(requireAuth()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({ to: '/login' });
  });

  it('redirects to login when reading the auth profile fails', async () => {
    fetchAuthQueryMock.mockRejectedValue(new Error('convex down'));

    await expect(requireAuth()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({ to: '/login' });
  });

  it('redirects non-admin users from requireAdmin', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      email: 'user@example.com',
      role: USER_ROLES.USER,
    });

    await expect(requireAdmin()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({ to: '/login' });
  });

  it('redirects site admins without MFA to account setup', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      email: 'admin@example.com',
      role: USER_ROLES.ADMIN,
      emailVerified: true,
      requiresMfaSetup: true,
    });

    await expect(requireAdmin()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({
      to: '/account-setup',
      search: {
        email: 'admin@example.com',
        redirectTo: '/app',
      },
    });
  });

  it('redirects newly unverified users to account setup', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      email: 'user@example.com',
      role: USER_ROLES.USER,
      emailVerified: false,
      requiresEmailVerification: true,
    });

    await expect(requireAuth()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({
      to: '/account-setup',
      search: {
        email: 'user@example.com',
        redirectTo: '/app',
      },
    });
  });

  it('redirects when the Better Auth session is not fresh enough for a privileged action', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      email: 'user@example.com',
      role: USER_ROLES.USER,
      emailVerified: true,
    });
    hasStepUpClaimForCurrentRequestMock.mockResolvedValue(false);
    await expect(requireRecentStepUp()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({
      to: '/app/profile',
      search: {
        challengeId: '550e8400-e29b-41d4-a716-446655440000',
        security: 'step-up-required',
      },
    });
  });

  it('succeeds when recent step-up is fresh', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      email: 'user@example.com',
      role: USER_ROLES.USER,
      emailVerified: true,
    });
    hasStepUpClaimForCurrentRequestMock.mockResolvedValue(true);

    await expect(requireRecentStepUp()).resolves.toHaveProperty('user');
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
