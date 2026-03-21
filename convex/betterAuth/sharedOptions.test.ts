import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_SESSION_EXPIRES_IN_SECONDS,
  AUTH_SESSION_FRESH_AGE_SECONDS,
  AUTH_SESSION_UPDATE_AGE_SECONDS,
  createSharedBetterAuthOptions,
} from './sharedOptions';

const ORIGINAL_ENV = { ...process.env };

function createOptions() {
  return createSharedBetterAuthOptions({
    sendChangeEmailConfirmation: async () => {},
    sendInvitationEmail: async () => {},
    sendResetPassword: async () => {},
    sendVerificationEmail: async () => {},
  });
}

function getAfterHook(options: ReturnType<typeof createSharedBetterAuthOptions>) {
  const afterHooks = options.hooks?.after;
  if (!afterHooks) {
    throw new Error('Expected Better Auth after hook to be configured');
  }

  return afterHooks;
}

describe('createSharedBetterAuthOptions', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    };
    delete process.env.VITEST;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('keeps auth rate limiting enabled by default in development', () => {
    const options = createOptions();

    expect(options.rateLimit?.enabled).toBe(true);
    expect(options.rateLimit?.modelName).toBe('rateLimit');
  });

  it('sets a root Better Auth app name for provider and auth UX consistency', () => {
    const options = createOptions();

    expect(options.appName).toBe('TanStack Start Template');
  });

  it('sets explicit passkey relying-party metadata from the validated auth url', () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';

    const options = createOptions();
    const passkeyPlugin = (options.plugins ?? []).find(
      (plugin) => 'id' in plugin && plugin.id === 'passkey',
    ) as { options?: { origin?: string; rpID?: string; rpName?: string } } | undefined;

    expect(passkeyPlugin?.options?.origin).toBe('https://app.example.com');
    expect(passkeyPlugin?.options?.rpID).toBe('app.example.com');
    expect(passkeyPlugin?.options?.rpName).toBe('TanStack Start Template');
  });

  it('normalizes loopback passkey relying-party metadata to localhost for local dev', () => {
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';

    const options = createOptions();
    const passkeyPlugin = (options.plugins ?? []).find(
      (plugin) => 'id' in plugin && plugin.id === 'passkey',
    ) as { options?: { origin?: string; rpID?: string; rpName?: string } } | undefined;

    expect(passkeyPlugin?.options?.origin).toBe('http://localhost:3000');
    expect(passkeyPlugin?.options?.rpID).toBe('localhost');
    expect(passkeyPlugin?.options?.rpName).toBe('TanStack Start Template');
  });

  it('enables secure Better Auth cookies for https deployments', () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';

    const options = createOptions();

    expect(options.advanced?.useSecureCookies).toBe(true);
    expect(options.advanced?.defaultCookieAttributes?.secure).toBe(true);
  });

  it('ignores the disable-rate-limit env flag outside tests', () => {
    process.env.BETTER_AUTH_DISABLE_RATE_LIMIT = 'true';

    const options = createOptions();

    expect(options.rateLimit?.enabled).toBe(true);
  });

  it('revokes existing sessions on password reset', () => {
    const options = createOptions();

    expect(options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('explicitly enables email change support on the user config', () => {
    const options = createOptions();

    expect(options.user?.changeEmail?.enabled).toBe(true);
    expect(options.user?.changeEmail?.sendChangeEmailConfirmation).toBeTypeOf('function');
  });

  it('configures native passkey support on the server plugin list', () => {
    const options = createOptions();
    const pluginIds = (options.plugins ?? [])
      .map((plugin) => ('id' in plugin ? plugin.id : null))
      .filter((pluginId): pluginId is string => typeof pluginId === 'string');

    expect(pluginIds).toContain('admin');
    expect(pluginIds).toContain('organization');
    expect(pluginIds).toContain('scim');
    expect(pluginIds).toContain('convex');
    expect(pluginIds).toContain('passkey');
    expect(pluginIds).toContain('two-factor');
    expect(pluginIds).not.toContain('fresh-session');
  });

  it('keeps session storage and refresh windows explicit', () => {
    const options = createOptions();

    expect(options.session?.storeSessionInDatabase).toBe(true);
    expect(options.session?.expiresIn).toBe(AUTH_SESSION_EXPIRES_IN_SECONDS);
    expect(options.session?.updateAge).toBe(AUTH_SESSION_UPDATE_AGE_SECONDS);
    expect(options.session?.freshAge).toBe(AUTH_SESSION_FRESH_AGE_SECONDS);
    expect(options.session?.cookieCache?.enabled).toBe(false);
  });

  it('configures trusted origins through the Better Auth runtime callback', () => {
    const options = createOptions();

    expect(options.trustedOrigins).toBeTypeOf('function');
  });

  it('rejects auth requests from untrusted origins before processing credentials', async () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';
    const options = createOptions();
    const beforeHook = options.hooks?.before;
    if (!beforeHook) {
      throw new Error('Expected Better Auth before hook to be configured');
    }

    await expect(
      beforeHook({
        headers: new Headers({
          origin: 'https://evil.example.com',
        }),
        method: 'POST',
        path: '/sign-in/email',
      } as never),
    ).rejects.toMatchObject({
      body: {
        message: 'Origin is not allowed for this authentication request.',
      },
    });
  });

  it('blocks password auth through the before hook when org policy requires enterprise auth', async () => {
    const options = createSharedBetterAuthOptions({
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
      shouldBlockPasswordAuth: async () => 'Password sign-in is disabled for this account',
    });

    const beforeHook = options.hooks?.before;
    if (!beforeHook) {
      throw new Error('Expected Better Auth before hook to be configured');
    }

    await expect(
      beforeHook({
        body: { email: 'blocked@example.com' },
        context: {
          session: {
            user: {
              id: 'user_1',
            },
          },
        },
        method: 'POST',
        path: '/sign-in/email',
      } as never),
    ).rejects.toMatchObject({
      body: {
        message: 'Password sign-in is disabled for this account',
      },
    });
  });

  it('blocks change-email through the before hook when the session is no longer fresh', async () => {
    const options = createOptions();
    const beforeHook = options.hooks?.before;
    if (!beforeHook) {
      throw new Error('Expected Better Auth before hook to be configured');
    }

    await expect(
      beforeHook({
        context: {
          session: {
            session: {
              createdAt: Date.now() - 30 * 60 * 1000,
              updatedAt: Date.now() - 30 * 60 * 1000,
            },
            user: {
              id: 'user_1',
            },
          },
        },
        method: 'POST',
        path: '/change-email',
      } as never),
    ).rejects.toMatchObject({
      body: {
        message: 'Verify your account again before changing your sign-in email address.',
      },
    });
  });

  it('allows change-email through the before hook when the session is still fresh', async () => {
    const options = createOptions();
    const beforeHook = options.hooks?.before;
    if (!beforeHook) {
      throw new Error('Expected Better Auth before hook to be configured');
    }

    await expect(
      beforeHook({
        context: {
          session: {
            session: {
              createdAt: Date.now() - 60 * 1000,
              updatedAt: Date.now() - 60 * 1000,
            },
            user: {
              id: 'user_1',
            },
          },
        },
        method: 'POST',
        path: '/change-email',
      } as never),
    ).resolves.toBeUndefined();
  });

  it('enriches passkey sign-in sessions with the passkey auth method', async () => {
    const options = createOptions();
    const updateSession = vi.fn(async () => {});

    await getAfterHook(options)({
      context: {
        internalAdapter: {
          updateSession,
        },
        newSession: {
          session: {
            token: 'session_token',
          },
          user: {
            email: 'user@example.com',
            id: 'user_1',
          },
        },
        returned: new Response('{}', { status: 200 }),
      },
      path: '/sign-in/passkey',
    } as never);

    expect(updateSession).toHaveBeenCalledWith('session_token', {
      authMethod: 'passkey',
      enterpriseOrganizationId: null,
      enterpriseProtocol: null,
      enterpriseProviderKey: null,
    });
  });

  it('enriches email sign-in sessions with the password auth method', async () => {
    const options = createOptions();
    const updateSession = vi.fn(async () => {});

    await getAfterHook(options)({
      context: {
        internalAdapter: {
          updateSession,
        },
        newSession: {
          session: {
            token: 'session_token',
          },
          user: {
            email: 'user@example.com',
            id: 'user_1',
          },
        },
        returned: new Response('{}', { status: 200 }),
      },
      path: '/sign-in/email',
    } as never);

    expect(updateSession).toHaveBeenCalledWith('session_token', {
      authMethod: 'password',
      enterpriseOrganizationId: null,
      enterpriseProtocol: null,
      enterpriseProviderKey: null,
    });
  });

  it('enriches email sign-up sessions with the password auth method', async () => {
    const options = createOptions();
    const updateSession = vi.fn(async () => {});

    await getAfterHook(options)({
      context: {
        internalAdapter: {
          updateSession,
        },
        newSession: {
          session: {
            token: 'session_token',
          },
          user: {
            email: 'user@example.com',
            id: 'user_1',
          },
        },
        returned: new Response('{}', { status: 200 }),
      },
      path: '/sign-up/email',
    } as never);

    expect(updateSession).toHaveBeenCalledWith('session_token', {
      authMethod: 'password',
      enterpriseOrganizationId: null,
      enterpriseProtocol: null,
      enterpriseProviderKey: null,
    });
  });

  it('enriches callback sessions with enterprise metadata when resolved', async () => {
    const resolveEnterpriseAuthSession = vi.fn(async () => ({
      organizationId: 'org_1',
      protocol: 'oidc' as const,
      providerKey: 'okta' as const,
    }));
    const options = createSharedBetterAuthOptions({
      resolveEnterpriseAuthSession,
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
    });
    const updateSession = vi.fn(async () => {});

    await getAfterHook(options)({
      context: {
        internalAdapter: {
          updateSession,
        },
        newSession: {
          session: {
            token: 'session_token',
          },
          user: {
            email: 'user@example.com',
            id: 'user_1',
          },
        },
        returned: new Response('{}', { status: 200 }),
      },
      params: {
        providerId: 'oidc-provider',
      },
      path: '/callback/oidc-provider',
    } as never);

    expect(resolveEnterpriseAuthSession).toHaveBeenCalledWith({
      providerId: 'oidc-provider',
      userEmail: 'user@example.com',
      userId: 'user_1',
    });
    expect(updateSession).toHaveBeenCalledWith('session_token', {
      activeOrganizationId: 'org_1',
      authMethod: 'enterprise',
      enterpriseOrganizationId: 'org_1',
      enterpriseProtocol: 'oidc',
      enterpriseProviderKey: 'okta',
    });
  });

  it('uses the configured app name as the two-factor issuer', () => {
    process.env.APP_NAME = 'Hospital Starter';

    const options = createOptions();
    const twoFactorPlugin = (options.plugins ?? []).find(
      (plugin) => 'id' in plugin && plugin.id === 'two-factor',
    ) as { options?: { issuer?: string } } | undefined;

    expect(twoFactorPlugin?.options?.issuer).toBe('Hospital Starter');
  });
});
