#!/usr/bin/env tsx

import { loadProjectEnvFiles } from './lib/load-project-env-files';
import { resolveLocalBaseUrl } from './lib/local-base-url';
import { ensureE2EPrincipalProvisioned } from './lib/e2e-provision';

type Principal = 'user' | 'admin' | 'all';

type Options = {
  baseUrl?: string;
  json: boolean;
  principal: Principal;
  prod: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    json: false,
    principal: 'all',
    prod: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1] || options.baseUrl;
      index += 1;
      continue;
    }

    if (arg === '--principal') {
      const principal = argv[index + 1];
      if (principal === 'user' || principal === 'admin' || principal === 'all') {
        options.principal = principal;
      }
      index += 1;
      continue;
    }

    if (arg === '--prod') {
      options.prod = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function loadLocalEnv() {
  loadProjectEnvFiles();
}

function printUsage() {
  console.log(
    'Usage: pnpm run e2e:provision -- [--base-url http://127.0.0.1:3000] [--principal user|admin|all] [--prod] [--json]',
  );
  console.log('');
  console.log('What this does: provisions deterministic E2E principals outside the app runtime.');
  console.log(
    'Safe to rerun: yes; existing principals are reconciled to the expected email verification and role state.',
  );
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = await resolveLocalBaseUrl(options.baseUrl);
  const principals: Array<'user' | 'admin'> =
    options.principal === 'all' ? ['user', 'admin'] : [options.principal];

  if (!options.json) {
    console.log('🧪 E2E principal provisioning');
    console.log(
      'What this does: provisions deterministic E2E principals through Better Auth plus Convex CLI reconciliation.',
    );
    console.log(
      'Prereqs: local app reachable, pnpm exec convex available, and access to the target Convex deployment.',
    );
    console.log('Safe to rerun: yes.\n');
  }

  const results = [];
  for (const principal of principals) {
    results.push(
      await ensureE2EPrincipalProvisioned({
        baseUrl,
        principal,
        prod: options.prod,
        quiet: options.json,
      }),
    );
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          baseUrl,
          principals: results,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log('Provisioned principals:');
  for (const result of results) {
    const status = [result.created ? 'created' : 'reused', result.reset ? 'reset' : null]
      .filter(Boolean)
      .join(', ');
    console.log(`- ${result.principal}: ${result.email} (${status})`);
  }
}

main().catch((error) => {
  console.error('[e2e-provision] Failed to provision E2E principals');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
