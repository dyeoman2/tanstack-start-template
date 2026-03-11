#!/usr/bin/env tsx

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

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

function getRequiredEnv(name: 'BETTER_AUTH_SECRET' | 'VITE_CONVEX_URL') {
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
  const convexUrl = getRequiredEnv('VITE_CONVEX_URL');
  const token = getRequiredEnv('BETTER_AUTH_SECRET');

  const client = new ConvexHttpClient(convexUrl, { logger: false });
  const result = await client.action(api.admin.promoteUserByEmail, {
    token,
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
