#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';

function parseSessionName(argv: string[]): string {
  let sessionName = 'agent-browser-auth';

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--session-name') {
      sessionName = argv[index + 1] || sessionName;
      index += 1;
    }
  }

  return sessionName;
}

async function main() {
  const sessionName = parseSessionName(process.argv.slice(2));
  const result = spawnSync('agent-browser', ['--session-name', sessionName, 'close'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to close session "${sessionName}"`);
  }

  console.log(`Closed agent-browser session "${sessionName}"`);
}

main().catch((error) => {
  console.error('[agent-browser-close] Failed to close agent-browser session');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
