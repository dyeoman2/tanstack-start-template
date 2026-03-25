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
