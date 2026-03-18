import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAuthMock, fetchAuthMutationMock, handleServerErrorMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
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
      markCurrentUserOnboardingComplete: 'markCurrentUserOnboardingComplete',
    },
  },
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
  handleServerError: handleServerErrorMock,
}));

import { markCurrentUserOnboardingCompleteServerFn } from './onboarding.server';

describe('markCurrentUserOnboardingCompleteServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires auth and marks onboarding complete', async () => {
    fetchAuthMutationMock.mockResolvedValue({ ok: true });

    await expect(markCurrentUserOnboardingCompleteServerFn()).resolves.toEqual({ ok: true });
    expect(requireAuthMock).toHaveBeenCalledTimes(1);
    expect(fetchAuthMutationMock).toHaveBeenCalledWith('markCurrentUserOnboardingComplete', {});
  });

  it('wraps downstream failures with handleServerError', async () => {
    const failure = new Error('mutation failed');
    const wrapped = new Error('wrapped failure');
    fetchAuthMutationMock.mockRejectedValue(failure);
    handleServerErrorMock.mockReturnValue(wrapped);

    await expect(markCurrentUserOnboardingCompleteServerFn()).rejects.toBe(wrapped);
    expect(handleServerErrorMock).toHaveBeenCalledWith(failure, 'Mark onboarding complete');
  });
});
