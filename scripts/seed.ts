#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has('--dry-run');
const reseedSecurityWorkspace =
  argv.has('--reseed-security-workspace') || argv.has('--reset-security-workspace');

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  console.log('🌱 Starting seed workflow...\n');

  if (dryRun) {
    console.log(
      'ℹ️  Dry run: skipping control-register regeneration because it writes committed generated artifacts.\n',
    );
  } else {
    console.log('🧾 Regenerating active control register seed data...');
    runCommand('pnpm', ['run', 'compliance:generate:active-control-register']);
    console.log('');
  }

  console.log('☁️  Running Convex seed orchestrator...');
  runCommand('pnpm', [
    'exec',
    'convex',
    'run',
    'seed/index:seed',
    JSON.stringify({
      dryRun,
      reseedSecurityWorkspace,
    }),
  ]);
}

main().catch((error) => {
  console.error('\n❌ Seed workflow failed');
  console.error(error);
  process.exit(1);
});
