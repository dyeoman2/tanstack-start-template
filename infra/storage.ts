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

for (const fileName of ['.env', '.env.local']) {
  loadRepoEnvFile(path.join(process.cwd(), fileName));
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

const isPreview = process.argv.includes('--preview');
const projectSlug = process.env.AWS_DR_PROJECT_SLUG?.trim() || 'tanstack-start-template';
const bucket = requireEnv('AWS_S3_FILES_BUCKET');
const malwareWebhookSharedSecret = requireEnv('AWS_MALWARE_WEBHOOK_SHARED_SECRET');
const convexSiteUrl = requireEnv('CONVEX_SITE_URL');
const awsRegion = requireEnv('AWS_REGION');

const storageStackName = `${projectSlug}-${stage}-guardduty-stack`;
const appPath = 'node ./bin/app.mjs';
const infraRoot = path.join(process.cwd(), 'infra', 'aws-cdk');

const cdkArgs = isPreview
  ? ['exec', 'cdk', 'synth', '--app', appPath, storageStackName]
  : ['exec', 'cdk', 'deploy', '--require-approval', 'never', '--app', appPath, storageStackName];

const result = spawnSync('pnpm', cdkArgs, {
  cwd: infraRoot,
  env: {
    ...process.env,
    AWS_REGION: awsRegion,
    CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || awsRegion,
    AWS_CONVEX_GUARDDUTY_WEBHOOK_URL: `${trimTrailingSlashes(convexSiteUrl)}/aws/guardduty-malware`,
    AWS_MALWARE_WEBHOOK_SHARED_SECRET: malwareWebhookSharedSecret,
    AWS_S3_FILES_BUCKET_NAME: bucket,
    STORAGE_STAGE: stage,
  },
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
