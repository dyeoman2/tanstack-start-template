import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionMock, handleServerErrorMock } = vi.hoisted(() => ({
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
    users: {},
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

vi.mock('~/lib/server/error-utils.server', () => ({
  handleServerError: handleServerErrorMock,
}));

import { bootstrapSignedUpUserServerFn } from './user-management';

describe('bootstrapSignedUpUserServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns the first signed up user the admin role', async () => {
    actionMock.mockResolvedValue({ found: true, assignedRole: 'admin' });

    const result = await bootstrapSignedUpUserServerFn({
      data: { authUserId: 'user_1', email: 'admin@example.com' },
    });

    expect(actionMock).toHaveBeenCalledWith('bootstrapUserContext', {
      authUserId: 'user_1',
      email: 'admin@example.com',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(result).toEqual({
      success: true,
      isFirstUser: true,
      message: 'Admin account created. Check your inbox to verify your email.',
    });
  });

  it('rolls back the auth user when bootstrap fails', async () => {
    const bootstrapError = new Error('bootstrap failed');
    actionMock.mockRejectedValueOnce(bootstrapError).mockResolvedValueOnce({ success: true });

    await expect(
      bootstrapSignedUpUserServerFn({
        data: { authUserId: 'user_2', email: 'user@example.com' },
      }),
    ).rejects.toBe(bootstrapError);

    expect(actionMock).toHaveBeenNthCalledWith(1, 'bootstrapUserContext', {
      authUserId: 'user_2',
      email: 'user@example.com',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(actionMock).toHaveBeenNthCalledWith(2, 'rollbackBootstrapUserContext', {
      authUserId: 'user_2',
      email: 'user@example.com',
    });
  });

  it('fails closed when the signup payload is invalid', async () => {
    await expect(
      bootstrapSignedUpUserServerFn({
        data: { authUserId: '', email: 'user3@example.com' },
      }),
    ).rejects.toThrow('Authenticated signup context is unavailable');

    expect(actionMock).not.toHaveBeenCalled();
  });
});
