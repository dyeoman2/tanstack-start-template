#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process';
import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import { convexEnvSet } from './lib/convex-cli';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { loadProjectEnvFiles } from './lib/load-project-env-files';
import { generateSecret } from '../src/lib/server/crypto.server';
import { emitStructuredOutput, routeLogsToStderrWhenJson } from './lib/script-ux';
import { upsertStructuredEnvValue } from './lib/env-file';

const envPath = join(process.cwd(), '.env.local');

const DEFAULT_E2E_VALUES = {
  APP_DEPLOYMENT_ENV: 'development',
  ENABLE_E2E_TEST_AUTH: 'true',
  E2E_USER_EMAIL: 'e2e-user@local.test',
  E2E_USER_PASSWORD: 'E2EUser!1234',
  E2E_USER_NAME: 'E2E User',
  E2E_ADMIN_EMAIL: 'e2e-admin@local.test',
  E2E_ADMIN_PASSWORD: 'E2EAdmin!1234',
  E2E_ADMIN_NAME: 'E2E Admin',
} as const;

function createPrompt() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(question: string, initialValue?: string) {
  const rl = createPrompt();
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    if (initialValue) {
      rl.write(initialValue);
    }
  });
}

async function askWithDefault(question: string, fallback: string) {
  const answer = await ask(`${question}: `, fallback);
  return answer || fallback;
}

async function askYesNo(question: string, fallback = false) {
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} (${suffix}): `)).toLowerCase();
  if (!answer) {
    return fallback;
  }

  return answer === 'y' || answer === 'yes';
}

function resolveLocalDeploymentEnv() {
  const configured = process.env.APP_DEPLOYMENT_ENV?.trim();
  if (!configured) {
    return DEFAULT_E2E_VALUES.APP_DEPLOYMENT_ENV;
  }

  if (configured === 'development' || configured === 'test') {
    return configured;
  }

  throw new Error(
    `APP_DEPLOYMENT_ENV must be development or test for setup:e2e. Received ${configured}.`,
  );
}

function loadLocalEnv() {
  loadProjectEnvFiles();
}

function ensureLocalEnvFile() {
  if (existsSync(envPath)) {
    return;
  }

  console.log('ℹ️  .env.local not found. Running pnpm run setup:env first...');
  execSync('pnpm run setup:env', {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
}

function printUsage() {
  console.log('Usage: pnpm run setup:e2e [-- --json]');
  console.log('');
  console.log('What this does:');
  console.log('- Ensures .env.local exists');
  console.log('- Writes APP_DEPLOYMENT_ENV=development for local authenticated test helpers');
  console.log('- Writes authenticated E2E defaults locally');
  console.log('- Syncs APP_DEPLOYMENT_ENV, ENABLE_E2E_TEST_AUTH, and E2E_TEST_SECRET to Convex');
  console.log('- Optionally provisions the deterministic user/admin principals immediately');
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run setup:e2e');
  console.log('');
  console.log('Docs: docs/SCRIPT_AUTOMATION.md');
  console.log('Safe to rerun: yes');
}

async function main() {
  const json = process.argv.includes('--json');
  routeLogsToStderrWhenJson(json);
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }
  if (process.argv.includes('--prod')) {
    throw new Error(
      'setup:e2e no longer supports --prod. Test auth is limited to explicit development or test deployments.',
    );
  }

  console.log('🔐 Setting up authenticated Playwright E2E env...\n');
  console.log(
    'What this does: writes local E2E auth defaults and syncs the authenticated test gate vars to the current Convex development deployment.',
  );
  console.log(
    'Prereqs: .env.local or setup:env, plus Convex CLI access to the current development deployment.',
  );
  console.log(
    'Modifies: .env.local and Convex env vars APP_DEPLOYMENT_ENV/ENABLE_E2E_TEST_AUTH/E2E_TEST_SECRET.',
  );
  console.log(
    'Does not require CONVEX_DEPLOY_KEY in the app runtime; principal provisioning now runs through CLI tooling.',
  );
  console.log('Safe to rerun: yes; existing values are reused where present.\n');
  requirePnpmAndConvexCli();

  ensureLocalEnvFile();
  loadLocalEnv();

  const localValues = {
    APP_DEPLOYMENT_ENV: resolveLocalDeploymentEnv(),
    ENABLE_E2E_TEST_AUTH:
      process.env.ENABLE_E2E_TEST_AUTH || DEFAULT_E2E_VALUES.ENABLE_E2E_TEST_AUTH,
    E2E_TEST_SECRET: process.env.E2E_TEST_SECRET || (await generateSecret(32)),
    E2E_USER_EMAIL: process.env.E2E_USER_EMAIL || DEFAULT_E2E_VALUES.E2E_USER_EMAIL,
    E2E_USER_PASSWORD: process.env.E2E_USER_PASSWORD || DEFAULT_E2E_VALUES.E2E_USER_PASSWORD,
    E2E_USER_NAME: process.env.E2E_USER_NAME || DEFAULT_E2E_VALUES.E2E_USER_NAME,
    E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL || DEFAULT_E2E_VALUES.E2E_ADMIN_EMAIL,
    E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD || DEFAULT_E2E_VALUES.E2E_ADMIN_PASSWORD,
    E2E_ADMIN_NAME: process.env.E2E_ADMIN_NAME || DEFAULT_E2E_VALUES.E2E_ADMIN_NAME,
  };

  let envContent = readFileSync(envPath, 'utf8');
  for (const [name, value] of Object.entries(localValues)) {
    envContent = upsertStructuredEnvValue(envContent, name, value, {
      sectionMarker: '# PLAYWRIGHT E2E AUTH',
    });
  }
  writeFileSync(envPath, envContent, 'utf8');

  const convexTarget = 'current development';
  const defaultBaseUrl = 'http://127.0.0.1:3000';

  console.log(`✅ Updated local E2E values in ${envPath}`);
  console.log(`🔧 Syncing required E2E gate vars to the ${convexTarget} Convex deployment...`);

  const convexEnvVars = [
    ['APP_DEPLOYMENT_ENV', localValues.APP_DEPLOYMENT_ENV],
    ['ENABLE_E2E_TEST_AUTH', localValues.ENABLE_E2E_TEST_AUTH],
    ['E2E_TEST_SECRET', localValues.E2E_TEST_SECRET],
  ] as const;

  for (const [name, value] of convexEnvVars) {
    console.log(`   Setting ${name}...`);
    convexEnvSet(name, value, false);
  }

  let provisioningAttempted = false;
  let provisioningSucceeded = false;
  let provisioningBaseUrl: string | null = null;
  const shouldProvisionPrincipals = json
    ? false
    : await askYesNo(
        'Provision the deterministic E2E principals now? This requires the local app to be reachable.',
        false,
      );
  if (shouldProvisionPrincipals) {
    provisioningAttempted = true;
    provisioningBaseUrl = await askWithDefault(
      'Base URL for local E2E provisioning',
      defaultBaseUrl,
    );
    try {
      const provisionArgs = ['run', 'e2e:provision', '--', '--base-url', provisioningBaseUrl];
      const result = spawnSync('pnpm', provisionArgs, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      provisioningSucceeded = result.status === 0;
      if (result.status !== 0) {
        throw new Error(`pnpm ${provisionArgs.join(' ')} failed with status ${result.status ?? 1}`);
      }
    } catch {
      console.log('⚠️  E2E principal provisioning did not complete.');
      console.log(
        `   Start the app at ${provisioningBaseUrl} and rerun \`pnpm run e2e:provision -- --base-url ${provisioningBaseUrl}\` when ready.`,
      );
    }
  }

  console.log('\n✅ Authenticated Playwright E2E setup complete!');
  console.log('────────────────────────────────────────────────');
  console.log(`APP_DEPLOYMENT_ENV=${localValues.APP_DEPLOYMENT_ENV}`);
  console.log(`ENABLE_E2E_TEST_AUTH=${localValues.ENABLE_E2E_TEST_AUTH}`);
  console.log(`E2E_TEST_SECRET=${localValues.E2E_TEST_SECRET}`);
  console.log(`E2E_USER_EMAIL=${localValues.E2E_USER_EMAIL}`);
  console.log(`E2E_ADMIN_EMAIL=${localValues.E2E_ADMIN_EMAIL}`);
  console.log('────────────────────────────────────────────────');
  if (provisioningSucceeded) {
    console.log(`Deterministic E2E principals provisioned at ${provisioningBaseUrl}.`);
  } else {
    console.log(
      'Run `pnpm run e2e:provision` to pre-create the deterministic principals if you want to verify setup explicitly.',
    );
    console.log('The browser helper scripts also auto-provision those principals on first use.');
  }
  console.log('Run `pnpm test:e2e` to execute the authenticated Playwright suite.');
  if (json) {
    emitStructuredOutput({
      target: 'development',
      localEnvPath: envPath,
      syncedConvexKeys: convexEnvVars.map(([name]) => name),
      e2eUserEmail: localValues.E2E_USER_EMAIL,
      e2eAdminEmail: localValues.E2E_ADMIN_EMAIL,
      provisioningCommand: 'pnpm run e2e:provision',
      provisioningAttempted,
      provisioningSucceeded,
      provisioningBaseUrl,
    });
  }
}

main().catch((error) => {
  console.error('\n❌ Failed to set up authenticated Playwright E2E env');
  console.error(error);
  process.exit(1);
});
