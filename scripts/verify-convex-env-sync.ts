#!/usr/bin/env tsx

/**
 * Compare `.env.local` with Convex dev env for keys that `setup:convex` normally syncs.
 * Run after editing `.env.local`: `pnpm run convex:env:verify`
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import { convexEnvList } from './lib/convex-cli';
import { getConvexDeploymentEnvValue, parseConvexEnvListNames } from './lib/deploy-env-helpers';
import {
  findForbiddenStorageEnvNames,
  LEGACY_FORBIDDEN_STORAGE_ENV_NAMES,
} from './lib/storage-env-contract';

const SYNC_KEYS = [
  'APP_NAME',
  'AUTH_PROXY_SHARED_SECRET',
  'BETTER_AUTH_SECRETS',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OPENROUTER_API_KEY',
  'RESEND_API_KEY',
  'RESEND_EMAIL_SENDER',
] as const;

/** Non-secret keys: compare values when both sides are set. */
const VALUE_COMPARE_KEYS = ['APP_NAME', 'BETTER_AUTH_URL', 'RESEND_EMAIL_SENDER'] as const;

function printUsage() {
  console.log('Usage: pnpm run convex:env:verify');
  console.log('');
  console.log('What this does: compares synced keys in .env.local against Convex dev env.');
  console.log('Safe to rerun: yes; this script is read-only.');
}

function readOptionalEnvValue(envContent: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envContent.match(new RegExp(`^${escapedName}=(.*)$`, 'm'));
  if (!match) {
    return null;
  }

  const rawValue = match[1]?.trim();
  if (!rawValue) {
    return null;
  }

  if (
    rawValue.startsWith('<') ||
    rawValue.includes('your-openrouter-api-key') ||
    rawValue.includes('your-')
  ) {
    return null;
  }

  return rawValue.replace(/^"(.*)"$/, '$1');
}

function normalizeComparableValue(key: string, v: string): string {
  const t = v.trim();
  if (key === 'BETTER_AUTH_URL' || key.endsWith('_URL')) {
    return t.replace(/\/$/u, '');
  }
  return t;
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  console.log('🔎 Convex env drift check');
  console.log(
    'What this does: verifies setup:convex-synced keys are present on Convex dev and comparable values match.',
  );
  console.log('Safe to rerun: yes; this script is read-only.\n');
  requirePnpmAndConvexCli();

  const envPath = join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) {
    console.log('❌ .env.local not found. Run pnpm run setup:env first.');
    process.exit(1);
  }

  let convexList: string;
  try {
    convexList = convexEnvList(false);
  } catch {
    console.log('❌ Could not list Convex dev environment. Is the project linked and logged in?');
    process.exit(1);
  }

  const envContent = readFileSync(envPath, 'utf8');
  const convexNames = new Set(parseConvexEnvListNames(convexList));
  const forbiddenLocalStorageEnv = findForbiddenStorageEnvNames(
    Object.fromEntries(
      LEGACY_FORBIDDEN_STORAGE_ENV_NAMES.map((name) => [
        name,
        readOptionalEnvValue(envContent, name),
      ]),
    ),
  );
  const forbiddenConvexStorageEnv = findForbiddenStorageEnvNames(
    Object.fromEntries([...convexNames].map((name) => [name, name])),
  );

  if (forbiddenLocalStorageEnv.length > 0 || forbiddenConvexStorageEnv.length > 0) {
    if (forbiddenLocalStorageEnv.length > 0) {
      console.log(
        `❌ Forbidden legacy storage envs still exist in .env.local: ${forbiddenLocalStorageEnv.join(', ')}`,
      );
    }
    if (forbiddenConvexStorageEnv.length > 0) {
      console.log(
        `❌ Forbidden legacy storage envs still exist on Convex dev: ${forbiddenConvexStorageEnv.join(', ')}`,
      );
    }
    process.exit(1);
  }

  const missingOnConvex: string[] = [];
  for (const key of SYNC_KEYS) {
    const googleId =
      readOptionalEnvValue(envContent, 'GOOGLE_CLIENT_ID') ??
      readOptionalEnvValue(envContent, 'BETTER_AUTH_GOOGLE_CLIENT_ID');
    const googleSecret =
      readOptionalEnvValue(envContent, 'GOOGLE_CLIENT_SECRET') ??
      readOptionalEnvValue(envContent, 'BETTER_AUTH_GOOGLE_CLIENT_SECRET');

    if (key === 'GOOGLE_CLIENT_ID' || key === 'GOOGLE_CLIENT_SECRET') {
      if (!googleId || !googleSecret) {
        continue;
      }
    }

    const local =
      key === 'GOOGLE_CLIENT_ID'
        ? googleId
        : key === 'GOOGLE_CLIENT_SECRET'
          ? googleSecret
          : readOptionalEnvValue(envContent, key);

    if (local && !convexNames.has(key)) {
      missingOnConvex.push(key);
    }
  }

  const valueDrift: string[] = [];
  for (const key of VALUE_COMPARE_KEYS) {
    const local = readOptionalEnvValue(envContent, key);
    if (!local) {
      continue;
    }
    if (!convexNames.has(key)) {
      continue;
    }
    const remote = getConvexDeploymentEnvValue(key, 'dev');
    if (remote === null) {
      continue;
    }
    if (normalizeComparableValue(key, local) !== normalizeComparableValue(key, remote)) {
      valueDrift.push(key);
    }
  }

  if (missingOnConvex.length > 0) {
    console.log('⚠️  These keys are set in .env.local but missing on Convex dev:');
    for (const key of missingOnConvex) {
      console.log(`   • ${key}`);
    }
    console.log('');
    console.log('Run: pnpm run setup:convex');
    process.exit(1);
  }

  if (valueDrift.length > 0) {
    console.log('⚠️  These non-secret values differ between .env.local and Convex dev:');
    for (const key of valueDrift) {
      console.log(`   • ${key}`);
    }
    console.log('');
    console.log('Run: pnpm run setup:convex');
    process.exit(1);
  }

  console.log('✅ Sync keys are present on Convex dev and comparable non-secret values match.');
  console.log('   (Secrets are presence-only; rotate via setup:convex as needed.)');
}

main();
