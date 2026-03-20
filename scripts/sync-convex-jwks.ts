#!/usr/bin/env tsx

/**
 * Push Better Auth JWKS into Convex `JWKS` (static JWKS for faster token validation).
 * Dev:  pnpm run convex:jwks:sync
 * Prod: pnpm run convex:jwks:sync -- --prod
 *
 * @see https://labs.convex.dev/better-auth/experimental
 */

import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import {
  printJwksRemediation,
  syncConvexJwksFromBetterAuth,
  verifyConvexJwksConfigured,
  type ConvexDeploymentScope,
} from './lib/deploy-env-helpers';

function printUsage() {
  console.log('Usage: pnpm run convex:jwks:sync [-- --prod]');
  console.log('');
  console.log('What this does: fetch Better Auth JWKS and push it into Convex JWKS env.');
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run convex:jwks:sync');
  console.log('- pnpm run convex:jwks:sync -- --prod');
  console.log('');
  console.log('Safe to rerun: yes; it refreshes JWKS to the latest value.');
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  requirePnpmAndConvexCli();

  const scope: ConvexDeploymentScope = process.argv.includes('--prod') ? 'prod' : 'dev';
  const target = scope === 'prod' ? 'production' : 'development';
  console.log(`🔑 Convex JWKS sync (${target})`);
  console.log('What this does: refreshes the static JWKS used by Convex token verification.');
  console.log('Safe to rerun: yes.\n');

  try {
    syncConvexJwksFromBetterAuth(scope);
    console.log(`✅ JWKS synced to Convex (${target}).`);
    if (!verifyConvexJwksConfigured(scope)) {
      printJwksRemediation(scope);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ JWKS sync failed (${target}):`, error);
    printJwksRemediation(scope);
    process.exit(1);
  }
}

main();
