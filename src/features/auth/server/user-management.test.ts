import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchAuthActionMock, handleServerErrorMock } = vi.hoisted(() => ({
  fetchAuthActionMock: vi.fn(),
  handleServerErrorMock: vi.fn((error: unknown) => error),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: {
      parse: (input: unknown) => unknown;
    } | null = null;

    return {
      inputValidator(nextValidator: { parse: (input: unknown) => unknown }) {
        validator = nextValidator;
        return this;
      },
      handler(handler: (input: { data: unknown }) => unknown) {
        return (input: { data: unknown }) => {
          const data = validator ? validator.parse(input.data) : input.data;
          return handler({ ...input, data });
        };
      },
    };
  },
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    users: {
      bootstrapCurrentUserContext: 'bootstrapCurrentUserContext',
      rollbackCurrentUserBootstrapContext: 'rollbackCurrentUserBootstrapContext',
    },
  },
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
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
    fetchAuthActionMock.mockResolvedValue({ found: true, assignedRole: 'admin' });

    const result = await bootstrapSignedUpUserServerFn({
      data: { authUserId: 'user_1', email: 'admin@example.com' },
    });

    expect(fetchAuthActionMock).toHaveBeenCalledWith('bootstrapCurrentUserContext', {});
    expect(result).toEqual({
      success: true,
      isFirstUser: true,
      message: 'Admin account created. Check your inbox to verify your email.',
    });
  });

  it('rolls back the auth user when bootstrap fails', async () => {
    const bootstrapError = new Error('bootstrap failed');
    fetchAuthActionMock.mockRejectedValueOnce(bootstrapError).mockResolvedValueOnce({
      success: true,
    });

    await expect(
      bootstrapSignedUpUserServerFn({
        data: { authUserId: 'user_2', email: 'user@example.com' },
      }),
    ).rejects.toBe(bootstrapError);

    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(1, 'bootstrapCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(
      2,
      'rollbackCurrentUserBootstrapContext',
      {},
    );
  });

  it('fails closed when the signup payload is invalid', async () => {
    expect(() =>
      bootstrapSignedUpUserServerFn({
        data: { authUserId: '', email: 'user3@example.com' },
      }),
    ).toThrow('Too small');

    expect(fetchAuthActionMock).not.toHaveBeenCalled();
  });
});
