import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('current session helpers', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('normalizes active sessions and marks the current session', async () => {
    const { normalizeCurrentUserSessionRecords } = await import('./auth');

    const sessions = normalizeCurrentUserSessionRecords(
      [
        {
          id: 'session-current',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_100_000,
          expiresAt: 1_700_000_200_000,
          ipAddress: '10.0.0.1',
          userAgent: 'Mozilla/5.0 Chrome',
        },
        {
          id: 'session-expired',
          createdAt: 1_699_999_000_000,
          updatedAt: 1_699_999_100_000,
          expiresAt: 1_699_999_200_000,
          ipAddress: '10.0.0.2',
          userAgent: 'Mozilla/5.0 Safari',
        },
        {
          id: 'session-other',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_150_000,
          expiresAt: 1_700_000_300_000,
          ipAddress: null,
          userAgent: null,
        },
      ],
      'session-current',
      1_700_000_120_000,
    );

    expect(sessions).toEqual([
      {
        id: 'session-other',
        isCurrent: false,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_150_000,
        expiresAt: 1_700_000_300_000,
        ipAddress: null,
        userAgent: null,
      },
      {
        id: 'session-current',
        isCurrent: true,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
        expiresAt: 1_700_000_200_000,
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0 Chrome',
      },
    ]);
  });

  it('finds a revocable session by public id and skips expired sessions', async () => {
    const { findRevocableCurrentUserSession } = await import('./auth');

    const sessions = [
      {
        id: 'session-current',
        token: 'token-current',
        userId: 'user-1',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
        expiresAt: 1_700_000_200_000,
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0 Chrome',
      },
      {
        id: 'session-expired',
        token: 'token-expired',
        userId: 'user-1',
        createdAt: 1_699_999_000_000,
        updatedAt: 1_699_999_100_000,
        expiresAt: 1_699_999_200_000,
        ipAddress: '10.0.0.2',
        userAgent: 'Mozilla/5.0 Safari',
      },
    ];

    expect(findRevocableCurrentUserSession(sessions, 'session-current', 1_700_000_120_000)).toEqual(
      sessions[0],
    );
    expect(findRevocableCurrentUserSession(sessions, 'session-expired', 1_700_000_120_000)).toBe(
      null,
    );
    expect(findRevocableCurrentUserSession(sessions, 'missing', 1_700_000_120_000)).toBe(null);
  });
});
