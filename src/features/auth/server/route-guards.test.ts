import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAuthMock, redirectMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  redirectMock: vi.fn((options: unknown) => new Response(JSON.stringify(options), { status: 302 })),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (handler: (...args: unknown[]) => unknown) => handler,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  redirect: (options: unknown) => redirectMock(options),
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

import { USER_ROLES } from '../types';
import { routeAdminGuard } from './route-guards';

const adminLocation = {
  pathname: '/app/admin',
  href: 'http://127.0.0.1:3000/app/admin',
  publicHref: 'http://127.0.0.1:3000/app/admin',
  external: false,
  search: {},
  searchStr: '',
  state: {},
  hash: '',
  maskedLocation: undefined,
  unmaskOnReload: false,
} as const;

describe('routeAdminGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(
      (import.meta as ImportMeta & { env: Record<string, unknown> }).env,
      'DEV',
      {
        value: false,
        configurable: true,
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the authenticated admin context', async () => {
    requireAuthMock.mockResolvedValue({
      user: {
        id: 'user_123',
        email: 'admin@example.com',
        role: USER_ROLES.ADMIN,
        isSiteAdmin: true,
        name: 'Admin',
      },
    });

    await expect(routeAdminGuard({ location: adminLocation })).resolves.toEqual({
      authenticated: true,
      user: {
        id: 'user_123',
        email: 'admin@example.com',
        role: USER_ROLES.ADMIN,
        isSiteAdmin: true,
        name: 'Admin',
      },
    });
  });

  it('redirects non-admin users to login with a reset flag', async () => {
    requireAuthMock.mockResolvedValue({
      user: {
        id: 'user_123',
        email: 'user@example.com',
        role: USER_ROLES.USER,
        isSiteAdmin: false,
      },
    });

    await expect(routeAdminGuard({ location: adminLocation })).rejects.toMatchObject({
      status: 302,
    });
    expect(redirectMock).toHaveBeenCalledWith({
      to: '/login',
      search: { reset: '', redirectTo: adminLocation.href },
    });
  });

  it('rethrows redirect responses from the auth check', async () => {
    const redirectResponse = new Response(null, { status: 302 });
    requireAuthMock.mockRejectedValue(redirectResponse);

    await expect(routeAdminGuard({ location: adminLocation })).rejects.toBe(redirectResponse);
  });

  it('redirects to login when the auth check times out', async () => {
    vi.useFakeTimers();
    requireAuthMock.mockReturnValue(new Promise(() => {}));

    const result = routeAdminGuard({ location: adminLocation }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toMatchObject({ status: 302 });
    expect(redirectMock).toHaveBeenCalledWith({
      to: '/login',
      search: { redirectTo: adminLocation.href },
    });
  });
});
