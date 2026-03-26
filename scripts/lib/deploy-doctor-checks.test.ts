import { describe, expect, it } from 'vitest';
import { checkAuditArchiveReleaseGate, checkAuditArchiveRuntimeEnv } from './deploy-doctor-checks';

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

  it('fails the release gate when the latest seal is not verified', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    const ok = checkAuditArchiveReleaseGate(
      'Convex production',
      {
        archiveStatus: {
          configured: true,
          driftDetected: false,
          exporterEnabled: true,
          failureReason: null,
          lagCount: 0,
          lastVerifiedAt: null,
          lastVerifiedSealEndSequence: null,
          lastVerificationStatus: 'missing_object',
          latestExportEndSequence: 12,
          latestSealEndSequence: 12,
          required: true,
        },
      },
      checks,
    );

    expect(ok).toBe(false);
    expect(checks[0]).toEqual({
      check: 'Audit archive release gate (Convex production)',
      detail: 'verification missing_object',
      status: 'fail',
    });
  });

  it('passes the release gate when the latest seal is verified', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    const ok = checkAuditArchiveReleaseGate(
      'Convex production',
      {
        archiveStatus: {
          configured: true,
          driftDetected: false,
          exporterEnabled: true,
          failureReason: null,
          lagCount: 0,
          lastVerifiedAt: 1700000000000,
          lastVerifiedSealEndSequence: 12,
          lastVerificationStatus: 'verified',
          latestExportEndSequence: 12,
          latestSealEndSequence: 12,
          required: true,
        },
      },
      checks,
    );

    expect(ok).toBe(true);
    expect(checks[0]).toEqual({
      check: 'Audit archive release gate (Convex production)',
      detail: 'verified through seal 12',
      status: 'pass',
    });
  });
});
