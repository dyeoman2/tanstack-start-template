#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type DestroyStep = {
  args: string[];
  command: string;
  label: string;
};

type CommandResult = {
  ok: boolean;
  stderr: string;
  stdout: string;
};

export function buildAwsDestroyAllSteps(yes: boolean): DestroyStep[] {
  return [
    {
      args: ['run', 'dr:destroy', '--', '--stack', 'all', ...(yes ? ['--yes'] : [])],
      command: `pnpm run dr:destroy -- --stack all${yes ? ' --yes' : ''}`,
      label: 'DR teardown',
    },
    {
      args: ['run', 'storage:destroy:prod', ...(yes ? ['--', '--yes'] : [])],
      command: `pnpm run storage:destroy:prod${yes ? ' -- --yes' : ''}`,
      label: 'prod storage teardown',
    },
    {
      args: ['run', 'storage:destroy:dev', ...(yes ? ['--', '--yes'] : [])],
      command: `pnpm run storage:destroy:dev${yes ? ' -- --yes' : ''}`,
      label: 'dev storage teardown',
    },
    {
      args: ['run', 'audit-archive:destroy', ...(yes ? ['--', '--yes'] : [])],
      command: `pnpm run audit-archive:destroy${yes ? ' -- --yes' : ''}`,
      label: 'audit archive teardown',
    },
  ];
}

export function runDestroyStep(args: string[]): CommandResult {
  const result = spawnSync('pnpm', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });

  return {
    ok: result.status === 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function printUsage() {
  console.log('Usage: pnpm run aws:destroy:all [-- --yes]');
  console.log('');
  console.log(
    'What this does: destroy all repo-managed AWS resources in the safe order: DR, prod storage, dev storage, then audit archive.',
  );
  console.log('Safe to rerun: no; this is destructive.');
}

function main() {
  const yes = process.argv.includes('--yes');
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  console.log('Repo-managed AWS teardown\n');
  console.log('What this does: runs the repo destroy scripts in the safe order.\n');

  for (const step of buildAwsDestroyAllSteps(yes)) {
    console.log(`Running ${step.label}: ${step.command}`);
    const result = runDestroyStep(step.args);
    if (!result.ok) {
      throw new Error(`Failed during ${step.label}.`);
    }
    console.log('');
  }

  console.log('Repo-managed AWS teardown complete.');
  console.log(
    'Shared/account-level AWS resources such as CDKToolkit and AWS service-linked roles are intentionally out of scope.',
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error('\n❌ Repo-managed AWS teardown failed');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
