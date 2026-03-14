import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchAuthQueryMock, actionMock, handleServerErrorMock } = vi.hoisted(() => ({
  fetchAuthQueryMock: vi.fn(),
  actionMock: vi.fn(),
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
      getUserCount: 'getUserCount',
      getCurrentUserProfile: 'getCurrentUserProfile',
    },
  },
  internal: {
    users: {
      bootstrapUserContext: 'bootstrapUserContext',
      rollbackBootstrapUserContext: 'rollbackBootstrapUserContext',
    },
  },
}));

vi.mock('~/lib/server/convex-admin.server', () => ({
  createConvexAdminClient: () => ({
    action: actionMock,
  }),
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthQuery: fetchAuthQueryMock,
  },
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  handleServerError: handleServerErrorMock,
}));

import { bootstrapSignedUpUserServerFn } from './user-management';

describe('bootstrapSignedUpUserServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns the first signed up user the admin role', async () => {
    fetchAuthQueryMock
      .mockResolvedValueOnce({ totalUsers: 1 })
      .mockResolvedValueOnce({ id: 'user_1', email: 'admin@example.com' });
    actionMock.mockResolvedValue({ found: true });

    const result = await bootstrapSignedUpUserServerFn();

    expect(actionMock).toHaveBeenCalledWith('bootstrapUserContext', {
      authUserId: 'user_1',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      role: 'admin',
    });
    expect(result).toEqual({
      success: true,
      isFirstUser: true,
      message: 'Admin account created. Check your inbox to verify your email.',
    });
  });

  it('rolls back the auth user when bootstrap fails', async () => {
    const bootstrapError = new Error('bootstrap failed');
    fetchAuthQueryMock
      .mockResolvedValueOnce({ totalUsers: 2 })
      .mockResolvedValueOnce({ id: 'user_2', email: 'user@example.com' });
    actionMock.mockRejectedValueOnce(bootstrapError).mockResolvedValueOnce({ success: true });

    await expect(bootstrapSignedUpUserServerFn()).rejects.toBe(bootstrapError);

    expect(actionMock).toHaveBeenNthCalledWith(1, 'bootstrapUserContext', {
      authUserId: 'user_2',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      role: 'user',
    });
    expect(actionMock).toHaveBeenNthCalledWith(2, 'rollbackBootstrapUserContext', {
      authUserId: 'user_2',
      email: 'user@example.com',
    });
  });

  it('fails closed when counting users fails before bootstrap', async () => {
    const countError = new Error('count failed');
    fetchAuthQueryMock
      .mockRejectedValueOnce(countError)
      .mockResolvedValueOnce({ id: 'user_3', email: 'user3@example.com' });
    actionMock.mockResolvedValueOnce({ success: true });

    await expect(bootstrapSignedUpUserServerFn()).rejects.toBe(countError);

    expect(actionMock).toHaveBeenCalledTimes(1);
    expect(actionMock).toHaveBeenCalledWith('rollbackBootstrapUserContext', {
      authUserId: 'user_3',
      email: 'user3@example.com',
    });
  });
});
