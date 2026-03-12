/**
 * Environment variable utilities for server-side code.
 * Provides automatic inference of common environment variables.
 */

/**
 * Automatically infer the site URL based on deployment environment.
 * Prefers explicit overrides and falls back to hosting platform defaults.
 */
export function getSiteUrl(): string {
  const candidates: Array<[string | undefined, string]> = [
    [process.env.BETTER_AUTH_SITE_URL, 'BETTER_AUTH_SITE_URL'],
    [process.env.BETTER_AUTH_BASE_URL, 'BETTER_AUTH_BASE_URL'],
    [process.env.SITE_URL, 'SITE_URL'],
    [process.env.PUBLIC_SITE_URL, 'PUBLIC_SITE_URL'],
    [process.env.NEXT_PUBLIC_SITE_URL, 'NEXT_PUBLIC_SITE_URL'],
    [process.env.APP_URL, 'APP_URL'],
    [process.env.URL, 'URL'],
    [process.env.DEPLOY_URL, 'DEPLOY_URL'],
    [process.env.DEPLOY_PRIME_URL, 'DEPLOY_PRIME_URL'],
  ];

  for (const [value, label] of candidates) {
    const resolved = resolveSiteUrlCandidate(value, label);
    if (resolved) {
      return resolved;
    }
  }

  // Local development - default fallback
  return 'http://localhost:3000';
}

export function getBetterAuthTrustedOrigins(siteUrl = getSiteUrl()): string[] {
  const trustedOrigins = new Set<string>([siteUrl]);

  try {
    const origin = new URL(siteUrl);
    const isLoopbackHost = origin.hostname === 'localhost' || origin.hostname === '127.0.0.1';

    if (isLoopbackHost) {
      trustedOrigins.add(`http://localhost:${origin.port || '3000'}`);
      trustedOrigins.add(`http://127.0.0.1:${origin.port || '3000'}`);
    }
  } catch {
    // getSiteUrl already normalizes inputs, so this is only a defensive fallback.
  }

  return [...trustedOrigins];
}

function resolveSiteUrlCandidate(value: string | undefined, label: string): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    console.warn(`Ignoring invalid ${label} value for site URL: ${trimmed}`);
    return null;
  }
}

/**
 * Get the Better Auth secret, with validation.
 */
export function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET environment variable is required. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }

  // Basic validation - should be at least 32 bytes when base64 encoded
  if (secret.length < 32) {
    console.warn(
      'BETTER_AUTH_SECRET appears to be too short. Should be at least 32 bytes base64 encoded.',
    );
  }

  return secret;
}

export type E2EPrincipalType = 'user' | 'admin';

export type E2EPrincipalConfig = {
  email: string;
  name: string;
  password: string;
  role: E2EPrincipalType;
};

function getRequiredServerEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function isE2ETestAuthEnabled(): boolean {
  return process.env.ENABLE_E2E_TEST_AUTH === 'true';
}

export function getE2ETestSecret(): string {
  return getRequiredServerEnv('E2E_TEST_SECRET');
}

export function getE2EPrincipalConfig(principal: E2EPrincipalType): E2EPrincipalConfig {
  if (principal === 'admin') {
    return {
      email: getRequiredServerEnv('E2E_ADMIN_EMAIL'),
      name: process.env.E2E_ADMIN_NAME?.trim() || 'E2E Admin',
      password: getRequiredServerEnv('E2E_ADMIN_PASSWORD'),
      role: 'admin',
    };
  }

  return {
    email: getRequiredServerEnv('E2E_USER_EMAIL'),
    name: process.env.E2E_USER_NAME?.trim() || 'E2E User',
    password: getRequiredServerEnv('E2E_USER_PASSWORD'),
    role: 'user',
  };
}
