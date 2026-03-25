import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cdk = require('aws-cdk-lib');
const { MalwareScanStack } = require(path.join('..', 'lib', 'malware-scan-stack.cts'));
const { DrBackupStack } = require(path.join('..', 'lib', 'dr-backup-stack.cts'));
const { DrEcsStack } = require(path.join('..', 'lib', 'dr-ecs-stack.cts'));
const { AuditArchiveStack } = require(path.join('..', 'lib', 'audit-archive-stack.cts'));
const DEFAULT_PROJECT_SLUG = 'tanstack-start-template';

function buildStorageStackName(projectSlug, stage) {
  return `${projectSlug}-${stage}-guardduty-stack`;
}

function buildDrBackupStackName(projectSlug) {
  return `${projectSlug}-dr-backup-stack`;
}

function buildDrEcsStackName(projectSlug) {
  return `${projectSlug}-dr-ecs-stack`;
}

function buildAuditArchiveStackName(projectSlug) {
  return `${projectSlug}-audit-archive-stack`;
}

function readTrimmedEnv(name) {
  const value = process.env[name];
  return value ? value.trim() : '';
}

function createStageConfig(projectSlug, stage) {
  return {
    cleanBucketName: readTrimmedEnv('AWS_S3_CLEAN_BUCKET_NAME'),
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-1',
    },
    guardDutyWebhookSharedSecret: readTrimmedEnv('AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET'),
    inspectionWebhookUrl: readTrimmedEnv('AWS_CONVEX_STORAGE_INSPECTION_WEBHOOK_URL'),
    inspectionWebhookSharedSecret: readTrimmedEnv('AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET'),
    mirrorBucketName: readTrimmedEnv('AWS_S3_MIRROR_BUCKET_NAME'),
    projectSlug,
    quarantineBucketName: readTrimmedEnv('AWS_S3_QUARANTINE_BUCKET_NAME'),
    rejectedBucketName: readTrimmedEnv('AWS_S3_REJECTED_BUCKET_NAME'),
    stage,
    trustedPrincipalArn: readTrimmedEnv('AWS_STORAGE_TRUSTED_PRINCIPAL_ARN'),
    webhookUrl: readTrimmedEnv('AWS_CONVEX_GUARDDUTY_WEBHOOK_URL'),
  };
}

function createAwsEnv() {
  return {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-1',
  };
}

const app = new cdk.App();
const awsEnv = createAwsEnv();
const storageProjectSlug = readTrimmedEnv('AWS_STORAGE_PROJECT_SLUG') || DEFAULT_PROJECT_SLUG;
const drProjectSlug = readTrimmedEnv('AWS_DR_PROJECT_SLUG') || DEFAULT_PROJECT_SLUG;
const auditArchiveProjectSlug =
  readTrimmedEnv('AWS_AUDIT_ARCHIVE_PROJECT_SLUG') || DEFAULT_PROJECT_SLUG;
const drEcsStackName = readTrimmedEnv('AWS_DR_STACK_NAME') || buildDrEcsStackName(drProjectSlug);
const drHostnameStrategy = readTrimmedEnv('AWS_DR_HOSTNAME_STRATEGY') || 'custom-domain';
const storageStage = readTrimmedEnv('STORAGE_STAGE');
if (storageStage === 'dev' || storageStage === 'prod') {
  const config = createStageConfig(storageProjectSlug, storageStage);
  if (
    !config.quarantineBucketName ||
    !config.cleanBucketName ||
    !config.rejectedBucketName ||
    !config.mirrorBucketName ||
    !config.inspectionWebhookUrl ||
    !config.webhookUrl ||
    !config.guardDutyWebhookSharedSecret ||
    !config.inspectionWebhookSharedSecret ||
    !config.trustedPrincipalArn
  ) {
    throw new Error(
      'AWS_S3_QUARANTINE_BUCKET_NAME, AWS_S3_CLEAN_BUCKET_NAME, AWS_S3_REJECTED_BUCKET_NAME, AWS_S3_MIRROR_BUCKET_NAME, AWS_CONVEX_GUARDDUTY_WEBHOOK_URL, AWS_CONVEX_STORAGE_INSPECTION_WEBHOOK_URL, AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET, AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET, and AWS_STORAGE_TRUSTED_PRINCIPAL_ARN are required when STORAGE_STAGE is set.',
    );
  }

  new MalwareScanStack(app, buildStorageStackName(storageProjectSlug, storageStage), config);
}

new DrBackupStack(app, buildDrBackupStackName(drProjectSlug), {
  bucketName: readTrimmedEnv('AWS_DR_BACKUP_S3_BUCKET') || undefined,
  ciUserName: readTrimmedEnv('AWS_DR_BACKUP_CI_USER_NAME') || undefined,
  description: 'TanStack Start Template DR backup bucket for Convex exports',
  env: awsEnv,
  projectSlug: drProjectSlug,
});

const auditArchiveTrustedPrincipalArn = readTrimmedEnv('AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN');
if (auditArchiveTrustedPrincipalArn) {
  new AuditArchiveStack(app, buildAuditArchiveStackName(auditArchiveProjectSlug), {
    bucketName: readTrimmedEnv('AWS_AUDIT_ARCHIVE_BUCKET_NAME') || undefined,
    description: 'TanStack Start immutable audit archive bucket',
    env: awsEnv,
    projectSlug: auditArchiveProjectSlug,
    retentionDays:
      Number.parseInt(readTrimmedEnv('AWS_AUDIT_ARCHIVE_RETENTION_DAYS'), 10) || undefined,
    trustedPrincipalArn: auditArchiveTrustedPrincipalArn,
  });
}

const drDomain = readTrimmedEnv('AWS_DR_DOMAIN');
if (drDomain || drHostnameStrategy === 'provider-hostnames') {
  new DrEcsStack(app, drEcsStackName, {
    auroraMaxAcu: Number.parseFloat(readTrimmedEnv('AWS_DR_AURORA_MAX_ACU')) || undefined,
    auroraMinAcu: Number.parseFloat(readTrimmedEnv('AWS_DR_AURORA_MIN_ACU')) || undefined,
    backendSubdomain: readTrimmedEnv('AWS_DR_BACKEND_SUBDOMAIN') || 'dr-backend',
    convexImage: readTrimmedEnv('AWS_DR_CONVEX_IMAGE') || undefined,
    cpu: Number.parseInt(readTrimmedEnv('AWS_DR_ECS_CPU'), 10) || undefined,
    description: 'TanStack Start Template DR stack for self-hosted Convex on ECS',
    domain: drDomain || undefined,
    env: awsEnv,
    frontendSubdomain: readTrimmedEnv('AWS_DR_FRONTEND_SUBDOMAIN') || 'dr',
    hostnameStrategy: drHostnameStrategy,
    instanceSecretHex: readTrimmedEnv('AWS_DR_INSTANCE_SECRET') || undefined,
    memoryMiB: Number.parseInt(readTrimmedEnv('AWS_DR_ECS_MEMORY_MIB'), 10) || undefined,
    projectSlug: drProjectSlug,
    siteSubdomain: readTrimmedEnv('AWS_DR_SITE_SUBDOMAIN') || 'dr-site',
  });
}
