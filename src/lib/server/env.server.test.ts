import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBetterAuthSecret, getSiteUrl } from '~/lib/server/env.server';

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

  it('warns for short Better Auth secrets', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.BETTER_AUTH_SECRET = 'short-secret';

    expect(getBetterAuthSecret()).toBe('short-secret');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('throws when Better Auth secret is missing', () => {
    expect(() => getBetterAuthSecret()).toThrow(/BETTER_AUTH_SECRET environment variable is required/);
  });
});
