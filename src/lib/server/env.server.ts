/**
 * Environment variable utilities for server-side code.
 * Provides automatic inference of common environment variables.
 */

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

export function getRequiredBetterAuthUrl(): string {
  return getBetterAuthRuntimeConfig().siteUrl;
}

export function getBetterAuthUrlForTooling(): string {
  const configuredUrl = process.env.BETTER_AUTH_URL?.trim();
  if (configuredUrl) {
    return parseBetterAuthUrl(configuredUrl, 'BETTER_AUTH_URL').origin;
  }

  return TEST_BETTER_AUTH_URL;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function getLoopbackHostPatterns(): string[] {
  return ['localhost:*', '127.0.0.1:*'];
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

function shouldUseEnvBackedBetterAuthRuntimeConfig(siteUrl: string): boolean {
  const envUrl = process.env.BETTER_AUTH_URL?.trim();
  if (!envUrl) {
    return false;
  }

  try {
    return (
      parseBetterAuthUrl(envUrl, 'BETTER_AUTH_URL').origin ===
      parseBetterAuthUrl(siteUrl, 'BETTER_AUTH_URL').origin
    );
  } catch {
    return false;
  }
}

export function getBetterAuthAllowedHosts(siteUrl = getRequiredBetterAuthUrl()): string[] {
  const runtimeConfig = shouldUseEnvBackedBetterAuthRuntimeConfig(siteUrl)
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

function getConfiguredBetterAuthOrigins(siteUrl: string): string[] {
  const runtimeConfig = shouldUseEnvBackedBetterAuthRuntimeConfig(siteUrl)
    ? getBetterAuthRuntimeConfig()
    : buildBetterAuthRuntimeConfig(siteUrl);
  return runtimeConfig.configuredOrigins;
}

export function getBetterAuthTrustedOrigins(
  request?: Request,
  /** Align with {@link getBetterAuthUrlForTooling} so Convex/dev works before BETTER_AUTH_URL is set on the deployment. */
  siteUrl = getBetterAuthUrlForTooling(),
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
    // Better Auth matches Origins against this list by string equality — wildcards are invalid
    // URLs and never match. Mirror localhost ↔ 127.0.0.1 so either dev URL works.
    const mirror = new URL(parsedSiteUrl.href);
    const loopHost = mirror.hostname.toLowerCase();
    if (loopHost === '127.0.0.1' || loopHost === 'localhost') {
      mirror.hostname = loopHost === '127.0.0.1' ? 'localhost' : '127.0.0.1';
      configuredOrigins.add(mirror.origin);
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

export type E2EPrincipalType = 'user' | 'admin';
export type FileStorageBackendMode = 'convex' | 's3-primary' | 's3-mirror';
export type StorageBucketKind = 'clean' | 'mirror' | 'quarantine' | 'rejected';
export type StorageCapability =
  | 'cleanup'
  | 'downloadPresign'
  | 'mirror'
  | 'promotion'
  | 'rejection'
  | 'uploadPresign';

export type StorageBucketConfig = {
  bucket: string | null;
  kmsKeyArn: string | null;
};

export type StorageRoleConfig = Record<StorageCapability, string | null>;

export type StorageRuntimeConfig = {
  awsRegion: string | null;
  backendMode: FileStorageBackendMode;
  convexSiteUrl: string | null;
  fileServeSigningSecret: string | null;
  fileUploadMaxBytes: number;
  guardDutyWebhookSharedSecret: string | null;
  malwareScanSlaMs: number;
  mirrorRetryBaseDelayMs: number;
  mirrorRetryMaxDelayMs: number;
  s3DeleteMaxAttempts: number;
  s3OrphanCleanupMaxScan: number;
  s3OrphanCleanupMinAgeMs: number;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
  storageInspectionWebhookSharedSecret: string | null;
  storageRoleArns: StorageRoleConfig;
  storageStaleUploadTtlMs: number;
};

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

function parsePositiveInteger(value: string | null, name: string, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readRequiredStorageEnv(name: string, mode: FileStorageBackendMode): string {
  const value = readOptionalServerEnv(name);
  if (!value) {
    throw new Error(`${name} environment variable is required for FILE_STORAGE_BACKEND=${mode}.`);
  }
  return value;
}

function readOptionalStorageEnv(name: string, legacyName?: string): string | null {
  return readOptionalServerEnv(name) ?? (legacyName ? readOptionalServerEnv(legacyName) : null);
}

function readRequiredStorageEnvWithFallback(
  name: string,
  mode: FileStorageBackendMode,
  legacyName?: string,
): string {
  const value = readOptionalStorageEnv(name, legacyName);
  if (!value) {
    const fallbackNote = legacyName ? ` (deprecated fallback: ${legacyName})` : '';
    throw new Error(
      `${name} environment variable is required for FILE_STORAGE_BACKEND=${mode}.${fallbackNote}`,
    );
  }
  return value;
}

function readStorageBucketConfig(
  kind: StorageBucketKind,
  mode: FileStorageBackendMode,
): StorageBucketConfig {
  const bucketEnv = `AWS_S3_${kind.toUpperCase()}_BUCKET`;
  const kmsEnv = `AWS_S3_${kind.toUpperCase()}_KMS_KEY_ARN`;

  if (mode === 'convex') {
    return {
      bucket: readOptionalStorageEnv(bucketEnv, 'AWS_S3_FILES_BUCKET'),
      kmsKeyArn: readOptionalStorageEnv(kmsEnv, 'AWS_S3_FILES_KMS_KEY_ARN'),
    };
  }

  return {
    bucket: readRequiredStorageEnvWithFallback(bucketEnv, mode, 'AWS_S3_FILES_BUCKET'),
    kmsKeyArn: readRequiredStorageEnvWithFallback(kmsEnv, mode, 'AWS_S3_FILES_KMS_KEY_ARN'),
  };
}

function readStorageRoleConfig(mode: FileStorageBackendMode): StorageRoleConfig {
  const readRole = (name: string) =>
    mode === 'convex' ? readOptionalServerEnv(name) : readRequiredStorageEnv(name, mode);

  return {
    cleanup: readRole('AWS_STORAGE_ROLE_ARN_CLEANUP'),
    downloadPresign: readRole('AWS_STORAGE_ROLE_ARN_DOWNLOAD_PRESIGN'),
    mirror: readRole('AWS_STORAGE_ROLE_ARN_MIRROR'),
    promotion: readRole('AWS_STORAGE_ROLE_ARN_PROMOTION'),
    rejection: readRole('AWS_STORAGE_ROLE_ARN_REJECTION'),
    uploadPresign: readRole('AWS_STORAGE_ROLE_ARN_UPLOAD_PRESIGN'),
  };
}

export function getFileStorageBackendMode(): FileStorageBackendMode {
  const configured = readOptionalServerEnv('FILE_STORAGE_BACKEND');
  if (!configured) {
    return 'convex';
  }

  if (configured === 'convex' || configured === 's3-primary' || configured === 's3-mirror') {
    return configured;
  }

  throw new Error('FILE_STORAGE_BACKEND must be one of: convex, s3-primary, s3-mirror.');
}

export function getStorageRuntimeConfig(): StorageRuntimeConfig {
  const backendMode = getFileStorageBackendMode();
  const baseConfig: StorageRuntimeConfig = {
    awsRegion: readOptionalServerEnv('AWS_REGION'),
    backendMode,
    convexSiteUrl: readOptionalServerEnv('CONVEX_SITE_URL'),
    fileServeSigningSecret: readOptionalServerEnv('AWS_FILE_SERVE_SIGNING_SECRET'),
    fileUploadMaxBytes: parsePositiveInteger(
      readOptionalServerEnv('FILE_UPLOAD_MAX_BYTES'),
      'FILE_UPLOAD_MAX_BYTES',
      10 * 1024 * 1024,
    ),
    guardDutyWebhookSharedSecret: readOptionalStorageEnv(
      'AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET',
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET',
    ),
    malwareScanSlaMs: parsePositiveInteger(
      readOptionalServerEnv('AWS_MALWARE_SCAN_SLA_MS'),
      'AWS_MALWARE_SCAN_SLA_MS',
      5 * 60 * 1000,
    ),
    mirrorRetryBaseDelayMs: parsePositiveInteger(
      readOptionalServerEnv('AWS_MIRROR_RETRY_BASE_DELAY_MS'),
      'AWS_MIRROR_RETRY_BASE_DELAY_MS',
      15 * 1000,
    ),
    mirrorRetryMaxDelayMs: parsePositiveInteger(
      readOptionalServerEnv('AWS_MIRROR_RETRY_MAX_DELAY_MS'),
      'AWS_MIRROR_RETRY_MAX_DELAY_MS',
      15 * 60 * 1000,
    ),
    s3DeleteMaxAttempts: parsePositiveInteger(
      readOptionalServerEnv('AWS_S3_DELETE_MAX_ATTEMPTS'),
      'AWS_S3_DELETE_MAX_ATTEMPTS',
      3,
    ),
    s3OrphanCleanupMaxScan: parsePositiveInteger(
      readOptionalServerEnv('AWS_S3_ORPHAN_CLEANUP_MAX_SCAN'),
      'AWS_S3_ORPHAN_CLEANUP_MAX_SCAN',
      100,
    ),
    s3OrphanCleanupMinAgeMs: parsePositiveInteger(
      readOptionalServerEnv('AWS_S3_ORPHAN_CLEANUP_MIN_AGE_MS'),
      'AWS_S3_ORPHAN_CLEANUP_MIN_AGE_MS',
      24 * 60 * 60 * 1000,
    ),
    storageStaleUploadTtlMs: parsePositiveInteger(
      readOptionalServerEnv('STORAGE_STALE_UPLOAD_TTL_MS'),
      'STORAGE_STALE_UPLOAD_TTL_MS',
      60 * 60 * 1000,
    ),
    storageBuckets: {
      clean: readStorageBucketConfig('clean', backendMode),
      mirror: readStorageBucketConfig('mirror', backendMode),
      quarantine: readStorageBucketConfig('quarantine', backendMode),
      rejected: readStorageBucketConfig('rejected', backendMode),
    },
    storageInspectionWebhookSharedSecret: readOptionalStorageEnv(
      'AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET',
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET',
    ),
    storageRoleArns: readStorageRoleConfig(backendMode),
  };

  if (backendMode === 'convex') {
    return baseConfig;
  }

  return {
    ...baseConfig,
    awsRegion: readRequiredStorageEnv('AWS_REGION', backendMode),
    convexSiteUrl: readRequiredStorageEnv('CONVEX_SITE_URL', backendMode),
    fileServeSigningSecret: readRequiredStorageEnv('AWS_FILE_SERVE_SIGNING_SECRET', backendMode),
    guardDutyWebhookSharedSecret: readRequiredStorageEnvWithFallback(
      'AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET',
      backendMode,
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET',
    ),
    storageInspectionWebhookSharedSecret: readRequiredStorageEnvWithFallback(
      'AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET',
      backendMode,
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET',
    ),
  };
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
