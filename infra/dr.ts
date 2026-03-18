#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const _infraRoot = path.join(process.cwd(), 'infra', 'aws-cdk');
const appPath = 'node ./infra/aws-cdk/bin/app.mjs';
const isPreview = process.argv.includes('--preview');
const deployAll = process.argv.includes('--all');
const stackIndex = process.argv.indexOf('--stack');
const stackName = stackIndex >= 0 ? process.argv[stackIndex + 1] : undefined;

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
