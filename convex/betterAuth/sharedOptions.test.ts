import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSharedBetterAuthOptions } from './sharedOptions';

const ORIGINAL_ENV = { ...process.env };

function createOptions() {
  return createSharedBetterAuthOptions({
    sendInvitationEmail: async () => {},
    sendResetPassword: async () => {},
    sendVerificationEmail: async () => {},
  });
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
});
