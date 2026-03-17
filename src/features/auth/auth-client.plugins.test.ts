import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAuthClientMock = vi.fn();

vi.mock('@convex-dev/better-auth/client/plugins', () => ({
  convexClient: vi.fn(() => ({ id: 'convex' })),
}));

vi.mock('@better-auth/passkey/client', () => ({
  passkeyClient: vi.fn(() => ({ id: 'passkey' })),
}));

vi.mock('better-auth/client/plugins', () => ({
  adminClient: vi.fn(() => ({ id: 'admin' })),
  inferAdditionalFields: vi.fn(() => ({ id: 'inferAdditionalFields' })),
  organizationClient: vi.fn(() => ({ id: 'organization' })),
  twoFactorClient: vi.fn(() => ({ id: 'twoFactor' })),
}));

vi.mock('better-auth/react', () => ({
  createAuthClient: (options: unknown) => createAuthClientMock(options),
}));

describe('auth client plugin parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAuthClientMock.mockReturnValue({
      $Infer: {
        Session: {} as never,
      },
      signOut: vi.fn(),
      useSession: vi.fn(),
    });
  });

  it('registers the expected Better Auth client plugins', async () => {
    await import('./auth-client');

    expect(createAuthClientMock).toHaveBeenCalledTimes(1);
    const [{ plugins }] = createAuthClientMock.mock.calls[0] as [
      {
        plugins: Array<{ id: string }>;
      },
    ];

    expect(plugins.map((plugin) => plugin.id)).toEqual([
      'convex',
      'inferAdditionalFields',
      'admin',
      'organization',
      'passkey',
      'twoFactor',
    ]);

    const module = await import('./auth-client');
    expect(module.authHooks.useAuthQuery).toBeTypeOf('function');
    expect(module.authHooks.useListPasskeys).toBeTypeOf('function');
  });
});
