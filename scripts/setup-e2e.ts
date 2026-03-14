#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSecret } from '../src/lib/server/crypto.server';

const envPath = join(process.cwd(), '.env.local');

const DEFAULT_E2E_VALUES = {
  ENABLE_E2E_TEST_AUTH: 'true',
  E2E_USER_EMAIL: 'e2e-user@local.test',
  E2E_USER_PASSWORD: 'E2EUser!1234',
  E2E_USER_NAME: 'E2E User',
  E2E_ADMIN_EMAIL: 'e2e-admin@local.test',
  E2E_ADMIN_PASSWORD: 'E2EAdmin!1234',
  E2E_ADMIN_NAME: 'E2E Admin',
} as const;

function loadLocalEnv() {
  const loadEnvFile = process.loadEnvFile?.bind(process);
  if (!loadEnvFile) {
    return;
  }

  for (const fileName of ['.env', '.env.local']) {
    const filePath = join(process.cwd(), fileName);
    if (existsSync(filePath)) {
      loadEnvFile(filePath);
    }
  }
}

function formatEnvValue(value: string) {
  if (/^[A-Za-z0-9._:/@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function upsertEnvValue(envContent: string, name: string, value: string) {
  const nextLine = `${name}=${formatEnvValue(value)}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');

  if (pattern.test(envContent)) {
    return envContent.replace(pattern, nextLine);
  }

  const trimmed = envContent.trimEnd();
  return `${trimmed}\n${trimmed.length > 0 ? '\n' : ''}${nextLine}\n`;
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

async function main() {
  console.log('🔐 Setting up authenticated Playwright E2E env...\n');

  ensureLocalEnvFile();
  loadLocalEnv();

  const localValues = {
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
    envContent = upsertEnvValue(envContent, name, value);
  }
  writeFileSync(envPath, envContent, 'utf8');

  const convexArgs = process.argv.includes('--prod') ? '--prod' : '';
  const convexTarget = convexArgs ? 'production' : 'current development';

  console.log(`✅ Updated local E2E values in ${envPath}`);
  console.log(`🔧 Syncing required E2E gate vars to the ${convexTarget} Convex deployment...`);

  const convexEnvVars = [
    ['ENABLE_E2E_TEST_AUTH', localValues.ENABLE_E2E_TEST_AUTH],
    ['E2E_TEST_SECRET', localValues.E2E_TEST_SECRET],
  ] as const;

  for (const [name, value] of convexEnvVars) {
    console.log(`   Setting ${name}...`);
    execSync(`npx convex env set ${name} ${JSON.stringify(value)} ${convexArgs}`.trim(), {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
  }

  console.log('\n✅ Authenticated Playwright E2E setup complete!');
  console.log('────────────────────────────────────────────────');
  console.log(`ENABLE_E2E_TEST_AUTH=${localValues.ENABLE_E2E_TEST_AUTH}`);
  console.log(`E2E_TEST_SECRET=${localValues.E2E_TEST_SECRET}`);
  console.log(`E2E_USER_EMAIL=${localValues.E2E_USER_EMAIL}`);
  console.log(`E2E_ADMIN_EMAIL=${localValues.E2E_ADMIN_EMAIL}`);
  console.log('────────────────────────────────────────────────');
  console.log('Run `pnpm test:e2e` to execute the authenticated Playwright suite.');
}

main().catch((error) => {
  console.error('\n❌ Failed to set up authenticated Playwright E2E env');
  console.error(error);
  process.exit(1);
});
