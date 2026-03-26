#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadRepoEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const loadEnvFile = process.loadEnvFile?.bind(process);
  if (loadEnvFile) {
    try {
      loadEnvFile(filePath);
      return;
    } catch {
      // Fall back to manual parsing below.
    }
  }

  const envContent = readFileSync(filePath, 'utf8');
  for (const line of envContent.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const firstEquals = trimmed.indexOf('=');
    if (firstEquals <= 0) {
      continue;
    }

    const key = trimmed.slice(0, firstEquals).trim();
    const rawValue = trimmed.slice(firstEquals + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for storage deployment.`);
  }
  return value;
}

const stageIndex = process.argv.indexOf('--stage');
const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : undefined;
if (stage !== 'dev' && stage !== 'prod') {
  throw new Error('Pass --stage dev or --stage prod.');
}

for (const fileName of stage === 'dev' ? ['.env', '.env.local'] : ['.env', '.env.prod']) {
  loadRepoEnvFile(path.join(process.cwd(), fileName));
}

const isPreview = process.argv.includes('--preview');
const projectSlug = 'tanstack-start-template';
const quarantineBucket = requireEnv('AWS_S3_QUARANTINE_BUCKET');
const cleanBucket = requireEnv('AWS_S3_CLEAN_BUCKET');
const rejectedBucket = requireEnv('AWS_S3_REJECTED_BUCKET');
const mirrorBucket = requireEnv('AWS_S3_MIRROR_BUCKET');
const storageBrokerControlAssertionSecret = requireEnv(
  'AWS_STORAGE_BROKER_CONTROL_ASSERTION_SECRET',
);
const storageBrokerEdgeAssertionSecret = requireEnv('AWS_STORAGE_BROKER_EDGE_ASSERTION_SECRET');
const fileServeSigningSecret = requireEnv('AWS_FILE_SERVE_SIGNING_SECRET');
const convexDecisionCallbackSharedSecret = requireEnv(
  'AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET',
);
const convexDocumentResultCallbackSharedSecret = requireEnv(
  'AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET',
);
const convexInspectionCallbackSharedSecret = requireEnv(
  'AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET',
);
const storageAlertEmail = process.env.AWS_STORAGE_ALERT_EMAIL?.trim() || '';
const convexSiteUrl = requireEnv('CONVEX_SITE_URL');
const awsRegion = requireEnv('AWS_REGION');

const storageStackName = `${projectSlug}-${stage}-guardduty-stack`;
const appPath = 'node ./bin/app.mjs';
const infraRoot = path.join(process.cwd(), 'infra', 'aws-cdk');
const documentResultCallbackSecretEnvName = 'AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET';

const cdkArgs = isPreview
  ? ['exec', 'cdk', 'synth', '--app', appPath, storageStackName]
  : ['exec', 'cdk', 'deploy', '--require-approval', 'never', '--app', appPath, storageStackName];

const storageDeployEnv: NodeJS.ProcessEnv = {
  ...process.env,
  AWS_REGION: awsRegion,
  AWS_STORAGE_PROJECT_SLUG: projectSlug,
  CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || awsRegion,
  AWS_STORAGE_BROKER_CONTROL_ASSERTION_SECRET: storageBrokerControlAssertionSecret,
  AWS_STORAGE_BROKER_EDGE_ASSERTION_SECRET: storageBrokerEdgeAssertionSecret,
  AWS_CONVEX_STORAGE_CALLBACK_BASE_URL: trimTrailingSlashes(convexSiteUrl),
  AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET: convexDecisionCallbackSharedSecret,
  AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET: convexInspectionCallbackSharedSecret,
  AWS_FILE_SERVE_SIGNING_SECRET: fileServeSigningSecret,
  ...(storageAlertEmail ? { AWS_STORAGE_ALERT_EMAIL: storageAlertEmail } : {}),
  AWS_S3_QUARANTINE_BUCKET_NAME: quarantineBucket,
  AWS_S3_CLEAN_BUCKET_NAME: cleanBucket,
  AWS_S3_REJECTED_BUCKET_NAME: rejectedBucket,
  AWS_S3_MIRROR_BUCKET_NAME: mirrorBucket,
  STORAGE_STAGE: stage,
};
storageDeployEnv[documentResultCallbackSecretEnvName] = convexDocumentResultCallbackSharedSecret;

const result = spawnSync('pnpm', cdkArgs, {
  cwd: infraRoot,
  env: storageDeployEnv,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
