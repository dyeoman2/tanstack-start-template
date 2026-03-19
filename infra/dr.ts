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

const _infraRoot = path.join(process.cwd(), 'infra', 'aws-cdk');
const appPath = 'node ./infra/aws-cdk/bin/app.mjs';
const isPreview = process.argv.includes('--preview');
const deployAll = process.argv.includes('--all');
const stackIndex = process.argv.indexOf('--stack');
const requestedStackName = stackIndex >= 0 ? process.argv[stackIndex + 1] : undefined;
const projectSlug = process.env.AWS_DR_PROJECT_SLUG?.trim() || 'tanstack-start-template';
const defaultBackupStackName = `${projectSlug}-dr-backup-stack`;
const defaultEcsStackName = process.env.AWS_DR_STACK_NAME?.trim() || `${projectSlug}-dr-ecs-stack`;

let stackName = requestedStackName;
if (requestedStackName === 'TanStackStartDrBackupStack') {
  stackName = defaultBackupStackName;
} else if (
  requestedStackName === 'TanStackStartDrEcsStack' ||
  requestedStackName === 'tanstack-start-template-dr-ecs-stack'
) {
  stackName = defaultEcsStackName;
}

if (!deployAll && !stackName) {
  throw new Error('Pass --all or --stack <StackName>.');
}

const cdkArgs = isPreview
  ? ['exec', 'cdk', 'synth', '--app', appPath]
  : ['exec', 'cdk', 'deploy', '--require-approval', 'never', '--app', appPath];

if (deployAll) {
  cdkArgs.push('--all');
} else if (stackName) {
  cdkArgs.push(stackName);
}

const result = spawnSync('pnpm', cdkArgs, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
