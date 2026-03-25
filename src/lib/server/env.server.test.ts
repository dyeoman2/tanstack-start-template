import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAppDeploymentEnv,
  getAuditArchiveRuntimeConfig,
  getBetterAuthAllowedHosts,
  getBetterAuthSecret,
  getBetterAuthTrustedOrigins,
  getBetterAuthUrlForTooling,
  getStorageRuntimeConfig,
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
      APP_DEPLOYMENT_ENV: 'development',
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

  it('uses BETTER_AUTH_URL as the canonical Better Auth origin', () => {
    process.env.BETTER_AUTH_URL = 'https://auth.example.com';

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
      'http://localhost:3000',
      'http://localhost:4173',
    ]);
  });

  it('requires BETTER_AUTH_URL for production Better Auth helpers', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VITEST;
    delete process.env.BETTER_AUTH_URL;

    expect(() => getRequiredBetterAuthUrl()).toThrow(
      'BETTER_AUTH_URL environment variable is required for Better Auth configuration.',
    );
    expect(() => getBetterAuthAllowedHosts()).toThrow(
      'BETTER_AUTH_URL environment variable is required for Better Auth configuration.',
    );
    expect(getBetterAuthTrustedOrigins()).toEqual([
      'http://127.0.0.1:3000',
      'http://localhost:3000',
    ]);
  });

  it('uses the deterministic loopback fallback for Better Auth tooling when unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VITEST;
    delete process.env.BETTER_AUTH_URL;

    expect(getBetterAuthUrlForTooling()).toBe('http://127.0.0.1:3000');
  });

  it('requires BETTER_AUTH_URL to be https outside loopback runtimes', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VITEST;
    process.env.BETTER_AUTH_URL = 'http://app.example.com';

    expect(() => getRequiredBetterAuthUrl()).toThrow(
      'BETTER_AUTH_URL must use https unless it points to a loopback host.',
    );
  });

  it('rejects malformed Better Auth host and origin allowlists', () => {
    process.env.BETTER_AUTH_URL = 'https://app.example.com';
    process.env.BETTER_AUTH_PREVIEW_HOSTS = 'preview.example.com/path';

    expect(() => getBetterAuthAllowedHosts()).toThrow(
      'BETTER_AUTH_PREVIEW_HOSTS contains an invalid host pattern: preview.example.com/path',
    );

    process.env.BETTER_AUTH_PREVIEW_HOSTS = 'preview.example.com';
    process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'admin.example.com';

    expect(() => getBetterAuthTrustedOrigins()).toThrow(
      'BETTER_AUTH_TRUSTED_ORIGINS contains an invalid absolute origin: admin.example.com',
    );
  });

  it('requires a strong BETTER_AUTH_SECRET', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VITEST;
    process.env.BETTER_AUTH_SECRET = 'short-secret';

    expect(() => getBetterAuthSecret()).toThrow(
      'BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32',
    );
  });

  it('uses deterministic Better Auth test fallbacks when env is unset in tests', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;

    expect(getBetterAuthSecret()).toContain('test-better-auth-secret');
    expect(getRequiredBetterAuthUrl()).toBe('http://127.0.0.1:3000');
  });

  it('uses secure cookies only for https site urls', () => {
    expect(shouldUseSecureAuthCookies('https://app.example.com')).toBe(true);
    expect(shouldUseSecureAuthCookies('http://127.0.0.1:3000')).toBe(false);
    expect(shouldUseSecureAuthCookies('not-a-url')).toBe(false);
  });

  it('allows e2e auth only in explicit development or test deployments', () => {
    process.env.APP_DEPLOYMENT_ENV = 'development';
    expect(isSafeE2EAuthRuntime(new Request('https://app.example.com/api/test/e2e-auth'))).toBe(
      true,
    );

    process.env.APP_DEPLOYMENT_ENV = 'test';
    expect(isSafeE2EAuthRuntime()).toBe(true);

    process.env.APP_DEPLOYMENT_ENV = 'preview';
    expect(isSafeE2EAuthRuntime()).toBe(false);

    delete process.env.APP_DEPLOYMENT_ENV;
    expect(isSafeE2EAuthRuntime()).toBe(false);
  });

  it('parses APP_DEPLOYMENT_ENV and rejects invalid values', () => {
    process.env.APP_DEPLOYMENT_ENV = 'staging';
    expect(getAppDeploymentEnv()).toBe('staging');

    process.env.APP_DEPLOYMENT_ENV = 'invalid';
    expect(() => getAppDeploymentEnv()).toThrow(
      'APP_DEPLOYMENT_ENV must be one of: development, test, preview, staging, production.',
    );
  });

  it('reads storage runtime settings from the AWS-prefixed env names', () => {
    process.env.AWS_S3_FILES_BUCKET = 'legacy-bucket';
    process.env.AWS_S3_FILES_KMS_KEY_ARN =
      'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-dev-files';
    process.env.AWS_FILE_SERVE_SIGNING_SECRET = 'canonical-secret';

    const config = getStorageRuntimeConfig();

    expect(config.storageBuckets.clean.bucket).toBe('legacy-bucket');
    expect(config.storageBuckets.quarantine.bucket).toBe('legacy-bucket');
    expect(config.storageBuckets.clean.kmsKeyArn).toBe(
      'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-dev-files',
    );
    expect(config.fileServeSigningSecret).toBe('canonical-secret');
    expect(config.services.broker.baseUrl).toBeNull();
    expect(config.services.broker.accessKeyId).toBeNull();
  });

  it('rejects the legacy shared storage webhook secret', () => {
    process.env.FILE_STORAGE_BACKEND = 's3-primary';
    process.env.AWS_MALWARE_WEBHOOK_SHARED_SECRET = 'legacy-webhook-secret';

    expect(() => getStorageRuntimeConfig()).toThrow(
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET is no longer supported. Configure AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET and AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET on the storage worker runtime instead.',
    );
  });

  it('requires broker credentials and callback secrets for s3-backed storage', () => {
    process.env.FILE_STORAGE_BACKEND = 's3-primary';
    process.env.AWS_REGION = 'us-west-1';
    process.env.CONVEX_SITE_URL = 'https://example.convex.site';
    process.env.AWS_FILE_SERVE_SIGNING_SECRET = 'canonical-secret';
    process.env.AWS_S3_FILES_BUCKET = 'legacy-bucket';
    process.env.AWS_S3_CLEAN_BUCKET = 'clean-bucket';
    process.env.AWS_S3_MIRROR_BUCKET = 'mirror-bucket';
    process.env.AWS_S3_QUARANTINE_BUCKET = 'quarantine-bucket';
    process.env.AWS_S3_REJECTED_BUCKET = 'rejected-bucket';
    process.env.AWS_S3_FILES_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/legacy';
    process.env.AWS_S3_CLEAN_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/clean';
    process.env.AWS_S3_MIRROR_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/mirror';
    process.env.AWS_S3_QUARANTINE_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/quarantine';
    process.env.AWS_S3_REJECTED_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/rejected';
    process.env.AWS_AUDIT_ARCHIVE_BUCKET = 'audit-archive-bucket';
    process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/audit';
    process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN = 'arn:aws:iam::123456789012:role/audit-archive';

    expect(() => getStorageRuntimeConfig()).toThrow(
      'STORAGE_BROKER_URL environment variable is required for FILE_STORAGE_BACKEND=s3-primary.',
    );

    process.env.STORAGE_BROKER_URL = 'https://broker.example.com';
    process.env.STORAGE_BROKER_ACCESS_KEY_ID = 'broker-access-key';
    process.env.STORAGE_BROKER_SECRET_ACCESS_KEY = 'broker-secret-key';
    process.env.CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET = 'decision-secret';
    process.env.CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET = 'document-secret';
    process.env.CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET = 'inspection-secret';

    const config = getStorageRuntimeConfig();

    expect(config.storageBuckets.clean.bucket).toBe('clean-bucket');
    expect(config.storageBuckets.quarantine.bucket).toBe('quarantine-bucket');
    expect(config.storageBuckets.rejected.bucket).toBe('rejected-bucket');
    expect(config.storageBuckets.mirror.bucket).toBe('mirror-bucket');
    expect(config.fileServeSigningSecret).toBe('canonical-secret');
    expect(config.services.broker.baseUrl).toBe('https://broker.example.com');
    expect(config.services.broker.accessKeyId).toBe('broker-access-key');
    expect(config.services.broker.secretAccessKey).toBe('broker-secret-key');
    expect(config.services.callbacks.decision.currentSecret).toBe('decision-secret');
    expect(config.services.callbacks.document.currentSecret).toBe('document-secret');
    expect(config.services.callbacks.inspection.currentSecret).toBe('inspection-secret');
  });

  it('requires immutable audit archive wiring for s3-backed storage even when no archive env is set', () => {
    process.env.FILE_STORAGE_BACKEND = 's3-primary';
    process.env.AWS_S3_CLEAN_BUCKET = 'clean-bucket';
    process.env.AWS_S3_MIRROR_BUCKET = 'mirror-bucket';
    process.env.AWS_S3_QUARANTINE_BUCKET = 'quarantine-bucket';
    process.env.AWS_S3_REJECTED_BUCKET = 'rejected-bucket';
    process.env.AWS_S3_CLEAN_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/clean';
    process.env.AWS_S3_MIRROR_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/mirror';
    process.env.AWS_S3_QUARANTINE_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/quarantine';
    process.env.AWS_S3_REJECTED_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/rejected';
    process.env.CONVEX_SITE_URL = 'https://example.convex.site';
    process.env.AWS_FILE_SERVE_SIGNING_SECRET = 'canonical-secret';
    process.env.STORAGE_BROKER_URL = 'https://broker.example.com';
    process.env.STORAGE_BROKER_ACCESS_KEY_ID = 'broker-access-key';
    process.env.STORAGE_BROKER_SECRET_ACCESS_KEY = 'broker-secret-key';
    process.env.CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET = 'decision-secret';
    process.env.CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET = 'document-secret';
    process.env.CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET = 'inspection-secret';

    expect(() => getAuditArchiveRuntimeConfig()).toThrow(
      'AWS_REGION environment variable is required when FILE_STORAGE_BACKEND=s3-primary.',
    );

    process.env.AWS_REGION = 'us-west-1';

    expect(() => getAuditArchiveRuntimeConfig()).toThrow(
      'AWS_AUDIT_ARCHIVE_BUCKET environment variable is required when FILE_STORAGE_BACKEND=s3-primary.',
    );
    expect(() => getStorageRuntimeConfig()).toThrow(
      'AWS_AUDIT_ARCHIVE_BUCKET environment variable is required when FILE_STORAGE_BACKEND=s3-primary.',
    );
  });

  it('keeps immutable audit archive optional for convex-backed storage', () => {
    process.env.FILE_STORAGE_BACKEND = 'convex';

    expect(getAuditArchiveRuntimeConfig()).toEqual({
      awsRegion: null,
      bucket: null,
      kmsKeyArn: null,
      prefix: 'audit-ledger/',
      roleArn: null,
    });
  });

  it('reads audit archive runtime settings when configured', () => {
    process.env.AWS_REGION = 'us-west-1';
    process.env.AWS_AUDIT_ARCHIVE_BUCKET = 'audit-archive-bucket';
    process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/audit';
    process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN = 'arn:aws:iam::123456789012:role/audit-archive';
    process.env.AWS_AUDIT_ARCHIVE_PREFIX = 'archive/root';

    expect(getAuditArchiveRuntimeConfig()).toEqual({
      awsRegion: 'us-west-1',
      bucket: 'audit-archive-bucket',
      kmsKeyArn: 'arn:aws:kms:us-west-1:123456789012:key/audit',
      prefix: 'archive/root/',
      roleArn: 'arn:aws:iam::123456789012:role/audit-archive',
    });
  });

  it('requires a complete audit archive runtime config once any archive env is set', () => {
    process.env.AWS_REGION = 'us-west-1';
    process.env.AWS_AUDIT_ARCHIVE_BUCKET = 'audit-archive-bucket';

    expect(() => getAuditArchiveRuntimeConfig()).toThrow(
      'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN environment variable is required for audit archive operations.',
    );
  });
});
