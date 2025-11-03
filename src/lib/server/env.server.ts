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
