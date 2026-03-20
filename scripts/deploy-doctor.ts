#!/usr/bin/env tsx

/**
 * Quick deploy readiness checks (tooling, Convex, JWKS, optional Netlify link).
 * Run: pnpm run deploy:doctor
 * Include production Convex/JWKS + env hints: pnpm run deploy:doctor -- --prod
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireCommands } from './lib/cli-preflight';
import { convexEnvList } from './lib/convex-cli';
import { verifyConvexJwksConfigured } from './lib/deploy-env-helpers';
import {
  formatNetlifySiteSummary,
  getNetlifySiteDetails,
  readNetlifyLinkedSiteIdFromDisk,
} from './lib/netlify-cli';
import { emitStructuredOutput, hasFlag, routeLogsToStderrWhenJson } from './lib/script-ux';

function printUsage() {
  console.log('Usage: pnpm run deploy:doctor [-- --prod] [--json]');
  console.log('');
  console.log(
    'What this does: read-only deploy readiness checks for local/dev and optional production access.',
  );
  console.log('Docs: docs/DEPLOY_ENVIRONMENT.md');
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run deploy:doctor');
  console.log('- pnpm run deploy:doctor -- --prod');
  console.log('- pnpm run deploy:doctor -- --prod --json');
  console.log('');
  console.log('Safe to rerun: yes; this script only reads state.');
}

function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const prod = hasFlag('--prod');
  const json = hasFlag('--json');
  routeLogsToStderrWhenJson(json);
  let ok = true;
  const checks: Array<{ check: string; status: 'pass' | 'warn' | 'fail'; detail?: string }> = [];

  console.log('\n🔎 Deploy doctor\n');
  console.log(
    'What this does: verifies tooling, Convex access, JWKS presence, optional Netlify link, and local env files.',
  );
  console.log(`Checks mode: ${prod ? 'development + production' : 'development only'}`);
  console.log('Safe to rerun: yes; this script is read-only.\n');

  requireCommands([{ cmd: 'pnpm' }]);
  console.log('✅ pnpm on PATH');
  checks.push({ check: 'pnpm on PATH', status: 'pass' });

  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: process.cwd(), stdio: 'ignore' });
    console.log('✅ Git repository');
    checks.push({ check: 'Git repository', status: 'pass' });
  } catch {
    console.log('❌ Not a git repository');
    ok = false;
    checks.push({ check: 'Git repository', status: 'fail', detail: 'Not a git repository' });
  }

  try {
    execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });
    console.log('✅ Git remote origin');
    checks.push({ check: 'Git remote origin', status: 'pass' });
  } catch {
    console.log('⚠️  No git remote origin (optional for local-only work)');
    checks.push({
      check: 'Git remote origin',
      status: 'warn',
      detail: 'No remote origin configured',
    });
  }

  try {
    convexEnvList(false);
    console.log('✅ Convex CLI: dev env list');
    checks.push({ check: 'Convex dev env list', status: 'pass' });
  } catch {
    console.log('❌ Convex dev env list failed');
    console.log('   Run: pnpm exec convex login && link this directory to a Convex project.');
    ok = false;
    checks.push({
      check: 'Convex dev env list',
      status: 'fail',
      detail: 'Convex dev env list failed',
    });
  }

  if (verifyConvexJwksConfigured('dev')) {
    console.log('✅ JWKS present (Convex dev)');
    checks.push({ check: 'JWKS present (Convex dev)', status: 'pass' });
  } else {
    console.log('❌ JWKS missing or invalid (Convex dev)');
    console.log('   Run: pnpm run convex:jwks:sync');
    ok = false;
    checks.push({
      check: 'JWKS present (Convex dev)',
      status: 'fail',
      detail: 'JWKS missing or invalid',
    });
  }

  if (prod) {
    if (process.env.CONVEX_DEPLOY_KEY?.trim()) {
      console.log('✅ CONVEX_DEPLOY_KEY is set');
      checks.push({ check: 'CONVEX_DEPLOY_KEY set', status: 'pass' });
    } else {
      console.log('⚠️  CONVEX_DEPLOY_KEY not set (usually required for prod CLI and CI deploys)');
      checks.push({
        check: 'CONVEX_DEPLOY_KEY set',
        status: 'warn',
        detail: 'Unset in current environment',
      });
    }

    if (process.env.NETLIFY_AUTH_TOKEN?.trim()) {
      console.log('✅ NETLIFY_AUTH_TOKEN is set');
      checks.push({ check: 'NETLIFY_AUTH_TOKEN set', status: 'pass' });
    } else {
      console.log('⚠️  NETLIFY_AUTH_TOKEN not set (Netlify CLI/API flows may prompt or fail)');
      checks.push({
        check: 'NETLIFY_AUTH_TOKEN set',
        status: 'warn',
        detail: 'Unset in current environment',
      });
    }

    try {
      convexEnvList(true);
      console.log('✅ Convex CLI: production env list');
      checks.push({ check: 'Convex production env list', status: 'pass' });
    } catch {
      console.log('❌ Convex production env list failed');
      console.log('   Confirm deployment access (e.g. CONVEX_DEPLOY_KEY / team membership).');
      ok = false;
      checks.push({
        check: 'Convex production env list',
        status: 'fail',
        detail: 'Convex production env list failed',
      });
    }

    if (verifyConvexJwksConfigured('prod')) {
      console.log('✅ JWKS present (Convex production)');
      checks.push({ check: 'JWKS present (Convex production)', status: 'pass' });
    } else {
      console.log('❌ JWKS missing or invalid (Convex production)');
      console.log('   Run: pnpm run convex:jwks:sync -- --prod');
      ok = false;
      checks.push({
        check: 'JWKS present (Convex production)',
        status: 'fail',
        detail: 'JWKS missing or invalid',
      });
    }
  }

  const linked = readNetlifyLinkedSiteIdFromDisk();
  if (linked) {
    const details = getNetlifySiteDetails(linked);
    if (details) {
      console.log(`✅ Netlify linked: ${formatNetlifySiteSummary(details) ?? linked}`);
      checks.push({
        check: 'Netlify linked site',
        status: 'pass',
        detail: formatNetlifySiteSummary(details) ?? linked,
      });
    } else {
      console.log(`⚠️  Netlify state.json site id present but site details unavailable: ${linked}`);
      checks.push({ check: 'Netlify linked site', status: 'warn', detail: linked });
    }
  } else {
    console.log('⚠️  No .netlify/state.json (optional unless you sync Netlify env via CLI)');
    checks.push({ check: 'Netlify linked site', status: 'warn', detail: 'No .netlify/state.json' });
  }

  const envLocal = join(process.cwd(), '.env.local');
  if (existsSync(envLocal)) {
    console.log('✅ .env.local present');
    checks.push({ check: '.env.local present', status: 'pass' });
  } else {
    console.log('⚠️  .env.local missing — run pnpm run setup:env');
    checks.push({ check: '.env.local present', status: 'warn', detail: '.env.local missing' });
  }

  console.log('');
  if (json) {
    emitStructuredOutput({ ok, mode: prod ? 'dev+prod' : 'dev', checks });
  }
  if (!ok) {
    console.log('Fix the failed checks, then rerun deploy:doctor.\n');
    process.exit(1);
  }

  console.log('All required checks passed.\n');
}

main();
