import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAuthMock, getRequestMock, fetchAuthMutationMock, handleServerErrorMock } =
  vi.hoisted(() => ({
    requireAuthMock: vi.fn(),
    getRequestMock: vi.fn(),
    fetchAuthMutationMock: vi.fn(),
    handleServerErrorMock: vi.fn((error: unknown) => error),
  }));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator() {
      return this;
    },
    handler: (handler: (...args: unknown[]) => unknown) => handler,
  }),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    users: {
      ensureCurrentUserContext: 'ensureCurrentUserContext',
    },
  },
}));

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => getRequestMock(),
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthMutation: fetchAuthMutationMock,
  },
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  ServerError: class ServerError extends Error {
    statusCode: number;
    payload: unknown;

    constructor(message: string, statusCode: number, payload?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.payload = payload;
    }
  },
  handleServerError: handleServerErrorMock,
}));

import { leaveOrganizationServerFn } from './organization-membership';

describe('leaveOrganizationServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestMock.mockReturnValue(
      new Request('http://127.0.0.1:3000/app/organizations/acme/settings', {
        headers: {
          cookie: 'session=abc',
          origin: 'http://127.0.0.1:3000',
          referer: 'http://127.0.0.1:3000/app',
          'user-agent': 'vitest',
          'x-forwarded-for': '127.0.0.1',
        },
      }),
    );
    vi.stubGlobal('fetch', vi.fn());
  });

  it('leaves the organization and returns the next active organization id', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    fetchAuthMutationMock.mockResolvedValue({ organizationId: 'org_next' });

    await expect(
      leaveOrganizationServerFn({
        data: { organizationId: 'org_current' },
      }),
    ).resolves.toEqual({
      success: true,
      nextOrganizationId: 'org_next',
    });

    expect(requireAuthMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      new URL('/api/auth/organization/leave', 'http://127.0.0.1:3000/app/organizations/acme/settings'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ organizationId: 'org_current' }),
      }),
    );
    expect(fetchAuthMutationMock).toHaveBeenCalledWith('ensureCurrentUserContext', {});
  });

  it('wraps Better Auth endpoint failures', async () => {
    const failure = new Error('wrapped leave failure');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Cannot leave organization' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      leaveOrganizationServerFn({
        data: { organizationId: 'org_current' },
      }),
    ).rejects.toBe(failure);
    expect(handleServerErrorMock).toHaveBeenCalledWith(expect.any(Error), 'Leave organization');
  });
});
