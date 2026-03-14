import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isE2EPrincipalEmail } from './env.server';

const ORIGINAL_ENV = { ...process.env };

describe('isE2EPrincipalEmail', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      ENABLE_E2E_TEST_AUTH: 'true',
      E2E_USER_EMAIL: 'e2e-user@local.test',
      E2E_ADMIN_EMAIL: 'e2e-admin@local.test',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('matches configured E2E principal emails case-insensitively', () => {
    expect(isE2EPrincipalEmail('E2E-USER@LOCAL.TEST')).toBe(true);
    expect(isE2EPrincipalEmail(' e2e-admin@local.test ')).toBe(true);
  });

  it('does not match non-E2E emails or disabled E2E mode', () => {
    expect(isE2EPrincipalEmail('person@example.com')).toBe(false);

    process.env.ENABLE_E2E_TEST_AUTH = 'false';
    expect(isE2EPrincipalEmail('e2e-user@local.test')).toBe(false);
  });
});
