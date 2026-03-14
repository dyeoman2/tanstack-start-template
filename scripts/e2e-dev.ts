#!/usr/bin/env tsx

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HOST = '127.0.0.1';
const PORT = '3000';
const BASE_URL = `http://${HOST}:${PORT}`;

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

function assertRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required for Playwright E2E`);
  }
}

function withInstrumentServerImport(existingNodeOptions: string | undefined) {
  const importFlag = '--import ./instrument.server.mjs';
  if (!existingNodeOptions || existingNodeOptions.trim().length === 0) {
    return importFlag;
  }

  if (existingNodeOptions.includes(importFlag)) {
    return existingNodeOptions;
  }

  return `${existingNodeOptions} ${importFlag}`;
}

async function main() {
  loadLocalEnv();

  const requiredEnv = [
    'BETTER_AUTH_SECRET',
    'VITE_CONVEX_SITE_URL',
    'VITE_CONVEX_URL',
    'ENABLE_E2E_TEST_AUTH',
    'E2E_TEST_SECRET',
    'E2E_USER_EMAIL',
    'E2E_USER_PASSWORD',
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
  ];

  for (const envName of requiredEnv) {
    assertRequiredEnv(envName);
  }

  if (process.env.ENABLE_E2E_TEST_AUTH !== 'true') {
    throw new Error('ENABLE_E2E_TEST_AUTH must be set to true for authenticated Playwright E2E');
  }

  const child = spawn('pnpm', ['exec', 'vite', 'dev', '--host', HOST, '--port', PORT], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BETTER_AUTH_URL: BASE_URL,
      NODE_OPTIONS: withInstrumentServerImport(process.env.NODE_OPTIONS),
    },
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error('[e2e-dev] Failed to start frontend test server');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
