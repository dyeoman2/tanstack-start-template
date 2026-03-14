#!/usr/bin/env tsx

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { internal } from '../convex/_generated/api';
import { createConvexAdminClient } from '../src/lib/server/convex-admin.server';

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

function getRequiredEnv(name: 'VITE_CONVEX_URL') {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value.trim();
}

function getEmailArg() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Usage: pnpm make-admin <email>');
  }

  return email;
}

async function main() {
  loadLocalEnv();

  const email = getEmailArg();
  getRequiredEnv('VITE_CONVEX_URL');
  const client = createConvexAdminClient();
  const result = await client.action(internal.admin.promoteUserByEmail, {
    email,
  });

  if (!result.success) {
    throw new Error(`Failed to promote ${email}`);
  }

  console.log(`Promoted ${result.email} to Better Auth admin (${result.userId}).`);
}

main().catch((error) => {
  console.error('[make-admin] Failed to promote user');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
