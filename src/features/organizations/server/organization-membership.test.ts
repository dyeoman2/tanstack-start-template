import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuthMock,
  leaveBetterAuthOrganizationMock,
  fetchAuthActionMock,
  fetchAuthQueryMock,
  handleServerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  leaveBetterAuthOrganizationMock: vi.fn(),
  fetchAuthActionMock: vi.fn(),
  fetchAuthQueryMock: vi.fn(),
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
      getCurrentUserProfile: 'getCurrentUserProfile',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
    fetchAuthQuery: fetchAuthQueryMock,
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

vi.mock('~/lib/server/better-auth/api', () => ({
  leaveBetterAuthOrganization: leaveBetterAuthOrganizationMock,
}));

import { leaveOrganizationServerFn } from './organization-membership';

describe('leaveOrganizationServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves the organization and returns the next active organization id', async () => {
    leaveBetterAuthOrganizationMock.mockResolvedValue({ success: true });
    fetchAuthActionMock.mockResolvedValue({ organizationId: 'org_next' });
    fetchAuthQueryMock.mockResolvedValue({
      currentOrganization: {
        id: 'org_next',
      },
    });

    await expect(
      leaveOrganizationServerFn({
        data: { organizationId: 'org_current' },
      }),
    ).resolves.toEqual({
      success: true,
      nextOrganizationId: 'org_next',
    });

    expect(requireAuthMock).toHaveBeenCalledTimes(1);
    expect(leaveBetterAuthOrganizationMock).toHaveBeenCalledWith('org_current');
    expect(fetchAuthActionMock).toHaveBeenCalledWith('ensureCurrentUserContext', {});
    expect(fetchAuthQueryMock).toHaveBeenCalledWith('getCurrentUserProfile', {});
  });

  it('wraps Better Auth action failures', async () => {
    const failure = new Error('wrapped leave failure');
    leaveBetterAuthOrganizationMock.mockRejectedValue(new Error('Cannot leave organization'));
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      leaveOrganizationServerFn({
        data: { organizationId: 'org_current' },
      }),
    ).rejects.toBe(failure);
    expect(handleServerErrorMock).toHaveBeenCalledWith(expect.any(Error), 'Leave organization');
  });
});
