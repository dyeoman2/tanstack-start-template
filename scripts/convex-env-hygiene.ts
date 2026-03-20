#!/usr/bin/env tsx

/**
 * List (and optionally remove) Convex env vars that this repo does not read.
 * Run: pnpm run convex:env:hygiene
 * Apply: pnpm run convex:env:hygiene -- --apply [--prod] [--yes]
 */

import { askYesNo } from './lib/github-deploy-setup';
import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import { convexEnvList, convexEnvRemove } from './lib/convex-cli';
import { parseConvexEnvListNames } from './lib/deploy-env-helpers';
import { isLikelyUnusedConvexEnvName } from './lib/convex-unused-env';
import { emitStructuredOutput, routeLogsToStderrWhenJson } from './lib/script-ux';

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function printUsage() {
  console.log(
    'Usage: pnpm run convex:env:hygiene -- [--apply] [--prod] [--yes|--non-interactive] [--json]',
  );
  console.log('');
  console.log(
    'What this does: list known-unused Convex env vars for this repo and optionally remove them.',
  );
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run convex:env:hygiene');
  console.log('- pnpm run convex:env:hygiene -- --apply');
  console.log('- pnpm run convex:env:hygiene -- --apply --prod --yes');
  console.log('');
  console.log('Safe to rerun: yes in dry-run mode; destructive with --apply.');
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const json = hasFlag('--json');
  routeLogsToStderrWhenJson(json);
  const prod = hasFlag('--prod');
  const apply = hasFlag('--apply');
  const yes = hasFlag('--yes') || hasFlag('--non-interactive');

  requirePnpmAndConvexCli();

  const deployment = prod ? 'production' : 'development';
  console.log(`🔎 Convex env hygiene (${deployment})`);
  console.log(
    'What this does: finds env names this repo does not read and can optionally remove them.',
  );
  console.log(`Mode: ${apply ? 'apply (destructive)' : 'dry run'}`);
  console.log('Safe to rerun: yes; deletions require --apply.\n');
  let listOutput: string;
  try {
    listOutput = convexEnvList(prod);
  } catch (error) {
    console.error(
      `❌ Could not list Convex ${deployment} environment variables. Log in and link this repo, or for production ensure CONVEX_DEPLOY_KEY (or team access) is valid.`,
    );
    if (error instanceof Error && error.message.trim()) {
      console.error(error.message);
    }
    process.exit(1);
  }

  const names = parseConvexEnvListNames(listOutput);
  const unused = names.filter(isLikelyUnusedConvexEnvName).sort();

  if (unused.length === 0) {
    console.log(`✅ No known-unused Convex environment variables on ${deployment}.`);
    if (json) {
      emitStructuredOutput({ deployment, apply, removed: [], unused: [] });
    }
    return;
  }

  console.log(`Known-unused env vars on Convex ${deployment} (not referenced in app code):`);
  for (const name of unused) {
    console.log(`   • ${name}`);
  }

  if (!apply) {
    console.log('');
    console.log('Dry run. To remove them:');
    console.log(`   pnpm run convex:env:hygiene -- --apply${prod ? ' --prod' : ''}`);
    console.log('Add --yes to skip the confirmation prompt.');
    if (json) {
      emitStructuredOutput({ deployment, apply, removed: [], unused });
    }
    return;
  }

  const confirmed =
    yes ||
    (await askYesNo(
      `Remove ${unused.length} unused variable(s) from Convex ${deployment}?`,
      false,
    ));
  if (!confirmed) {
    console.log('Cancelled.');
    if (json) {
      emitStructuredOutput({ deployment, apply, cancelled: true, removed: [], unused });
    }
    return;
  }

  console.log('Removal target summary:');
  for (const name of unused) {
    console.log(`   • ${name}`);
  }
  console.log('');

  const removed: string[] = [];
  for (const name of unused) {
    try {
      convexEnvRemove(name, prod);
      console.log(`   Removed ${name}`);
      removed.push(name);
    } catch {
      console.log(`   ⚠️  Could not remove ${name} (permissions or already removed).`);
    }
  }

  console.log('\n✅ Hygiene pass complete.');
  if (json) {
    emitStructuredOutput({ deployment, apply, removed, unused });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
