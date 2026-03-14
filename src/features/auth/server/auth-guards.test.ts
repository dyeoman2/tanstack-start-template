import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRequestMock = vi.fn();
const fetchAuthQueryMock = vi.fn();
const redirectMock = vi.fn((options: unknown) => {
  return new Response(JSON.stringify(options), { status: 302 });
});

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => getRequestMock(),
}));

vi.mock('@tanstack/react-router', () => ({
  redirect: (options: unknown) => redirectMock(options),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
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

import { USER_ROLES } from '../types';
import { requireAdmin, requireAuth } from './auth-guards';

describe('auth-guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty((import.meta as ImportMeta & { env: Record<string, unknown> }).env, 'SSR', {
      value: true,
      configurable: true,
    });
    getRequestMock.mockReturnValue(new Request('http://127.0.0.1:3000/app'));
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

  it('redirects newly unverified users to the verification pending route', async () => {
    fetchAuthQueryMock.mockResolvedValue({
      id: 'user_123',
      email: 'user@example.com',
      role: USER_ROLES.USER,
      emailVerified: false,
      requiresEmailVerification: true,
    });

    await expect(requireAuth()).rejects.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({
      to: '/verify-email-pending',
      search: {
        email: 'user@example.com',
        redirectTo: '/app',
      },
    });
  });
});
