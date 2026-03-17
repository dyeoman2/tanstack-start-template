/**
 * Environment variable utilities for server-side code.
 * Provides automatic inference of common environment variables.
 */

import {
  DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT,
  parseTimestampLike,
} from '../shared/email-verification';

const TEST_BETTER_AUTH_SECRET = 'test-better-auth-secret-abcdefghijklmnopqrstuvwxyz';
const TEST_BETTER_AUTH_URL = 'http://127.0.0.1:3000';

type BetterAuthRuntimeConfig = {
  allowedHosts: string[];
  configuredOrigins: string[];
  isLoopback: boolean;
  protocol: 'http' | 'https';
  siteUrl: string;
};

function isTestRuntime() {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

/**
 * Automatically infer the site URL based on deployment environment.
 * Prefers explicit overrides and falls back to hosting platform defaults.
 */
export function getSiteUrl(): string {
  const candidates: Array<[string | undefined, string]> = [
    [process.env.BETTER_AUTH_URL, 'BETTER_AUTH_URL'],
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

export function getRequiredBetterAuthUrl(): string {
  return getBetterAuthRuntimeConfig().siteUrl;
}

export function getBetterAuthUrlForTooling(): string {
  const configuredUrl = process.env.BETTER_AUTH_URL?.trim();
  if (configuredUrl) {
    return parseBetterAuthUrl(configuredUrl, 'BETTER_AUTH_URL').origin;
  }

  return parseBetterAuthUrl(getSiteUrl(), 'site URL fallback').origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
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
  return resolveAbsoluteOrigin(value, label);
}

function normalizeAllowedHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      return `${url.hostname}${url.port ? `:${url.port}` : ''}`.toLowerCase();
    } catch {
      return null;
    }
  }

  if (trimmed.includes('/')) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function getBetterAuthAllowedHosts(siteUrl = getRequiredBetterAuthUrl()): string[] {
  const runtimeConfig =
    siteUrl === getRequiredBetterAuthUrl()
      ? getBetterAuthRuntimeConfig()
      : buildBetterAuthRuntimeConfig(siteUrl);
  return runtimeConfig.allowedHosts;
}

export function isTrustedBetterAuthOrigin(
  candidate: string,
  siteUrl = getRequiredBetterAuthUrl(),
): boolean {
  let origin: URL;
  try {
    origin = new URL(candidate);
  } catch {
    return false;
  }

  if (
    origin.protocol !== 'https:' &&
    !(origin.protocol === 'http:' && isLoopbackHostname(origin.hostname))
  ) {
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

export function getConfiguredBetterAuthOrigins(siteUrl = getRequiredBetterAuthUrl()): string[] {
  const runtimeConfig =
    siteUrl === getRequiredBetterAuthUrl()
      ? getBetterAuthRuntimeConfig()
      : buildBetterAuthRuntimeConfig(siteUrl);
  return runtimeConfig.configuredOrigins;
}

export function getBetterAuthTrustedOrigins(
  request?: Request,
  siteUrl = getRequiredBetterAuthUrl(),
): string[] {
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

export function shouldUseSecureAuthCookies(siteUrl = getRequiredBetterAuthUrl()): boolean {
  try {
    return new URL(siteUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function getBetterAuthRuntimeConfig(): BetterAuthRuntimeConfig {
  return buildBetterAuthRuntimeConfig(readBetterAuthUrlFromEnv());
}

function buildBetterAuthRuntimeConfig(siteUrl: string): BetterAuthRuntimeConfig {
  const parsedSiteUrl = parseBetterAuthUrl(siteUrl, 'BETTER_AUTH_URL');
  const allowedHosts = new Set<string>([parsedSiteUrl.host.toLowerCase()]);
  const configuredOrigins = new Set<string>([parsedSiteUrl.origin]);
  const isLoopback = isLoopbackHostname(parsedSiteUrl.hostname);

  if (isLoopback) {
    for (const loopbackHostPattern of getLoopbackHostPatterns()) {
      allowedHosts.add(loopbackHostPattern);
    }
    for (const loopbackOriginPattern of getLoopbackOriginPatterns()) {
      configuredOrigins.add(loopbackOriginPattern);
    }
  }

  for (const pattern of parseCsvEnv('BETTER_AUTH_PREVIEW_HOSTS')) {
    const normalized = normalizeAllowedHost(pattern);
    if (!normalized) {
      throw new Error(`BETTER_AUTH_PREVIEW_HOSTS contains an invalid host pattern: ${pattern}`);
    }

    allowedHosts.add(normalized);
  }

  for (const configuredOrigin of parseCsvEnv('BETTER_AUTH_TRUSTED_ORIGINS')) {
    const normalized = normalizeConfiguredOrigin(configuredOrigin, 'BETTER_AUTH_TRUSTED_ORIGINS');
    if (!normalized) {
      throw new Error(
        `BETTER_AUTH_TRUSTED_ORIGINS contains an invalid absolute origin: ${configuredOrigin}`,
      );
    }

    configuredOrigins.add(normalized);
  }

  return {
    allowedHosts: [...allowedHosts],
    configuredOrigins: [...configuredOrigins],
    isLoopback,
    protocol: parsedSiteUrl.protocol === 'http:' ? 'http' : 'https',
    siteUrl: parsedSiteUrl.origin,
  };
}

function readBetterAuthUrlFromEnv(): string {
  const value = process.env.BETTER_AUTH_URL?.trim();
  if (value) {
    return value;
  }

  if (isTestRuntime()) {
    return TEST_BETTER_AUTH_URL;
  }

  throw new Error(
    'BETTER_AUTH_URL environment variable is required for Better Auth configuration.',
  );
}

function parseBetterAuthUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a canonical origin without a path, query, or hash.`);
  }

  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))
  ) {
    throw new Error(`${label} must use https unless it points to a loopback host.`);
  }

  return parsed;
}

function resolveAbsoluteOrigin(value: string | undefined, label: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return parseBetterAuthUrl(value.trim(), label).origin;
  } catch {
    return null;
  }
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
    if (isTestRuntime()) {
      return TEST_BETTER_AUTH_SECRET;
    }

    throw new Error(
      'BETTER_AUTH_SECRET environment variable is required. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }

  if (secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32',
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

const DEFAULT_E2E_PRINCIPAL_EMAILS = ['e2e-user@local.test', 'e2e-admin@local.test'] as const;

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

export function isSafeE2EAuthRuntime(request?: Request): boolean {
  if (!request) {
    return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  }

  try {
    const { hostname } = new URL(request.url);
    return isLoopbackHostname(hostname);
  } catch {
    return false;
  }
}

export function getE2ETestSecret(): string {
  return getRequiredServerEnv('E2E_TEST_SECRET');
}

function readOptionalServerEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getGoogleOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId =
    readOptionalServerEnv('GOOGLE_CLIENT_ID') ??
    readOptionalServerEnv('BETTER_AUTH_GOOGLE_CLIENT_ID');
  const clientSecret =
    readOptionalServerEnv('GOOGLE_CLIENT_SECRET') ??
    readOptionalServerEnv('BETTER_AUTH_GOOGLE_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
  };
}

export function isGoogleWorkspaceOAuthConfigured(): boolean {
  return getGoogleOAuthCredentials() !== null;
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

export function isE2EPrincipalEmail(email: string): boolean {
  if (!isE2ETestAuthEnabled()) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  return [...DEFAULT_E2E_PRINCIPAL_EMAILS, process.env.E2E_USER_EMAIL, process.env.E2E_ADMIN_EMAIL]
    .map((value) => value?.trim().toLowerCase())
    .some((value) => value === normalizedEmail);
}
