import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBetterAuthAllowedHosts,
  getBetterAuthBaseUrlConfig,
  getBetterAuthSecret,
  getBetterAuthTrustedOrigins,
  getEmailVerificationEnforcedAt,
  getSiteUrl,
  isTrustedBetterAuthOrigin,
} from '~/lib/server/env.server';

const ORIGINAL_ENV = { ...process.env };

describe('env.server', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BETTER_AUTH_SITE_URL;
    delete process.env.BETTER_AUTH_BASE_URL;
    delete process.env.SITE_URL;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.APP_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_URL;
    delete process.env.DEPLOY_PRIME_URL;
    delete process.env.BETTER_AUTH_PREVIEW_HOSTS;
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    delete process.env.EMAIL_VERIFICATION_ENFORCED_AT;
    delete process.env.VITE_EMAIL_VERIFICATION_ENFORCED_AT;
    delete process.env.BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT;
    delete process.env.VITE_BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT;
    delete process.env.BETTER_AUTH_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers the first valid configured site url', () => {
    process.env.BETTER_AUTH_SITE_URL = ' https://primary.example.com/path ';
    process.env.SITE_URL = 'https://secondary.example.com';

    expect(getSiteUrl()).toBe('https://primary.example.com');
  });

  it('normalizes protocol-less values to https origins', () => {
    process.env.PUBLIC_SITE_URL = 'preview.example.com/some/path';

    expect(getSiteUrl()).toBe('https://preview.example.com');
  });

  it('skips invalid candidates and falls back to localhost', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.BETTER_AUTH_SITE_URL = 'not a valid url value with spaces';
    process.env.SITE_URL = '   ';

    expect(getSiteUrl()).toBe('http://localhost:3000');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('returns the configured Better Auth secret', () => {
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);

    expect(getBetterAuthSecret()).toBe('x'.repeat(32));
  });

  it('adds both local loopback origins for local development', () => {
    process.env.BETTER_AUTH_SITE_URL = 'http://127.0.0.1:3000';

    expect(getBetterAuthTrustedOrigins()).toEqual([
      'http://127.0.0.1:3000',
      'http://localhost:*',
      'http://127.0.0.1:*',
    ]);
  });

  it('warns for short Better Auth secrets', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.BETTER_AUTH_SECRET = 'short-secret';

    expect(getBetterAuthSecret()).toBe('short-secret');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('includes preview host patterns in the allowed host list', () => {
    process.env.BETTER_AUTH_SITE_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = '*.netlify.app, preview-*.example.dev';

    expect(getBetterAuthAllowedHosts()).toEqual([
      'app.example.com',
      'localhost:*',
      '127.0.0.1:*',
      '*.netlify.app',
      'preview-*.example.dev',
    ]);
  });

  it('preserves explicit ports in allowed host patterns', () => {
    process.env.BETTER_AUTH_SITE_URL = 'http://127.0.0.1:3000';

    expect(getBetterAuthAllowedHosts()).toEqual(['127.0.0.1:3000', 'localhost:*', '127.0.0.1:*']);
  });

  it('builds a dynamic Better Auth base url config without fallback for non-local hosts', () => {
    process.env.BETTER_AUTH_SITE_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = '*.netlify.app';

    expect(getBetterAuthBaseUrlConfig()).toEqual({
      allowedHosts: ['app.example.com', 'localhost:*', '127.0.0.1:*', '*.netlify.app'],
      protocol: 'auto',
    });
  });

  it('preserves fallback for loopback site urls', () => {
    process.env.BETTER_AUTH_SITE_URL = 'http://127.0.0.1:3000';

    expect(getBetterAuthBaseUrlConfig()).toEqual({
      allowedHosts: ['127.0.0.1:3000', 'localhost:*', '127.0.0.1:*'],
      fallback: 'http://127.0.0.1:3000',
      protocol: 'http',
    });
  });

  it('treats matching preview origins as trusted request origins', () => {
    process.env.BETTER_AUTH_SITE_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = '*.netlify.app';

    expect(isTrustedBetterAuthOrigin('https://feature-123.netlify.app')).toBe(true);
    expect(isTrustedBetterAuthOrigin('https://evil.example.org')).toBe(false);
  });

  it('matches trusted loopback origins by host and port', () => {
    process.env.BETTER_AUTH_SITE_URL = 'http://127.0.0.1:3000';

    expect(isTrustedBetterAuthOrigin('http://localhost:3000')).toBe(true);
    expect(isTrustedBetterAuthOrigin('http://localhost:4000')).toBe(true);
  });

  it('adds a trusted request origin when the request host matches the configured policy', () => {
    process.env.BETTER_AUTH_SITE_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = '*.netlify.app';

    const request = new Request('https://feature-123.netlify.app/app');

    expect(getBetterAuthTrustedOrigins(request)).toEqual([
      'https://app.example.com',
      'http://localhost:*',
      'http://127.0.0.1:*',
      'https://feature-123.netlify.app',
    ]);
  });

  it('does not add development loopback wildcards in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.BETTER_AUTH_SITE_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = '*.netlify.app';

    expect(getBetterAuthAllowedHosts()).toEqual(['app.example.com', '*.netlify.app']);
    expect(getBetterAuthTrustedOrigins()).toEqual(['https://app.example.com']);
  });

  it('returns the configured email verification rollout timestamp when present', () => {
    process.env.EMAIL_VERIFICATION_ENFORCED_AT = '2026-03-15T00:00:00.000Z';

    expect(getEmailVerificationEnforcedAt()).toBe(Date.parse('2026-03-15T00:00:00.000Z'));
  });

  it('falls back to the legacy Better Auth env name', () => {
    process.env.BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT = '2026-03-16T00:00:00.000Z';

    expect(getEmailVerificationEnforcedAt()).toBe(Date.parse('2026-03-16T00:00:00.000Z'));
  });

  it('throws when Better Auth secret is missing', () => {
    expect(() => getBetterAuthSecret()).toThrow(
      /BETTER_AUTH_SECRET environment variable is required/,
    );
  });
});
