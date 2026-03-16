import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSharedBetterAuthOptions } from './sharedOptions';

const ORIGINAL_ENV = { ...process.env };

function createOptions() {
  return createSharedBetterAuthOptions({
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
    delete process.env.BETTER_AUTH_DISABLE_RATE_LIMIT;
    delete process.env.VITEST;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('keeps auth rate limiting enabled by default in development', () => {
    const options = createOptions();

    expect(options.rateLimit?.enabled).toBe(true);
  });

  it('allows explicitly disabling auth rate limiting with an env flag', () => {
    process.env.BETTER_AUTH_DISABLE_RATE_LIMIT = 'true';

    const options = createOptions();

    expect(options.rateLimit?.enabled).toBe(false);
  });

  it('revokes existing sessions on password reset', () => {
    const options = createOptions();

    expect(options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('calls the explicit password-auth-blocked callback before throwing', async () => {
    const onPasswordAuthBlocked = vi.fn(async () => {});
    const options = createSharedBetterAuthOptions({
      onPasswordAuthBlocked,
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

    expect(onPasswordAuthBlocked).toHaveBeenCalledWith({
      email: 'blocked@example.com',
      message: 'Password sign-in is disabled for this account',
      path: '/sign-in/email',
      sessionUserId: 'user_1',
    });
  });

  it('calls the password reset denied callback from the Better Auth after hook', async () => {
    const onPasswordResetDenied = vi.fn(async () => {});
    const options = createSharedBetterAuthOptions({
      onPasswordResetDenied,
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
    });

    await getAfterHook(options)({
      body: { email: 'reset@example.com' },
      context: {
        returned: new Response(JSON.stringify({ message: 'Reset token expired' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
        session: {
          user: {
            id: 'user_1',
          },
        },
      },
      path: '/reset-password',
    } as never);

    expect(onPasswordResetDenied).toHaveBeenCalledWith({
      email: 'reset@example.com',
      errorCode: undefined,
      message: 'Reset token expired',
      path: '/reset-password',
      sessionUserId: 'user_1',
      status: 400,
    });
  });

  it('calls the email verification denied callback from the Better Auth after hook', async () => {
    const onEmailVerificationDenied = vi.fn(async () => {});
    const options = createSharedBetterAuthOptions({
      onEmailVerificationDenied,
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
    });

    await getAfterHook(options)({
      context: {
        returned: new Response(JSON.stringify({ message: 'Verification token invalid' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
        session: {
          user: {
            id: 'user_1',
          },
        },
      },
      path: '/verify-email',
    } as never);

    expect(onEmailVerificationDenied).toHaveBeenCalledWith({
      errorCode: undefined,
      message: 'Verification token invalid',
      path: '/verify-email',
      sessionUserId: 'user_1',
      status: 403,
    });
  });

  it('calls the sign-in denied callback from the Better Auth after hook', async () => {
    const onSignInDenied = vi.fn(async () => {});
    const options = createSharedBetterAuthOptions({
      onSignInDenied,
      sendInvitationEmail: async () => {},
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
    });

    await getAfterHook(options)({
      body: { email: 'user@example.com', provider: 'password' },
      context: {
        returned: new Response(
          JSON.stringify({
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
        session: null,
      },
      path: '/sign-in/email',
    } as never);

    expect(onSignInDenied).toHaveBeenCalledWith({
      email: 'user@example.com',
      errorCode: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      path: '/sign-in/email',
      provider: 'password',
      sessionUserId: undefined,
      status: 401,
    });
  });
});
