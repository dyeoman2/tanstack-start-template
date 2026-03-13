#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type Principal = 'user' | 'admin';

type Options = {
  baseUrl: string;
  principal: Principal;
  redirectTo: string;
  sessionName: string;
};

function loadLocalEnv() {
  const loadEnvFile = process.loadEnvFile?.bind(process);
  if (!loadEnvFile) {
    return;
  }

  for (const fileName of ['.env', '.env.local']) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) {
      loadEnvFile(filePath);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl: 'http://127.0.0.1:3000',
    principal: 'user',
    redirectTo: '/app',
    sessionName: 'agent-browser-auth',
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

function runAgentBrowser(sessionName: string, args: string[], input?: string) {
  const result = spawnSync('agent-browser', ['--session-name', sessionName, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`agent-browser ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function buildAuthScript(secret: string, principal: Principal, redirectTo: string) {
  return `
(async () => {
  const response = await fetch('/api/test/agent-auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-e2e-test-secret': ${JSON.stringify(secret)},
    },
    body: JSON.stringify({
      principal: ${JSON.stringify(principal)},
      redirectTo: ${JSON.stringify(redirectTo)},
    }),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(\`Agent auth failed: \${response.status} \${await response.text()}\`);
  }

  return response.url;
})()
`;
}

async function main() {
  loadLocalEnv();

  if (process.env.ENABLE_E2E_TEST_AUTH !== 'true') {
    throw new Error('ENABLE_E2E_TEST_AUTH must be set to true');
  }

  const options = parseArgs(process.argv.slice(2));
  const secret = requireEnv('E2E_TEST_SECRET');
  const destination = new URL(options.redirectTo, options.baseUrl).toString();

  runAgentBrowser(options.sessionName, ['open', options.baseUrl]);
  runAgentBrowser(
    options.sessionName,
    ['eval', '--stdin'],
    buildAuthScript(secret, options.principal, options.redirectTo),
  );
  runAgentBrowser(options.sessionName, ['open', destination]);

  console.log(`Authenticated agent-browser session "${options.sessionName}" at ${destination}`);
}

main().catch((error) => {
  console.error('[agent-browser-auth] Failed to authenticate agent-browser session');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
