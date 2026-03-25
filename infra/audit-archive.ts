#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { loadAuditArchiveDeployEnv } from '../scripts/lib/audit-archive-deploy';

const isPreview = process.argv.includes('--preview');
const deployConfig = loadAuditArchiveDeployEnv();
const cdkArgs = isPreview
  ? ['exec', 'cdk', 'synth', '--app', deployConfig.appPath, deployConfig.stackName]
  : [
      'exec',
      'cdk',
      'deploy',
      '--require-approval',
      'never',
      '--app',
      deployConfig.appPath,
      deployConfig.stackName,
    ];

const result = spawnSync('pnpm', cdkArgs, {
  cwd: deployConfig.infraRoot,
  env: deployConfig.env,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
