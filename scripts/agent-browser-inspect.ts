#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';

type Principal = 'user' | 'admin';

type Options = {
  baseUrl?: string;
  principal: Principal;
  redirectTo: string;
  sessionName: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    principal: 'user',
    redirectTo: '/app',
    sessionName: 'agent-browser-inspect',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--session-name') {
      options.sessionName = argv[index + 1] || options.sessionName;
      index += 1;
      continue;
    }

    if (arg === '--principal') {
      const principal = argv[index + 1];
      if (principal === 'user' || principal === 'admin') {
        options.principal = principal;
      }
      index += 1;
      continue;
    }

    if (arg === '--redirect-to') {
      options.redirectTo = argv[index + 1] || options.redirectTo;
      index += 1;
      continue;
    }

    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1] || options.baseUrl;
      index += 1;
    }
  }

  return options;
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const authArgs = [
    'run',
    'agent:auth',
    '--',
    '--session-name',
    options.sessionName,
    '--principal',
    options.principal,
    '--redirect-to',
    options.redirectTo,
  ];
  if (options.baseUrl) {
    authArgs.splice(5, 0, '--base-url', options.baseUrl);
  }

  runCommand('pnpm', authArgs);
  runCommand('agent-browser', [
    '--session-name',
    options.sessionName,
    'wait',
    '--load',
    'networkidle',
  ]);
  runCommand('agent-browser', ['--session-name', options.sessionName, 'snapshot', '-i']);
}

main().catch((error) => {
  console.error('[agent-browser-inspect] Failed to authenticate and snapshot browser session');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
