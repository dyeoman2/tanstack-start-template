import {
  CONVEX_STORAGE_RUNTIME_ENV_NAMES,
  findForbiddenStorageEnvNames,
} from './storage-env-contract';

export const REQUIRED_AUDIT_ARCHIVE_RUNTIME_ENV_NAMES = [
  'AWS_REGION',
  'AWS_AUDIT_ARCHIVE_BUCKET',
  'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN',
  'AWS_AUDIT_ARCHIVE_ROLE_ARN',
] as const;

export type DeployDoctorCheck = {
  check: string;
  detail?: string;
  status: 'pass' | 'warn' | 'fail';
};

export type AuditArchiveReleaseGateSnapshot = {
  archiveStatus: {
    configured: boolean;
    driftDetected: boolean;
    exporterEnabled: boolean;
    failureReason: string | null;
    lagCount: number;
    lastVerifiedAt: number | null;
    lastVerifiedSealEndSequence: number | null;
    lastVerificationStatus:
      | 'verified'
      | 'missing_object'
      | 'hash_mismatch'
      | 'no_seal'
      | 'disabled';
    latestExportEndSequence: number | null;
    latestSealEndSequence: number | null;
    required: boolean;
  };
};

export function isS3BackedStorageBackend(backend: string) {
  return backend === 's3-primary' || backend === 's3-mirror';
}

export function checkStorageRuntimeEnv(
  label: string,
  envVars: Record<string, string>,
  checks: DeployDoctorCheck[],
) {
  const forbidden = findForbiddenStorageEnvNames(envVars);
  if (forbidden.length > 0) {
    console.log(`❌ Forbidden legacy storage env (${label}): ${forbidden.join(', ')}`);
    checks.push({
      check: `Forbidden legacy storage env (${label})`,
      status: 'fail',
      detail: forbidden.join(', '),
    });
    return false;
  }

  const backend = (envVars.FILE_STORAGE_BACKEND ?? 'convex').trim() || 'convex';
  if (!isS3BackedStorageBackend(backend)) {
    console.log(`✅ S3 runtime env (${label}) not required for FILE_STORAGE_BACKEND=${backend}`);
    checks.push({
      check: `S3 runtime env (${label})`,
      status: 'pass',
      detail: `FILE_STORAGE_BACKEND=${backend}`,
    });
    return true;
  }

  const missing = CONVEX_STORAGE_RUNTIME_ENV_NAMES.filter((name) => !(envVars[name] ?? '').trim());
  if (missing.length > 0) {
    console.log(`❌ Missing S3 runtime env (${label}): ${missing.join(', ')}`);
    checks.push({
      check: `S3 runtime env (${label})`,
      status: 'fail',
      detail: `FILE_STORAGE_BACKEND=${backend}; missing ${missing.join(', ')}`,
    });
    return false;
  }

  console.log(`✅ S3 runtime env complete (${label})`);
  checks.push({
    check: `S3 runtime env (${label})`,
    status: 'pass',
    detail: `FILE_STORAGE_BACKEND=${backend}`,
  });
  return true;
}

export function checkAuditArchiveRuntimeEnv(
  label: string,
  envVars: Record<string, string>,
  checks: DeployDoctorCheck[],
) {
  const backend = (envVars.FILE_STORAGE_BACKEND ?? 'convex').trim() || 'convex';
  const archiveRequired = isS3BackedStorageBackend(backend);
  const configured = REQUIRED_AUDIT_ARCHIVE_RUNTIME_ENV_NAMES.some((name) =>
    (envVars[name] ?? '').trim(),
  );
  if (!archiveRequired && !configured) {
    console.log(`✅ Audit archive runtime env (${label}) not configured`);
    checks.push({
      check: `Audit archive runtime env (${label})`,
      status: 'pass',
      detail: 'Audit archive disabled',
    });
    return true;
  }

  const missing = REQUIRED_AUDIT_ARCHIVE_RUNTIME_ENV_NAMES.filter(
    (name) => !(envVars[name] ?? '').trim(),
  );
  if (missing.length > 0) {
    console.log(`❌ Missing audit archive runtime env (${label}): ${missing.join(', ')}`);
    checks.push({
      check: `Audit archive runtime env (${label})`,
      status: 'fail',
      detail: archiveRequired
        ? `FILE_STORAGE_BACKEND=${backend}; missing ${missing.join(', ')}`
        : `Missing ${missing.join(', ')}`,
    });
    return false;
  }

  console.log(`✅ Audit archive runtime env complete (${label})`);
  checks.push({
    check: `Audit archive runtime env (${label})`,
    status: 'pass',
    detail: archiveRequired ? `FILE_STORAGE_BACKEND=${backend}` : undefined,
  });
  return true;
}

export function checkAuditArchiveReleaseGate(
  label: string,
  snapshot: AuditArchiveReleaseGateSnapshot | null,
  checks: DeployDoctorCheck[],
) {
  if (!snapshot) {
    checks.push({
      check: `Audit archive release gate (${label})`,
      detail: 'Audit archive runtime status could not be loaded from Convex.',
      status: 'fail',
    });
    console.log(`❌ Audit archive release gate (${label}) could not load runtime status`);
    return false;
  }

  const status = snapshot.archiveStatus;
  if (!status.required) {
    checks.push({
      check: `Audit archive release gate (${label})`,
      detail: 'Audit archive not required for current storage backend',
      status: 'pass',
    });
    console.log(`✅ Audit archive release gate (${label}) not required`);
    return true;
  }

  const failures: string[] = [];
  if (!status.configured) {
    failures.push(status.failureReason ?? 'archive config missing');
  }
  if (!status.exporterEnabled) {
    failures.push('exporter disabled');
  }
  if (status.latestSealEndSequence !== null && status.latestExportEndSequence === null) {
    failures.push('latest seal has not been exported');
  }
  if (status.lagCount > 0) {
    failures.push(`lag ${status.lagCount}`);
  }
  if (status.driftDetected) {
    failures.push('seal/export drift detected');
  }
  if (
    status.latestSealEndSequence !== null &&
    (status.lastVerificationStatus !== 'verified' ||
      status.lastVerifiedSealEndSequence !== status.latestSealEndSequence ||
      status.lastVerifiedAt === null)
  ) {
    failures.push(`verification ${status.lastVerificationStatus}`);
  }

  if (failures.length > 0) {
    checks.push({
      check: `Audit archive release gate (${label})`,
      detail: failures.join('; '),
      status: 'fail',
    });
    console.log(`❌ Audit archive release gate (${label}): ${failures.join('; ')}`);
    return false;
  }

  checks.push({
    check: `Audit archive release gate (${label})`,
    detail: `verified through seal ${status.latestSealEndSequence ?? 'none'}`,
    status: 'pass',
  });
  console.log(
    `✅ Audit archive release gate (${label}) verified through seal ${status.latestSealEndSequence ?? 'none'}`,
  );
  return true;
}
