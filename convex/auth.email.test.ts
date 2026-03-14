import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
    const { shouldSkipE2EAuthEmailForTesting } = await import('./auth');

    expect(shouldSkipE2EAuthEmailForTesting('e2e-user@local.test')).toBe(true);
    expect(shouldSkipE2EAuthEmailForTesting('E2E-ADMIN@LOCAL.TEST')).toBe(true);
  });

  it('does not skip auth email callbacks for normal users', async () => {
    const { shouldSkipE2EAuthEmailForTesting } = await import('./auth');

    expect(shouldSkipE2EAuthEmailForTesting('person@example.com')).toBe(false);
  });
});
