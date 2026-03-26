import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PROXY_IP_HEADER } from '../../src/lib/server/better-auth/http';
import {
  AUTH_SESSION_EXPIRES_IN_SECONDS,
  AUTH_SESSION_FRESH_AGE_SECONDS,
  AUTH_SESSION_UPDATE_AGE_SECONDS,
  createSharedBetterAuthOptions,
} from './sharedOptions';

const ORIGINAL_ENV = { ...process.env };

function createOptions() {
  return createSharedBetterAuthOptions({
    consumeStepUpClaim: async () => {},
    issueStepUpClaim: async () => {},
    recordStepUpCompletion: async () => {},
    recordStepUpConsumed: async () => {},
    recordStepUpFailure: async () => {},
    recordStepUpRequired: async () => {},
    resolveStepUpClaimStatus: async () => false,
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
      BETTER_AUTH_SECRET: 'test-secret-abcdefghijklmnopqrstuvwxyz',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    };
    delete process.env.VITEST;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('disables auth rate limiting in development', () => {
    const options = createOptions();

    expect(options.rateLimit?.enabled).toBe(false);
    expect(options.rateLimit?.modelName).toBe('rateLimit');
    expect(options.rateLimit?.customRules?.['/sign-up/email']).toEqual({
      window: 60 * 60,
      max: 5,
    });
    expect(options.rateLimit?.customRules?.['/send-verification-email']).toEqual({
      window: 60 * 60,
      max: 3,
    });
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

  it('keeps development rate limiting disabled even when the explicit disable flag is set', () => {
    process.env.BETTER_AUTH_DISABLE_RATE_LIMIT = 'true';

    const options = createOptions();

    expect(options.rateLimit?.enabled).toBe(false);
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

  it('trusts only the canonical signed auth proxy ip header', () => {
    const options = createOptions();

    expect(options.advanced?.ipAddress?.ipAddressHeaders).toEqual([AUTH_PROXY_IP_HEADER]);
  });

  it('configures Better Auth with versioned secrets when present', () => {
    process.env.BETTER_AUTH_SECRETS =
      '2:new-secret-value-with-at-least-32-chars,1:old-secret-value-with-at-least-32-chars';

    const options = createOptions() as {
      secret?: string;
      secrets?: Array<{ version: number; value: string }>;
    };

    expect(options.secret).toBe('new-secret-value-with-at-least-32-chars');
    expect(options.secrets).toEqual([
      { version: 2, value: 'new-secret-value-with-at-least-32-chars' },
      { version: 1, value: 'old-secret-value-with-at-least-32-chars' },
    ]);
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

  it('blocks change-email through the before hook when the explicit step-up claim is missing', async () => {
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
              id: 'session_1',
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

  it('passes request metadata into admin step-up challenge callbacks', async () => {
    const recordAdminStepUpChallenge = vi.fn(async () => {});
    const options = createSharedBetterAuthOptions({
      recordAdminStepUpChallenge,
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
    });
    const beforeHook = options.hooks?.before;
    if (!beforeHook) {
      throw new Error('Expected Better Auth before hook to be configured');
    }

    await expect(
      beforeHook({
        body: { id: 'user_2' },
        context: {
          session: {
            session: {
              id: 'session_1',
            },
            user: {
              id: 'user_1',
            },
          },
        },
        headers: new Headers({
          [AUTH_PROXY_IP_HEADER]: '203.0.113.9',
          'user-agent': 'Vitest',
          'x-request-id': 'req-123',
        }),
        method: 'POST',
        path: '/admin/get-user',
      } as never),
    ).rejects.toMatchObject({
      body: {
        message: 'Verify your account again before viewing another user record.',
      },
    });

    expect(recordAdminStepUpChallenge).toHaveBeenCalledWith({
      ipAddress: '203.0.113.9',
      path: '/admin/get-user',
      reason: 'Verify your account again before viewing another user record.',
      requirement: 'user_administration',
      requestId: 'req-123',
      resourceId: 'user_2',
      sessionId: 'session_1',
      userAgent: 'Vitest',
      userId: 'user_1',
    });
  });

  it('allows change-email through the before hook when the step-up claim exists', async () => {
    const options = createSharedBetterAuthOptions({
      consumeStepUpClaim: async () => {},
      issueStepUpClaim: async () => {},
      recordStepUpCompletion: async () => {},
      recordStepUpConsumed: async () => {},
      recordStepUpFailure: async () => {},
      recordStepUpRequired: async () => {},
      resolveStepUpClaimStatus: async () => true,
      sendChangeEmailConfirmation: async () => {},
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
    });
    const beforeHook = options.hooks?.before;
    if (!beforeHook) {
      throw new Error('Expected Better Auth before hook to be configured');
    }

    await expect(
      beforeHook({
        context: {
          session: {
            session: {
              id: 'session_1',
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
      mfaVerified: true,
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
      mfaVerified: false,
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
      mfaVerified: false,
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
      mfaVerified: false,
      enterpriseOrganizationId: 'org_1',
      enterpriseProtocol: 'oidc',
      enterpriseProviderKey: 'okta',
    });
  });

  it('finalizes OAuth account state before resolving enterprise session data', async () => {
    const finalizeOAuthAccountState = vi.fn(async () => {});
    const resolveEnterpriseAuthSession = vi.fn(async () => null);
    const options = createSharedBetterAuthOptions({
      finalizeOAuthAccountState,
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
        providerId: 'google',
      },
      path: '/callback/google',
    } as never);

    expect(finalizeOAuthAccountState).toHaveBeenCalledWith({
      providerId: 'google',
      userId: 'user_1',
    });
    expect(resolveEnterpriseAuthSession).toHaveBeenCalledWith({
      providerId: 'google',
      userEmail: 'user@example.com',
      userId: 'user_1',
    });
    expect(finalizeOAuthAccountState.mock.invocationCallOrder[0]).toBeLessThan(
      resolveEnterpriseAuthSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('marks the session as MFA-verified after TOTP verification', async () => {
    const options = createOptions();
    const updateSession = vi.fn(async () => {});

    await getAfterHook(options)({
      context: {
        internalAdapter: {
          updateSession,
        },
        newSession: {
          session: {
            id: 'session_1',
            token: 'session_token',
          },
          user: {
            email: 'user@example.com',
            id: 'user_1',
          },
        },
        returned: new Response('{}', { status: 200 }),
      },
      path: '/two-factor/verify-totp',
    } as never);

    expect(updateSession).toHaveBeenCalledWith('session_token', {
      mfaVerified: true,
    });
  });

  it('marks the session as MFA-verified after backup-code verification', async () => {
    const options = createOptions();
    const updateSession = vi.fn(async () => {});

    await getAfterHook(options)({
      context: {
        internalAdapter: {
          updateSession,
        },
        newSession: {
          session: {
            id: 'session_1',
            token: 'session_token',
          },
          user: {
            email: 'user@example.com',
            id: 'user_1',
          },
        },
        returned: new Response('{}', { status: 200 }),
      },
      path: '/two-factor/verify-backup-code',
    } as never);

    expect(updateSession).toHaveBeenCalledWith('session_token', {
      mfaVerified: true,
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
