import { describe, expect, it } from 'vitest';
import { checkAuditArchiveRuntimeEnv } from './deploy-doctor-checks';

describe('deploy doctor audit archive checks', () => {
  it('fails when s3-backed storage is missing immutable archive env', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    const ok = checkAuditArchiveRuntimeEnv(
      'Convex production',
      {
        FILE_STORAGE_BACKEND: 's3-primary',
      },
      checks,
    );

    expect(ok).toBe(false);
    expect(checks).toEqual([
      {
        check: 'Audit archive runtime env (Convex production)',
        detail:
          'FILE_STORAGE_BACKEND=s3-primary; missing AWS_REGION, AWS_AUDIT_ARCHIVE_BUCKET, AWS_AUDIT_ARCHIVE_KMS_KEY_ARN, AWS_AUDIT_ARCHIVE_ROLE_ARN',
        status: 'fail',
      },
    ]);
  });

  it('fails when s3-mirror storage is missing immutable archive env', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    const ok = checkAuditArchiveRuntimeEnv(
      'Convex dev',
      {
        FILE_STORAGE_BACKEND: 's3-mirror',
      },
      checks,
    );

    expect(ok).toBe(false);
    expect(checks).toEqual([
      {
        check: 'Audit archive runtime env (Convex dev)',
        detail:
          'FILE_STORAGE_BACKEND=s3-mirror; missing AWS_REGION, AWS_AUDIT_ARCHIVE_BUCKET, AWS_AUDIT_ARCHIVE_KMS_KEY_ARN, AWS_AUDIT_ARCHIVE_ROLE_ARN',
        status: 'fail',
      },
    ]);
  });

  it('passes when s3-backed storage has complete immutable archive env', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    const ok = checkAuditArchiveRuntimeEnv(
      'Convex production',
      {
        FILE_STORAGE_BACKEND: 's3-primary',
        AWS_REGION: 'us-west-1',
        AWS_AUDIT_ARCHIVE_BUCKET: 'audit-bucket',
        AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: 'arn:aws:kms:us-west-1:123:key/audit',
        AWS_AUDIT_ARCHIVE_ROLE_ARN: 'arn:aws:iam::123:role/audit',
      },
      checks,
    );

    expect(ok).toBe(true);
    expect(checks).toEqual([
      {
        check: 'Audit archive runtime env (Convex production)',
        detail: 'FILE_STORAGE_BACKEND=s3-primary',
        status: 'pass',
      },
    ]);
  });

  it('keeps audit archive optional for convex-backed storage', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    const ok = checkAuditArchiveRuntimeEnv(
      'Convex dev',
      {
        FILE_STORAGE_BACKEND: 'convex',
      },
      checks,
    );

    expect(ok).toBe(true);
    expect(checks).toEqual([
      {
        check: 'Audit archive runtime env (Convex dev)',
        detail: 'Audit archive disabled',
        status: 'pass',
      },
    ]);
  });
});
