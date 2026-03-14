import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getBetterAuthAllowedHosts,
  getBetterAuthBaseUrlConfig,
  getBetterAuthSecret,
  getBetterAuthTrustedOrigins,
  getRequiredBetterAuthUrl,
  isE2EPrincipalEmail,
  isSafeE2EAuthRuntime,
  shouldUseSecureAuthCookies,
} from './env.server';

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

describe('Better Auth env helpers', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers BETTER_AUTH_URL over generic site url envs', () => {
    process.env.BETTER_AUTH_URL = 'https://auth.example.com';
    process.env.SITE_URL = 'https://site.example.com';

    expect(getBetterAuthAllowedHosts()).toEqual(['auth.example.com']);
    expect(getBetterAuthTrustedOrigins()).toEqual(['https://auth.example.com']);
  });

  it('builds allowed hosts and trusted origins for preview deployments', () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = 'preview.example.com,*.branch.example.dev';
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'https://admin.example.com';

    expect(getBetterAuthAllowedHosts()).toEqual([
      'app.example.com',
      'preview.example.com',
      '*.branch.example.dev',
    ]);
    expect(getBetterAuthTrustedOrigins(new Request('https://preview.example.com/app'))).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
      'https://preview.example.com',
    ]);
  });

  it('keeps loopback hosts flexible for local development', () => {
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';

    expect(getBetterAuthAllowedHosts()).toEqual(['127.0.0.1:3000', 'localhost:*', '127.0.0.1:*']);
    expect(getBetterAuthTrustedOrigins(new Request('http://localhost:4173/app'))).toEqual([
      'http://127.0.0.1:3000',
      'http://localhost:*',
      'http://127.0.0.1:*',
      'http://localhost:4173',
    ]);
    expect(getBetterAuthBaseUrlConfig()).toEqual({
      allowedHosts: ['127.0.0.1:3000', 'localhost:*', '127.0.0.1:*'],
      fallback: 'http://127.0.0.1:3000',
      protocol: 'http',
    });
  });

  it('requires BETTER_AUTH_URL for Better Auth configuration', () => {
    delete process.env.BETTER_AUTH_URL;
    process.env.SITE_URL = 'https://site.example.com';

    expect(() => getRequiredBetterAuthUrl()).toThrow(
      'BETTER_AUTH_URL environment variable is required for Better Auth configuration.',
    );
    expect(() => getBetterAuthAllowedHosts()).toThrow(
      'BETTER_AUTH_URL environment variable is required for Better Auth configuration.',
    );
    expect(() => getBetterAuthBaseUrlConfig()).toThrow(
      'BETTER_AUTH_URL environment variable is required for Better Auth configuration.',
    );
  });

  it('requires a strong BETTER_AUTH_SECRET', () => {
    process.env.BETTER_AUTH_SECRET = 'short-secret';

    expect(() => getBetterAuthSecret()).toThrow(
      'BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32',
    );
  });

  it('uses secure cookies only for https site urls', () => {
    expect(shouldUseSecureAuthCookies('https://app.example.com')).toBe(true);
    expect(shouldUseSecureAuthCookies('http://127.0.0.1:3000')).toBe(false);
    expect(shouldUseSecureAuthCookies('not-a-url')).toBe(false);
  });

  it('allows e2e auth only in tests or loopback runtimes', () => {
    process.env.NODE_ENV = 'development';

    expect(isSafeE2EAuthRuntime(new Request('http://127.0.0.1:3000/api/test/e2e-auth'))).toBe(
      true,
    );
    expect(isSafeE2EAuthRuntime(new Request('https://app.example.com/api/test/e2e-auth'))).toBe(
      false,
    );

    process.env.NODE_ENV = 'test';
    expect(isSafeE2EAuthRuntime()).toBe(true);
  });
});
