#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const infraRoot = path.join(process.cwd(), 'infra', 'aws-cdk');
const appPath = 'node ./bin/app.mjs';
const isPreview = process.argv.includes('--preview');
const cdkArgs = isPreview
  ? ['exec', 'cdk', 'synth', '--app', appPath]
  : ['exec', 'cdk', 'deploy', '--all', '--require-approval', 'never', '--app', appPath];

const result = spawnSync('pnpm', cdkArgs, {
  cwd: infraRoot,
  env: process.env,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
