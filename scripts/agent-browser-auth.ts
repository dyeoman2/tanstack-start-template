#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { ensureE2EPrincipalProvisioned } from './lib/e2e-provision';
import { findReachableLocalBaseUrls } from './lib/local-base-url';
import { loadProjectEnvFiles } from './lib/load-project-env-files';

type Principal = 'user' | 'admin';

type Options = {
  baseUrl?: string;
  principal: Principal;
  redirectTo: string;
  sessionName: string;
};

function loadLocalEnv() {
  loadProjectEnvFiles();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function assertTestAuthDeploymentEnv() {
  const deploymentEnv = process.env.APP_DEPLOYMENT_ENV;
  if (deploymentEnv === 'development' || deploymentEnv === 'test') {
    return;
  }

  throw new Error('APP_DEPLOYMENT_ENV must be set to development or test for local test auth');
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
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
    redirect: 'manual',
  });

  const isOpaqueRedirect = response.type === 'opaqueredirect' || response.status === 0;
  if (!isOpaqueRedirect && response.status !== 302) {
    throw new Error(\`Agent auth failed: \${response.status} \${await response.text()}\`);
  }

  return response.headers.get('location') || ${JSON.stringify(redirectTo)};
})()
`;
}

function printUsage() {
  console.log(
    'Usage: pnpm run agent:auth -- --session-name <name> [--principal user|admin] [--redirect-to /app] [--base-url http://127.0.0.1:3000]',
  );
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run agent:auth -- --session-name local-app');
  console.log(
    '- pnpm run agent:auth -- --session-name admin-check --principal admin --redirect-to /app/admin',
  );
  console.log('');
  console.log(
    'What this does: authenticate a named agent-browser session through /api/test/agent-auth.',
  );
  console.log('Safe to rerun: yes; it refreshes the named browser session.');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  loadLocalEnv();
  console.log('🌐 Agent browser auth');
  console.log(
    'What this does: opens a local app session and authenticates it for automated browser work.',
  );
  console.log(
    'Prereqs: local app reachable, APP_DEPLOYMENT_ENV=development|test, ENABLE_E2E_TEST_AUTH=true, E2E_TEST_SECRET set, agent-browser installed.',
  );
  console.log('Safe to rerun: yes; the named session can be reauthenticated.\n');

  assertTestAuthDeploymentEnv();
  if (process.env.ENABLE_E2E_TEST_AUTH !== 'true') {
    throw new Error('ENABLE_E2E_TEST_AUTH must be set to true');
  }

  const options = parseArgs(process.argv.slice(2));
  const secret = requireEnv('E2E_TEST_SECRET');
  const candidateBaseUrls = await findReachableLocalBaseUrls(options.baseUrl);
  let lastError: unknown = null;

  for (const baseUrl of candidateBaseUrls) {
    const destination = new URL(options.redirectTo, baseUrl).toString();

    try {
      await ensureE2EPrincipalProvisioned({
        baseUrl,
        principal: options.principal,
      });

      runAgentBrowser(options.sessionName, ['open', baseUrl]);
      runAgentBrowser(
        options.sessionName,
        ['eval', '--stdin'],
        buildAuthScript(secret, options.principal, options.redirectTo),
      );
      runAgentBrowser(options.sessionName, ['open', destination]);

      console.log(`Authenticated agent-browser session "${options.sessionName}" at ${destination}`);
      return;
    } catch (error) {
      lastError = error;
      if (!options.baseUrl) {
        console.warn(
          `[agent-browser-auth] Failed auth bootstrap on ${baseUrl}, trying next candidate`,
        );
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to authenticate agent-browser session against local app');
}

main().catch((error) => {
  console.error('[agent-browser-auth] Failed to authenticate agent-browser session');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
