#!/usr/bin/env tsx

import { internal } from '../convex/_generated/api';
import { createConvexAdminClient } from '../src/lib/server/convex-admin.server';
import { loadProjectEnvFiles } from './lib/load-project-env-files';

function loadLocalEnv() {
  loadProjectEnvFiles();
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

function printUsage() {
  console.log('Usage: pnpm make-admin <email>');
  console.log('');
  console.log(
    'What this does: promote an existing user to Better Auth admin in the current Convex deployment.',
  );
  console.log('');
  console.log('Examples:');
  console.log('- pnpm make-admin admin@example.com');
  console.log('');
  console.log('Safe to rerun: yes; promoting an already-admin user is harmless.');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  loadLocalEnv();

  const email = getEmailArg();
  console.log('👤 Make admin');
  console.log('What this does: promote one user by email in the current deployment.');
  console.log('Prereqs: VITE_CONVEX_URL and server-side admin access available locally.');
  console.log('Safe to rerun: yes.\n');
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
