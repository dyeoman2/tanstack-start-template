import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';

const ORIGINAL_ENV = { ...process.env };

describe('shouldSkipE2EAuthEmailForTesting', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      ENABLE_E2E_TEST_AUTH: 'true',
      E2E_USER_EMAIL: 'e2e-user@local.test',
      E2E_ADMIN_EMAIL: 'e2e-admin@local.test',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('skips auth email callbacks for configured E2E principals', async () => {
    const { shouldSkipE2EAuthEmailForTesting } = await import('./lib/betterAuthEmailServices');

    expect(shouldSkipE2EAuthEmailForTesting('e2e-user@local.test')).toBe(true);
    expect(shouldSkipE2EAuthEmailForTesting('E2E-ADMIN@LOCAL.TEST')).toBe(true);
  });

  it('does not skip auth email callbacks for normal users', async () => {
    const { shouldSkipE2EAuthEmailForTesting } = await import('./lib/betterAuthEmailServices');

    expect(shouldSkipE2EAuthEmailForTesting('person@example.com')).toBe(false);
  });

  it('rewrites auth email urls only for trusted request origins', async () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = 'preview.example.com';
    const { resolveAuthEmailUrl } = await import('./lib/betterAuthEmailServices');

    expect(
      resolveAuthEmailUrl(
        '/reset-password?token=abc',
        new Request('https://preview.example.com/api/auth/request-password-reset'),
      ),
    ).toBe('https://preview.example.com/reset-password?token=abc');

    expect(
      resolveAuthEmailUrl(
        '/reset-password?token=abc',
        new Request('https://malicious.example.net/api/auth/request-password-reset'),
      ),
    ).toBe('https://app.example.com/reset-password?token=abc');
  });

  it('normalizes loopback auth email urls to localhost for local happy-path flows', async () => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
    const { resolveAuthEmailUrl } = await import('./lib/betterAuthEmailServices');

    expect(
      resolveAuthEmailUrl(
        '/verify-email?token=abc',
        new Request('http://127.0.0.1:3000/api/auth/send-verification-email'),
      ),
    ).toBe('http://localhost:3000/verify-email?token=abc');
  });

  it('schedules the change-email confirmation mutation with the normalized payload', async () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = 'preview.example.com';
    const runAfterMock = vi.fn(async () => {});
    const { createSendChangeEmailConfirmationHandler } =
      await import('./lib/betterAuthEmailServices');

    const sendChangeEmailConfirmation = createSendChangeEmailConfirmationHandler({
      scheduler: {
        runAfter: runAfterMock,
      },
    } as never);

    await sendChangeEmailConfirmation(
      {
        newEmail: 'updated@example.com',
        token: 'change-token',
        url: '/confirm-email-change?token=change-token',
        user: {
          id: 'user_1',
          createdAt: new Date('2026-03-01T12:00:00Z'),
          updatedAt: new Date('2026-03-02T12:00:00Z'),
          email: 'current@example.com',
          emailVerified: true,
          name: 'Doctor Meredith Grey',
        },
      },
      new Request('https://preview.example.com/api/auth/change-email'),
    );

    expect(runAfterMock).toHaveBeenCalledWith(
      0,
      internal.emails.sendChangeEmailConfirmationMutation,
      {
        user: {
          id: 'user_1',
          email: 'current@example.com',
          name: 'Doctor Meredith Grey',
        },
        newEmail: 'updated@example.com',
        token: 'change-token',
        url: 'https://preview.example.com/confirm-email-change?token=change-token',
      },
    );
  });
});
