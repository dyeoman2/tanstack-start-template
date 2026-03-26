import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMock = vi.hoisted(() => vi.fn());
const createConvexPublicClientMock = vi.hoisted(() =>
  vi.fn(() => ({
    action: actionMock,
  })),
);
const handleServerErrorMock = vi.hoisted(() => vi.fn((error) => error));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator() {
      return this;
    },
    handler(fn: unknown) {
      return fn;
    },
  }),
}));

vi.mock('~/lib/server/convex-admin.server', () => ({
  createConvexPublicClient: createConvexPublicClientMock,
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  handleServerError: handleServerErrorMock,
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    organizationManagement: {
      resolveOrganizationEnterpriseAuthByEmail:
        'organizationManagement.resolveOrganizationEnterpriseAuthByEmail',
    },
  },
}));

import { resolveEnterpriseAuthDiscoveryServerFn } from './enterprise-auth';

describe('resolveEnterpriseAuthDiscoveryServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the public enterprise auth action through the public Convex client', async () => {
    actionMock.mockResolvedValue({
      canUsePasswordFallback: false,
      protocol: 'oidc',
      providerKey: 'google-workspace',
      requiresEnterpriseAuth: true,
    });

    await expect(
      resolveEnterpriseAuthDiscoveryServerFn({
        data: { email: 'clinician@example.com' },
      }),
    ).resolves.toEqual({
      canUsePasswordFallback: false,
      protocol: 'oidc',
      providerKey: 'google-workspace',
      requiresEnterpriseAuth: true,
    });

    expect(createConvexPublicClientMock).toHaveBeenCalledTimes(1);
    expect(actionMock).toHaveBeenCalledWith(
      'organizationManagement.resolveOrganizationEnterpriseAuthByEmail',
      {
        email: 'clinician@example.com',
      },
    );
  });

  it('wraps errors with the standard server error helper', async () => {
    const failure = new Error('boom');
    actionMock.mockRejectedValue(failure);
    const wrapped = new Error('wrapped');
    handleServerErrorMock.mockReturnValue(wrapped);

    await expect(
      resolveEnterpriseAuthDiscoveryServerFn({
        data: { email: 'clinician@example.com' },
      }),
    ).rejects.toBe(wrapped);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      failure,
      'Resolve enterprise auth discovery',
    );
  });
});
