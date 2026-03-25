import path from 'node:path';
import { loadOptionalEnvFile } from './load-env-file';

export function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for audit archive deployment.`);
  }
  return value;
}

export function buildAuditArchiveStackName(projectSlug: string) {
  return `${projectSlug}-audit-archive-stack`;
}

export function loadAuditArchiveDeployEnv(cwd = process.cwd()) {
  loadOptionalEnvFile(path.join(cwd, '.env'));
  loadOptionalEnvFile(path.join(cwd, '.env.prod'));

  const awsRegion = requireEnv('AWS_REGION');
  const projectSlug =
    process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG?.trim() || 'tanstack-start-template';
  const trustedPrincipalArn = requireEnv('AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN');

  return {
    appPath: 'node ./bin/app.mjs',
    awsRegion,
    env: {
      ...process.env,
      AWS_REGION: awsRegion,
      CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || awsRegion,
      AWS_AUDIT_ARCHIVE_PROJECT_SLUG: projectSlug,
      AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: trustedPrincipalArn,
      ...(process.env.AWS_AUDIT_ARCHIVE_BUCKET_NAME?.trim()
        ? { AWS_AUDIT_ARCHIVE_BUCKET_NAME: process.env.AWS_AUDIT_ARCHIVE_BUCKET_NAME.trim() }
        : {}),
      ...(process.env.AWS_AUDIT_ARCHIVE_RETENTION_DAYS?.trim()
        ? { AWS_AUDIT_ARCHIVE_RETENTION_DAYS: process.env.AWS_AUDIT_ARCHIVE_RETENTION_DAYS.trim() }
        : {}),
    },
    infraRoot: path.join(cwd, 'infra', 'aws-cdk'),
    stackName: buildAuditArchiveStackName(projectSlug),
  };
}
