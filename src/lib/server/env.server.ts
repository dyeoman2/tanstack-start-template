/**
 * Environment variable utilities for server-side code.
 * Provides automatic inference of common environment variables.
 */

import {
  DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT,
  parseTimestampLike,
} from '../shared/email-verification';

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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isDevelopmentRuntime(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function getLoopbackHostPatterns(): string[] {
  return ['localhost:*', '127.0.0.1:*'];
}

function getLoopbackOriginPatterns(): string[] {
  return ['http://localhost:*', 'http://127.0.0.1:*'];
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function matchesWildcardPattern(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedPattern || !normalizedValue) {
    return false;
  }

  if (!normalizedPattern.includes('*')) {
    return normalizedValue === normalizedPattern;
  }

  const regex = new RegExp(`^${normalizedPattern.split('*').map(escapeRegex).join('.*')}$`, 'i');

  return regex.test(normalizedValue);
}

function parseCsvEnv(name: string): string[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeConfiguredOrigin(value: string, label: string): string | null {
  return resolveSiteUrlCandidate(value, label);
}

function normalizeAllowedHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).host.toLowerCase();
    } catch {
      return null;
    }
  }

  return trimmed.toLowerCase();
}

export function getBetterAuthAllowedHosts(siteUrl = getSiteUrl()): string[] {
  const allowedHosts = new Set<string>();

  try {
    const origin = new URL(siteUrl);
    allowedHosts.add(origin.host.toLowerCase());

    if (isLoopbackHostname(origin.hostname) || isDevelopmentRuntime()) {
      for (const loopbackHostPattern of getLoopbackHostPatterns()) {
        allowedHosts.add(loopbackHostPattern);
      }
    }
  } catch {
    // Ignore malformed site url here; caller already has fallback behavior.
  }

  for (const pattern of parseCsvEnv('BETTER_AUTH_PREVIEW_HOSTS')) {
    const normalized = normalizeAllowedHost(pattern);
    if (normalized) {
      allowedHosts.add(normalized);
    }
  }

  return [...allowedHosts];
}

export function isTrustedBetterAuthOrigin(candidate: string, siteUrl = getSiteUrl()): boolean {
  let origin: URL;
  try {
    origin = new URL(candidate);
  } catch {
    return false;
  }

  const host = origin.host.toLowerCase();
  const hostname = origin.hostname.toLowerCase();
  const allowedHosts = getBetterAuthAllowedHosts(siteUrl);

  if (
    allowedHosts.some(
      (pattern) =>
        matchesWildcardPattern(host, pattern) || matchesWildcardPattern(hostname, pattern),
    )
  ) {
    return true;
  }

  const configuredOrigins = getConfiguredBetterAuthOrigins(siteUrl);
  return configuredOrigins.some((configuredOrigin) => configuredOrigin === origin.origin);
}

export function getConfiguredBetterAuthOrigins(siteUrl = getSiteUrl()): string[] {
  const trustedOrigins = new Set<string>([siteUrl]);

  try {
    const origin = new URL(siteUrl);

    if (isLoopbackHostname(origin.hostname) || isDevelopmentRuntime()) {
      for (const loopbackOriginPattern of getLoopbackOriginPatterns()) {
        trustedOrigins.add(loopbackOriginPattern);
      }
    }
  } catch {
    // getSiteUrl already normalizes inputs, so this is only a defensive fallback.
  }

  for (const configuredOrigin of parseCsvEnv('BETTER_AUTH_TRUSTED_ORIGINS')) {
    const normalized = normalizeConfiguredOrigin(configuredOrigin, 'BETTER_AUTH_TRUSTED_ORIGINS');
    if (normalized) {
      trustedOrigins.add(normalized);
    }
  }

  return [...trustedOrigins];
}

export function getBetterAuthTrustedOrigins(request?: Request, siteUrl = getSiteUrl()): string[] {
  const trustedOrigins = new Set<string>(getConfiguredBetterAuthOrigins(siteUrl));

  if (!request) {
    return [...trustedOrigins];
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    if (isTrustedBetterAuthOrigin(requestOrigin, siteUrl)) {
      trustedOrigins.add(requestOrigin);
    }
  } catch {
    // Ignore invalid request urls.
  }

  return [...trustedOrigins];
}

export function getBetterAuthBaseUrlConfig():
  | string
  | {
      allowedHosts: string[];
      fallback?: string;
      protocol?: 'auto' | 'http' | 'https';
    } {
  const siteUrl = getSiteUrl();
  const allowedHosts = getBetterAuthAllowedHosts(siteUrl);

  if (allowedHosts.length === 0) {
    return siteUrl;
  }

  const isLoopbackSiteUrl = (() => {
    try {
      return isLoopbackHostname(new URL(siteUrl).hostname);
    } catch {
      return false;
    }
  })();
  const protocol = siteUrl.startsWith('http://') ? 'http' : 'auto';
  return {
    allowedHosts,
    protocol,
    ...(isLoopbackSiteUrl ? { fallback: siteUrl } : {}),
  };
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

export function getEmailVerificationEnforcedAt(): number {
  const configuredValue =
    readOptionalEnv('EMAIL_VERIFICATION_ENFORCED_AT') ??
    readOptionalEnv('VITE_EMAIL_VERIFICATION_ENFORCED_AT') ??
    readOptionalEnv('BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT') ??
    readOptionalEnv('VITE_BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT');
  const parsed = parseTimestampLike(configuredValue);

  return parsed ?? DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT;
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

function readOptionalEnv(name: string): string | undefined {
  try {
    return process.env[name];
  } catch {
    return undefined;
  }
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
