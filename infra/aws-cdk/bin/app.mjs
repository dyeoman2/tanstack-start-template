import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cdk = require('aws-cdk-lib');
const { MalwareScanStack } = require(path.join('..', 'lib', 'malware-scan-stack.cts'));
const { DrBackupStack } = require(path.join('..', 'lib', 'dr-backup-stack.cts'));
const { DrEcsStack } = require(path.join('..', 'lib', 'dr-ecs-stack.cts'));

function readEnv(name, stage) {
  return process.env[`${name}_${stage}`] || process.env[name] || '';
}

function readTrimmedEnv(name) {
  const value = process.env[name];
  return value ? value.trim() : '';
}

function readFirstTrimmedEnv(...names) {
  for (const name of names) {
    const value = readTrimmedEnv(name);
    if (value) {
      return value;
    }
  }
  return '';
}

function createStageConfig(stage) {
  const upperStage = stage.toUpperCase();
  return {
    bucketName: readEnv('S3_FILES_BUCKET_NAME', upperStage),
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-1',
    },
    malwareWebhookSharedSecret: readEnv('MALWARE_WEBHOOK_SHARED_SECRET', upperStage),
    stage,
    webhookUrl: readEnv('CONVEX_GUARDDUTY_WEBHOOK_URL', upperStage),
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

for (const stage of ['dev', 'prod']) {
  const config = createStageConfig(stage);
  if (!config.bucketName || !config.webhookUrl || !config.malwareWebhookSharedSecret) {
    continue;
  }

  new MalwareScanStack(app, `TanStackStartMalwareScan-${stage}`, config);
}

new DrBackupStack(app, 'TanStackStartDrBackupStack', {
  bucketName: readFirstTrimmedEnv('AWS_DR_BACKUP_S3_BUCKET', 'DR_BACKUP_S3_BUCKET') || undefined,
  ciUserName:
    readFirstTrimmedEnv('AWS_DR_BACKUP_CI_USER_NAME', 'DR_BACKUP_CI_USER_NAME') || undefined,
  description: 'TanStack Start Template DR backup bucket for Convex exports',
  env: awsEnv,
  projectSlug:
    readFirstTrimmedEnv('AWS_DR_PROJECT_SLUG', 'DR_PROJECT_SLUG') || 'tanstack-start-template',
});

const drDomain = readFirstTrimmedEnv('AWS_DR_DOMAIN', 'DR_DOMAIN');
if (drDomain) {
  new DrEcsStack(app, 'TanStackStartDrEcsStack', {
    auroraMaxAcu:
      Number.parseFloat(readFirstTrimmedEnv('AWS_DR_AURORA_MAX_ACU', 'DR_AURORA_MAX_ACU')) ||
      undefined,
    auroraMinAcu:
      Number.parseFloat(readFirstTrimmedEnv('AWS_DR_AURORA_MIN_ACU', 'DR_AURORA_MIN_ACU')) ||
      undefined,
    backendSubdomain:
      readFirstTrimmedEnv('AWS_DR_BACKEND_SUBDOMAIN', 'DR_BACKEND_SUBDOMAIN') || 'dr-backend',
    convexImage: readFirstTrimmedEnv('AWS_DR_CONVEX_IMAGE', 'DR_CONVEX_IMAGE') || undefined,
    cpu:
      Number.parseInt(readFirstTrimmedEnv('AWS_DR_ECS_CPU', 'DR_ECS_CPU'), 10) || undefined,
    description: 'TanStack Start Template DR stack for self-hosted Convex on ECS',
    domain: drDomain,
    env: awsEnv,
    frontendSubdomain:
      readFirstTrimmedEnv('AWS_DR_FRONTEND_SUBDOMAIN', 'DR_FRONTEND_SUBDOMAIN') || 'dr',
    instanceSecretHex:
      readFirstTrimmedEnv('AWS_DR_INSTANCE_SECRET', 'DR_INSTANCE_SECRET') || undefined,
    memoryMiB:
      Number.parseInt(
        readFirstTrimmedEnv('AWS_DR_ECS_MEMORY_MIB', 'DR_ECS_MEMORY_MIB'),
        10,
      ) || undefined,
    projectSlug:
      readFirstTrimmedEnv('AWS_DR_PROJECT_SLUG', 'DR_PROJECT_SLUG') || 'tanstack-start-template',
    siteSubdomain:
      readFirstTrimmedEnv('AWS_DR_SITE_SUBDOMAIN', 'DR_SITE_SUBDOMAIN') || 'dr-site',
  });
}
