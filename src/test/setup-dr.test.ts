import { describe, expect, it } from 'vitest';
import {
  buildDefaultBackupBucketName,
  buildDrSecretNames,
  buildRequiredNetlifyDrEnvVars,
  extractJsonText,
  extractHostnameFromUrl,
  getRequiredRecoveryEnvKeys,
  getRequiredStorageDrEnvKeys,
  getStorageCoverageWarning,
  isLikelyConvexDeployKey,
  parseConvexEnvList,
  parseGitHubRepoFromRemote,
  parseSetupDrArgs,
} from '../../scripts/lib/setup-dr';

describe('parseSetupDrArgs', () => {
  it('parses supported flags and values', () => {
    expect(
      parseSetupDrArgs([
        '--yes',
        '--domain',
        'example.com',
        '--project-slug',
        'demo',
        '--github-repo',
        'octo/demo',
        '--netlify-site',
        'site-123',
        '--skip-cloudflare',
        '--json',
      ]),
    ).toEqual({
      domain: 'example.com',
      githubRepo: 'octo/demo',
      help: false,
      json: true,
      netlifySite: 'site-123',
      plan: false,
      projectSlug: 'demo',
      skipCloudflare: true,
      skipEcs: false,
      skipGithub: false,
      skipNetlify: false,
      yes: true,
    });
  });

  it('rejects unknown flags', () => {
    expect(() => parseSetupDrArgs(['--wat'])).toThrow('Unknown argument: --wat');
  });

  it('supports help aliases', () => {
    expect(parseSetupDrArgs(['--help']).help).toBe(true);
    expect(parseSetupDrArgs(['-h']).help).toBe(true);
  });

  it('treats non-interactive as yes and parses plan', () => {
    expect(parseSetupDrArgs(['--non-interactive', '--plan'])).toMatchObject({
      yes: true,
      plan: true,
    });
  });
});

describe('parseGitHubRepoFromRemote', () => {
  it('parses https remotes', () => {
    expect(parseGitHubRepoFromRemote('https://github.com/openai/example.git')).toBe(
      'openai/example',
    );
  });

  it('parses ssh remotes', () => {
    expect(parseGitHubRepoFromRemote('git@github.com:openai/example.git')).toBe('openai/example');
  });

  it('returns null for unsupported hosts', () => {
    expect(parseGitHubRepoFromRemote('https://gitlab.com/openai/example.git')).toBeNull();
  });
});

describe('parseConvexEnvList', () => {
  it('parses key value lines', () => {
    expect(parseConvexEnvList('APP_NAME=Demo\nJWKS={"keys":[]}\n')).toEqual({
      APP_NAME: 'Demo',
      JWKS: '{"keys":[]}',
    });
  });
});

describe('extractJsonText', () => {
  it('skips banner text and keeps json output', () => {
    expect(extractJsonText('warning\n{"ok":true}\n')).toBe('{"ok":true}');
  });
});

describe('storage helpers', () => {
  it('warns when convex file storage is active', () => {
    expect(getStorageCoverageWarning({ FILE_STORAGE_BACKEND: 'convex' })).toContain(
      'database restore only',
    );
  });

  it('requires extra env keys for s3-backed storage', () => {
    expect(getRequiredStorageDrEnvKeys({ FILE_STORAGE_BACKEND: 's3-primary' })).toEqual([
      'FILE_STORAGE_BACKEND',
      'AWS_REGION',
      'AWS_S3_QUARANTINE_BUCKET',
      'AWS_S3_CLEAN_BUCKET',
      'AWS_S3_REJECTED_BUCKET',
      'AWS_S3_MIRROR_BUCKET',
      'AWS_S3_QUARANTINE_KMS_KEY_ARN',
      'AWS_S3_CLEAN_KMS_KEY_ARN',
      'AWS_S3_REJECTED_KMS_KEY_ARN',
      'AWS_S3_MIRROR_KMS_KEY_ARN',
      'AWS_FILE_SERVE_SIGNING_SECRET',
      'AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET',
      'AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET',
      'AWS_STORAGE_ROLE_ARN_UPLOAD_PRESIGN',
      'AWS_STORAGE_ROLE_ARN_DOWNLOAD_PRESIGN',
      'AWS_STORAGE_ROLE_ARN_PROMOTION',
      'AWS_STORAGE_ROLE_ARN_REJECTION',
      'AWS_STORAGE_ROLE_ARN_CLEANUP',
      'AWS_STORAGE_ROLE_ARN_MIRROR',
    ]);
  });

  it('requires auth-critical env keys for recovery readiness', () => {
    expect(getRequiredRecoveryEnvKeys({ FILE_STORAGE_BACKEND: 'convex' })).toEqual([
      'BETTER_AUTH_SECRET',
      'JWKS',
      'OPENROUTER_API_KEY',
    ]);
  });
});

describe('extractHostnameFromUrl', () => {
  it('returns the hostname from a full URL', () => {
    expect(extractHostnameFromUrl('https://dr-app.netlify.app')).toBe('dr-app.netlify.app');
  });

  it('returns null for invalid values', () => {
    expect(extractHostnameFromUrl('not-a-url')).toBeNull();
  });
});

describe('buildRequiredNetlifyDrEnvVars', () => {
  it('builds the required DR frontend env vars', () => {
    expect(
      buildRequiredNetlifyDrEnvVars(
        {
          APP_NAME: 'Demo',
          BETTER_AUTH_SECRET: 'secret',
          FILE_STORAGE_BACKEND: 's3-primary',
          AWS_REGION: 'us-west-1',
          AWS_S3_QUARANTINE_BUCKET: 'bucket-quarantine',
          AWS_S3_CLEAN_BUCKET: 'bucket-clean',
          AWS_S3_REJECTED_BUCKET: 'bucket-rejected',
          AWS_S3_MIRROR_BUCKET: 'bucket-mirror',
          AWS_S3_QUARANTINE_KMS_KEY_ARN:
            'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-quarantine',
          AWS_S3_CLEAN_KMS_KEY_ARN:
            'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-clean',
          AWS_S3_REJECTED_KMS_KEY_ARN:
            'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-rejected',
          AWS_S3_MIRROR_KMS_KEY_ARN:
            'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-mirror',
          AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET: 'guardduty',
          AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET: 'inspection',
          AWS_FILE_SERVE_SIGNING_SECRET: 'serve',
          AWS_STORAGE_ROLE_ARN_UPLOAD_PRESIGN: 'arn:aws:iam::123:role/upload',
          AWS_STORAGE_ROLE_ARN_DOWNLOAD_PRESIGN: 'arn:aws:iam::123:role/download',
          AWS_STORAGE_ROLE_ARN_PROMOTION: 'arn:aws:iam::123:role/promotion',
          AWS_STORAGE_ROLE_ARN_REJECTION: 'arn:aws:iam::123:role/rejection',
          AWS_STORAGE_ROLE_ARN_CLEANUP: 'arn:aws:iam::123:role/cleanup',
          AWS_STORAGE_ROLE_ARN_MIRROR: 'arn:aws:iam::123:role/mirror',
        },
        {
          backendOrigin: 'https://dr-backend.example.com',
          frontendOrigin: 'https://dr.example.com',
          siteOrigin: 'https://dr-site.example.com',
        },
      ),
    ).toMatchObject({
      APP_NAME: 'Demo',
      BETTER_AUTH_SECRET: 'secret',
      BETTER_AUTH_URL: 'https://dr.example.com',
      CONVEX_SITE_URL: 'https://dr-site.example.com',
      VITE_CONVEX_URL: 'https://dr-backend.example.com',
      FILE_STORAGE_BACKEND: 's3-primary',
      AWS_REGION: 'us-west-1',
      AWS_S3_QUARANTINE_BUCKET: 'bucket-quarantine',
      AWS_S3_CLEAN_BUCKET: 'bucket-clean',
      AWS_S3_REJECTED_BUCKET: 'bucket-rejected',
      AWS_S3_MIRROR_BUCKET: 'bucket-mirror',
      AWS_S3_QUARANTINE_KMS_KEY_ARN:
        'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-quarantine',
      AWS_S3_CLEAN_KMS_KEY_ARN:
        'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-clean',
      AWS_S3_REJECTED_KMS_KEY_ARN:
        'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-rejected',
      AWS_S3_MIRROR_KMS_KEY_ARN:
        'arn:aws:kms:us-west-1:123456789012:alias/tanstack-start-template-prod-mirror',
      AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET: 'guardduty',
      AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET: 'inspection',
      AWS_FILE_SERVE_SIGNING_SECRET: 'serve',
      AWS_STORAGE_ROLE_ARN_UPLOAD_PRESIGN: 'arn:aws:iam::123:role/upload',
      AWS_STORAGE_ROLE_ARN_DOWNLOAD_PRESIGN: 'arn:aws:iam::123:role/download',
      AWS_STORAGE_ROLE_ARN_PROMOTION: 'arn:aws:iam::123:role/promotion',
      AWS_STORAGE_ROLE_ARN_REJECTION: 'arn:aws:iam::123:role/rejection',
      AWS_STORAGE_ROLE_ARN_CLEANUP: 'arn:aws:iam::123:role/cleanup',
      AWS_STORAGE_ROLE_ARN_MIRROR: 'arn:aws:iam::123:role/mirror',
    });
  });
});

describe('buildDrSecretNames', () => {
  it('builds the expected secret names', () => {
    expect(buildDrSecretNames('demo')).toEqual({
      convexAdminKey: 'demo-dr-convex-admin-key-secret',
      cloudflareDnsToken: 'demo-dr-cloudflare-dns-token-secret',
      cloudflareZoneId: 'demo-dr-cloudflare-zone-id-secret',
      convexEnv: 'demo-dr-convex-env-secret',
      netlifyBuildHook: 'demo-dr-netlify-build-hook-secret',
      netlifyFrontendCnameTarget: 'demo-dr-netlify-frontend-cname-target-secret',
    });
  });
});

describe('buildDefaultBackupBucketName', () => {
  it('includes account and region when available', () => {
    expect(buildDefaultBackupBucketName('demo', '123456789012', 'us-west-1')).toBe(
      'demo-dr-backup-bucket-123456789012-us-west-1',
    );
  });
});

describe('isLikelyConvexDeployKey', () => {
  it('accepts prod deploy keys', () => {
    expect(isLikelyConvexDeployKey('prod:abc123')).toBe(true);
  });

  it('rejects empty or malformed values', () => {
    expect(isLikelyConvexDeployKey('')).toBe(false);
    expect(isLikelyConvexDeployKey('dev:abc123')).toBe(false);
  });
});
