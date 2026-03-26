#!/usr/bin/env tsx

import process from 'node:process';
import { requirePnpmAndConvexCli } from './lib/cli-preflight';
import { convexExecCaptured } from './lib/convex-cli';
import { parseConvexRunStdout } from './lib/deploy-env-helpers';
import { emitStructuredOutput, routeLogsToStderrWhenJson } from './lib/script-ux';
import {
  assertSecretTierAcknowledgment,
  SECRET_TIER_ACK_ENV,
  SECRET_TIER_ACK_FLAG,
} from './lib/secret-tier';

type PurgeResult = {
  batchCount: number;
  deletedCount: number;
};

function printUsage() {
  console.log(
    'Usage: pnpm run auth:sessions:purge -- [--prod] [--json] [--ack-secret-tier] [--reason <text>]',
  );
  console.log('');
  console.log(
    'What this does: purge all Better Auth session rows on the target Convex deployment.',
  );
  console.log('Use this for break-glass response and secret-tier rotation events.');
  console.log(`Production mutation requires ${SECRET_TIER_ACK_FLAG} or ${SECRET_TIER_ACK_ENV}=1.`);
  console.log('Safe to rerun: yes; repeated runs become a no-op after sessions are gone.');
}

function parseReason(argv: readonly string[]) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--reason') {
      return argv[index + 1]?.trim() || null;
    }
    if (value?.startsWith('--reason=')) {
      return value.slice('--reason='.length).trim() || null;
    }
  }

  return null;
}

function parsePurgeResult(stdout: string): PurgeResult {
  const payload = parseConvexRunStdout(stdout);
  const parsed = JSON.parse(payload) as Partial<PurgeResult>;
  return {
    batchCount: typeof parsed.batchCount === 'number' ? parsed.batchCount : 0,
    deletedCount: typeof parsed.deletedCount === 'number' ? parsed.deletedCount : 0,
  };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const json = argv.includes('--json');
  const prod = argv.includes('--prod');
  routeLogsToStderrWhenJson(json);

  if (prod) {
    assertSecretTierAcknowledgment({
      command: 'pnpm run auth:sessions:purge -- --prod',
      argv: process.argv,
      env: process.env,
    });
  }

  requirePnpmAndConvexCli();

  const initiatedBy =
    process.env.CI === 'true'
      ? 'ci'
      : process.env.USER?.trim() || process.env.LOGNAME?.trim() || 'unknown-operator';
  const reason =
    parseReason(argv) || (prod ? 'Secret-tier production session purge' : 'Manual session purge');
  const args = ['run', 'auth:purgeAllSessions', JSON.stringify({ initiatedBy, reason })];
  if (prod) {
    args.push('--prod');
  }

  console.log(`🔐 Better Auth session purge (${prod ? 'production' : 'development'})`);
  console.log('What this does: deletes every Better Auth session row on the target deployment.');
  console.log('Safe to rerun: yes.\n');

  try {
    const result = parsePurgeResult(convexExecCaptured(args));
    const summary = {
      ...result,
      target: prod ? 'prod' : 'dev',
    };

    console.log(
      `✅ Deleted ${result.deletedCount} session row${result.deletedCount === 1 ? '' : 's'} across ${result.batchCount} batch${result.batchCount === 1 ? '' : 'es'}.`,
    );

    if (json) {
      emitStructuredOutput(summary);
    }
  } catch (error) {
    console.error('\n❌ Better Auth session purge failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
