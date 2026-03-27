/**
 * Environment variable utilities for server-side code.
 * Provides automatic inference of common environment variables.
 */

import { validateOpenRouterRuntimeConfigForStartup } from './openrouter';

const TEST_BETTER_AUTH_SECRET = 'test-better-auth-secret-abcdefghijklmnopqrstuvwxyz';
const TEST_AUTH_PROXY_SHARED_SECRET = 'test-auth-proxy-shared-secret-abcdefghijklmnopqrstuvwxyz';
const TEST_BETTER_AUTH_URL = 'http://127.0.0.1:3000';

type BetterAuthRuntimeConfig = {
  allowedHosts: string[];
  configuredOrigins: string[];
  isLoopback: boolean;
  protocol: 'http' | 'https';
  siteUrl: string;
};

type BetterAuthVersionedSecret = {
  value: string;
  version: number;
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

function validateBetterAuthSecretValue(secret: string, label: string): string {
  if (secret.length < 32) {
    throw new Error(
      `${label} must use secret values at least 32 characters long. Generate one with: openssl rand -base64 32`,
    );
  }

  return secret;
}

function parseBetterAuthSecretsEnv(raw: string): BetterAuthVersionedSecret[] {
  const seenVersions = new Set<number>();
  const secrets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
        throw new Error(
          'BETTER_AUTH_SECRETS must use version:value entries, for example "2:new-secret,1:old-secret".',
        );
      }

      const rawVersion = entry.slice(0, separatorIndex).trim();
      const rawValue = entry.slice(separatorIndex + 1).trim();
      const version = Number.parseInt(rawVersion, 10);

      if (!Number.isInteger(version) || version < 1) {
        throw new Error(
          'BETTER_AUTH_SECRETS versions must be positive integers, for example "2:new-secret,1:old-secret".',
        );
      }

      if (seenVersions.has(version)) {
        throw new Error(`BETTER_AUTH_SECRETS must not repeat version ${version}.`);
      }
      seenVersions.add(version);

      return {
        value: validateBetterAuthSecretValue(rawValue, `BETTER_AUTH_SECRETS version ${version}`),
        version,
      } satisfies BetterAuthVersionedSecret;
    });

  if (secrets.length === 0) {
    throw new Error(
      'BETTER_AUTH_SECRETS must contain at least one version:value entry when it is set.',
    );
  }

  return secrets;
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

function parseAbsoluteServiceUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }

  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))
  ) {
    throw new Error(`${label} must use https unless it points to a loopback host.`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(`${label} must not include a query string or hash.`);
  }

  return parsed.toString();
}

/**
 * Get the Better Auth secret, with validation.
 */
export function getBetterAuthSecret(): string {
  const versionedSecrets = getBetterAuthSecrets();
  if (versionedSecrets && versionedSecrets.length > 0) {
    return versionedSecrets[0].value;
  }

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

  return validateBetterAuthSecretValue(secret, 'BETTER_AUTH_SECRET');
}

export function getBetterAuthSecretForTooling(): string {
  const versionedSecrets = getBetterAuthSecrets();
  if (versionedSecrets && versionedSecrets.length > 0) {
    return versionedSecrets[0].value;
  }

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    return TEST_BETTER_AUTH_SECRET;
  }

  return validateBetterAuthSecretValue(secret, 'BETTER_AUTH_SECRET');
}

export function getBetterAuthSecrets(): BetterAuthVersionedSecret[] | undefined {
  const rawSecrets = process.env.BETTER_AUTH_SECRETS?.trim();
  if (!rawSecrets) {
    return undefined;
  }

  return parseBetterAuthSecretsEnv(rawSecrets);
}

export function getAuthProxySharedSecret(): string {
  const secret = readOptionalServerEnv('AUTH_PROXY_SHARED_SECRET');
  if (!secret) {
    const deployment = getAppDeploymentEnv();
    if (isDevOrTestDeployment(deployment) || (deployment === null && isTestRuntime())) {
      return TEST_AUTH_PROXY_SHARED_SECRET;
    }

    throw new Error(
      'AUTH_PROXY_SHARED_SECRET environment variable is required for trusted auth proxy signing.',
    );
  }

  if (secret.length < 32) {
    throw new Error(
      'AUTH_PROXY_SHARED_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32',
    );
  }

  return secret;
}

export type AppDeploymentEnv = 'development' | 'test' | 'preview' | 'staging' | 'production';
export type E2EPrincipalType = 'user' | 'admin';
export type FileStorageBackendMode = 'convex' | 's3-primary' | 's3-mirror';
export type StorageBucketKind = 'clean' | 'mirror' | 'quarantine' | 'rejected';
export type StorageCapability =
  | 'cleanPut'
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

export type StorageServiceRuntimeConfig = {
  broker: {
    baseUrl: string | null;
    controlAssertionSecret: string | null;
    edgeAssertionSecret: string | null;
  };
  callbacks: {
    decision: {
      currentSecret: string | null;
      previousSecret: string | null;
    };
    document: {
      currentSecret: string | null;
      previousSecret: string | null;
    };
    inspection: {
      currentSecret: string | null;
      previousSecret: string | null;
    };
  };
};

export type AuditArchiveRuntimeConfig = {
  awsRegion: string | null;
  bucket: string | null;
  kmsKeyArn: string | null;
  prefix: string;
  roleArn: string | null;
};

export type StorageRuntimeConfig = {
  awsRegion: string | null;
  backendMode: FileStorageBackendMode;
  convexSiteUrl: string | null;
  documentParseJsonResultMaxBytes: number;
  documentParseTextResultMaxBytes: number;
  fileServeSigningSecret: string | null;
  fileUploadMaxBytes: number;
  malwareScanSlaMs: number;
  mirrorRetryBaseDelayMs: number;
  mirrorRetryMaxDelayMs: number;
  parserResultStagingPrefix: string;
  s3DeleteMaxAttempts: number;
  s3OrphanCleanupMaxScan: number;
  s3OrphanCleanupMinAgeMs: number;
  services: StorageServiceRuntimeConfig;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
  storageStaleUploadTtlMs: number;
};

export type E2EPrincipalConfig = {
  email: string;
  name: string;
  password: string;
  role: E2EPrincipalType;
};

const APP_DEPLOYMENT_ENVS = ['development', 'test', 'preview', 'staging', 'production'] as const;
const DEFAULT_E2E_PRINCIPAL_EMAILS = ['e2e-user@local.test', 'e2e-admin@local.test'] as const;

function getRequiredServerEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function parseAppDeploymentEnv(value: string): AppDeploymentEnv {
  if ((APP_DEPLOYMENT_ENVS as readonly string[]).includes(value)) {
    return value as AppDeploymentEnv;
  }

  throw new Error(`APP_DEPLOYMENT_ENV must be one of: ${APP_DEPLOYMENT_ENVS.join(', ')}.`);
}

// Fail-loud: E2E test auth must never be enabled in production deployments.
// The runtime double-gate in convex/e2e.ts provides defense-in-depth, but this
// assertion catches the misconfiguration at module load time.
(function assertNoE2EInProduction() {
  if (
    process.env.ENABLE_E2E_TEST_AUTH === 'true' &&
    process.env.APP_DEPLOYMENT_ENV === 'production'
  ) {
    throw new Error(
      'FATAL: ENABLE_E2E_TEST_AUTH must not be set in production deployments. ' +
        'Remove it from your production environment configuration.',
    );
  }
})();

// Fail early on unsafe outbound AI privacy configuration so the process never
// reaches protected routes with a non-strict OpenRouter privacy mode.
validateOpenRouterRuntimeConfigForStartup();

export function getAppDeploymentEnv(): AppDeploymentEnv | null {
  const value = readOptionalServerEnv('APP_DEPLOYMENT_ENV');
  if (!value) {
    return null;
  }

  return parseAppDeploymentEnv(value);
}

function isDevOrTestDeployment(env: AppDeploymentEnv | null): boolean {
  return env === 'development' || env === 'test';
}

export function isDevelopmentOrTestDeployment(): boolean {
  return isDevOrTestDeployment(getAppDeploymentEnv());
}

export function isE2ETestAuthEnabled(): boolean {
  return process.env.ENABLE_E2E_TEST_AUTH === 'true';
}

export function isSafeE2EAuthRuntime(_request?: Request): boolean {
  return isDevelopmentOrTestDeployment();
}

export function getE2ETestSecret(): string {
  return getRequiredServerEnv('E2E_TEST_SECRET');
}

export function isSecurityWorkspaceResetEnabled(): boolean {
  return process.env.ENABLE_SECURITY_WORKSPACE_RESET === 'true';
}

export function getSecurityWorkspaceResetSecret(): string {
  return getRequiredServerEnv('SECURITY_WORKSPACE_RESET_SECRET');
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

function readOptionalStorageEnv(name: string): string | null {
  return readOptionalServerEnv(name);
}

function readRequiredStorageEnv(name: string, mode: FileStorageBackendMode): string {
  const value = readOptionalStorageEnv(name);
  if (!value) {
    throw new Error(`${name} environment variable is required for FILE_STORAGE_BACKEND=${mode}.`);
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
      bucket: readOptionalStorageEnv(bucketEnv) ?? readOptionalServerEnv('AWS_S3_FILES_BUCKET'),
      kmsKeyArn:
        readOptionalStorageEnv(kmsEnv) ?? readOptionalServerEnv('AWS_S3_FILES_KMS_KEY_ARN'),
    };
  }

  return {
    bucket: readRequiredStorageEnv(bucketEnv, mode),
    kmsKeyArn: readRequiredStorageEnv(kmsEnv, mode),
  };
}

function readStorageServiceRuntimeConfig(): StorageServiceRuntimeConfig {
  return {
    broker: {
      baseUrl: readOptionalServerEnv('STORAGE_BROKER_URL'),
      controlAssertionSecret: readOptionalServerEnv('STORAGE_BROKER_CONTROL_ASSERTION_SECRET'),
      edgeAssertionSecret: readOptionalServerEnv('STORAGE_BROKER_EDGE_ASSERTION_SECRET'),
    },
    callbacks: {
      decision: {
        currentSecret: readOptionalServerEnv('CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET'),
        previousSecret: readOptionalServerEnv(
          'CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET_PREVIOUS',
        ),
      },
      document: {
        currentSecret: readOptionalServerEnv('CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET'),
        previousSecret: readOptionalServerEnv(
          'CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET_PREVIOUS',
        ),
      },
      inspection: {
        currentSecret: readOptionalServerEnv('CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET'),
        previousSecret: readOptionalServerEnv(
          'CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET_PREVIOUS',
        ),
      },
    },
  };
}

function assertNoLegacyStorageWebhookSecret() {
  if (readOptionalServerEnv('AWS_MALWARE_WEBHOOK_SHARED_SECRET')) {
    throw new Error(
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET is no longer supported. Configure AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET and AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET on the storage worker runtime instead.',
    );
  }
}

function requireStorageServiceConfig(
  services: StorageServiceRuntimeConfig,
  mode: FileStorageBackendMode,
): StorageServiceRuntimeConfig {
  if (!services.broker.baseUrl) {
    throw new Error(
      `STORAGE_BROKER_URL environment variable is required for FILE_STORAGE_BACKEND=${mode}.`,
    );
  }
  if (!services.broker.edgeAssertionSecret) {
    throw new Error(
      `STORAGE_BROKER_EDGE_ASSERTION_SECRET environment variable is required for FILE_STORAGE_BACKEND=${mode}.`,
    );
  }
  if (!services.broker.controlAssertionSecret) {
    throw new Error(
      `STORAGE_BROKER_CONTROL_ASSERTION_SECRET environment variable is required for FILE_STORAGE_BACKEND=${mode}.`,
    );
  }
  if (!services.callbacks.decision.currentSecret) {
    throw new Error(
      `CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET environment variable is required for FILE_STORAGE_BACKEND=${mode}.`,
    );
  }
  if (!services.callbacks.document.currentSecret) {
    throw new Error(
      `CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET environment variable is required for FILE_STORAGE_BACKEND=${mode}.`,
    );
  }
  if (!services.callbacks.inspection.currentSecret) {
    throw new Error(
      `CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET environment variable is required for FILE_STORAGE_BACKEND=${mode}.`,
    );
  }
  return services;
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

export function isS3BackedFileStorageBackendMode(mode: FileStorageBackendMode) {
  return mode === 's3-primary' || mode === 's3-mirror';
}

export function getStorageRuntimeConfig(): StorageRuntimeConfig {
  const backendMode = getFileStorageBackendMode();
  assertNoLegacyStorageWebhookSecret();
  const baseConfig: StorageRuntimeConfig = {
    awsRegion: readOptionalServerEnv('AWS_REGION'),
    backendMode,
    convexSiteUrl: readOptionalServerEnv('CONVEX_SITE_URL'),
    documentParseJsonResultMaxBytes: parsePositiveInteger(
      readOptionalServerEnv('AWS_DOCUMENT_PARSE_JSON_RESULT_MAX_BYTES'),
      'AWS_DOCUMENT_PARSE_JSON_RESULT_MAX_BYTES',
      25 * 1024 * 1024,
    ),
    documentParseTextResultMaxBytes: parsePositiveInteger(
      readOptionalServerEnv('AWS_DOCUMENT_PARSE_TEXT_RESULT_MAX_BYTES'),
      'AWS_DOCUMENT_PARSE_TEXT_RESULT_MAX_BYTES',
      10 * 1024 * 1024,
    ),
    fileServeSigningSecret: readOptionalServerEnv('AWS_FILE_SERVE_SIGNING_SECRET'),
    fileUploadMaxBytes: parsePositiveInteger(
      readOptionalServerEnv('FILE_UPLOAD_MAX_BYTES'),
      'FILE_UPLOAD_MAX_BYTES',
      10 * 1024 * 1024,
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
    parserResultStagingPrefix:
      readOptionalServerEnv('AWS_DOCUMENT_RESULT_STAGING_PREFIX') ?? 'quarantine/parser-results/',
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
    services: readStorageServiceRuntimeConfig(),
  };

  if (backendMode === 'convex') {
    return baseConfig;
  }

  // S3-backed deployments must also provide immutable audit archive wiring.
  getAuditArchiveRuntimeConfig();

  return {
    ...baseConfig,
    awsRegion: readRequiredStorageEnv('AWS_REGION', backendMode),
    convexSiteUrl: readRequiredStorageEnv('CONVEX_SITE_URL', backendMode),
    fileServeSigningSecret: readRequiredStorageEnv('AWS_FILE_SERVE_SIGNING_SECRET', backendMode),
    services: requireStorageServiceConfig(baseConfig.services, backendMode),
  };
}

export function getAuditArchiveRuntimeConfig(): AuditArchiveRuntimeConfig {
  const backendMode = getFileStorageBackendMode();
  const prefix = readOptionalServerEnv('AWS_AUDIT_ARCHIVE_PREFIX')?.trim() || 'audit-ledger/';
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const baseConfig: AuditArchiveRuntimeConfig = {
    awsRegion: readOptionalServerEnv('AWS_REGION'),
    bucket: readOptionalServerEnv('AWS_AUDIT_ARCHIVE_BUCKET'),
    kmsKeyArn: readOptionalServerEnv('AWS_AUDIT_ARCHIVE_KMS_KEY_ARN'),
    prefix: normalizedPrefix,
    roleArn: readOptionalServerEnv('AWS_AUDIT_ARCHIVE_ROLE_ARN'),
  };

  const requiredForS3BackedStorage = isS3BackedFileStorageBackendMode(backendMode);
  const configuredValues = [
    baseConfig.awsRegion,
    baseConfig.bucket,
    baseConfig.kmsKeyArn,
    baseConfig.roleArn,
  ].filter((value) => (value ?? '').trim().length > 0);
  if (!requiredForS3BackedStorage && configuredValues.length === 0) {
    return baseConfig;
  }

  if (!baseConfig.awsRegion) {
    throw new Error(
      requiredForS3BackedStorage
        ? `AWS_REGION environment variable is required when FILE_STORAGE_BACKEND=${backendMode}.`
        : 'AWS_REGION environment variable is required for audit archive operations.',
    );
  }
  if (!baseConfig.bucket) {
    throw new Error(
      requiredForS3BackedStorage
        ? `AWS_AUDIT_ARCHIVE_BUCKET environment variable is required when FILE_STORAGE_BACKEND=${backendMode}.`
        : 'AWS_AUDIT_ARCHIVE_BUCKET environment variable is required for audit archive operations.',
    );
  }
  if (!baseConfig.kmsKeyArn) {
    throw new Error(
      requiredForS3BackedStorage
        ? `AWS_AUDIT_ARCHIVE_KMS_KEY_ARN environment variable is required when FILE_STORAGE_BACKEND=${backendMode}.`
        : 'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN environment variable is required for audit archive operations.',
    );
  }
  if (!baseConfig.roleArn) {
    throw new Error(
      requiredForS3BackedStorage
        ? `AWS_AUDIT_ARCHIVE_ROLE_ARN environment variable is required when FILE_STORAGE_BACKEND=${backendMode}.`
        : 'AWS_AUDIT_ARCHIVE_ROLE_ARN environment variable is required for audit archive operations.',
    );
  }

  return baseConfig;
}

export function getDomainDnsResolverUrl(): string | null {
  const configured = readOptionalServerEnv('DOMAIN_DNS_RESOLVER_URL');
  if (!configured) {
    return null;
  }

  return parseAbsoluteServiceUrl(configured, 'DOMAIN_DNS_RESOLVER_URL');
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
  if (!isE2ETestAuthEnabled() || !isDevelopmentOrTestDeployment()) {
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
