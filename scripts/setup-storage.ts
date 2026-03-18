#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { generateSecret } from '../src/lib/server/crypto.server';

type StorageMode = 'convex' | 's3-primary' | 's3-mirror';

function createPrompt() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(question: string) {
  const rl = createPrompt();
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function askWithDefault(question: string, fallback: string) {
  const answer = await ask(`${question} [${fallback}]: `);
  return answer || fallback;
}

async function askYesNo(question: string, fallback = false) {
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} (${suffix}): `)).toLowerCase();
  if (!answer) {
    return fallback;
  }

  return answer === 'y' || answer === 'yes';
}

function readEnvFile(envPath: string) {
  return existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
}

function readEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envContent.match(new RegExp(`^${escapedName}=(.*)$`, 'm'));
  return match?.[1]?.trim()?.replace(/^"(.*)"$/, '$1') || null;
}

function upsertEnvValue(envContent: string, name: string, value: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `${name}=${value}`;

  if (new RegExp(`^${escapedName}=`, 'm').test(envContent)) {
    return envContent.replace(new RegExp(`^${escapedName}=.*$`, 'm'), line);
  }

  const separator = envContent.endsWith('\n') || envContent.length === 0 ? '' : '\n';
  return `${envContent}${separator}${line}\n`;
}

function maybeQuote(value: string) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function trySetConvexEnv(name: string, value: string) {
  execSync(`npx convex env set ${name} "${value}"`, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
}

function run(command: string) {
  execSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
}

async function chooseStorageMode(): Promise<StorageMode> {
  console.log('🗂️  Storage mode options:');
  console.log('   1. convex      - default, no AWS required');
  console.log('   2. s3-primary  - direct-to-S3, GuardDuty on canonical object');
  console.log('   3. s3-mirror   - upload to Convex first, then mirror to S3');
  console.log('');

  while (true) {
    const answer = (await ask('Choose storage mode [1]: ')) || '1';
    if (answer === '1' || answer === 'convex') return 'convex';
    if (answer === '2' || answer === 's3-primary') return 's3-primary';
    if (answer === '3' || answer === 's3-mirror') return 's3-mirror';
    console.log('Please choose 1, 2, or 3.');
  }
}

async function main() {
  console.log('🔧 Storage setup\n');

  const cwd = process.cwd();
  const envPath = join(cwd, '.env.local');
  if (!existsSync(envPath)) {
    console.log('❌ .env.local not found.');
    console.log('   Run: pnpm run setup:env');
    process.exit(1);
  }

  let envContent = readEnvFile(envPath);
  const storageMode = await chooseStorageMode();
  envContent = upsertEnvValue(envContent, 'FILE_STORAGE_BACKEND', storageMode);

  const convexSiteUrlFallback =
    readEnvValue(envContent, 'CONVEX_SITE_URL') ??
    readEnvValue(envContent, 'VITE_CONVEX_SITE_URL') ??
    'http://127.0.0.1:3210';

  if (storageMode === 'convex') {
    writeFileSync(envPath, envContent, 'utf8');
    console.log('\n✅ Storage configured for convex mode.');
    console.log(`   Updated: ${envPath}`);
    console.log('');
    console.log('No AWS storage env vars are required for this mode.');
    console.log(
      'No Convex storage env sync is needed beyond FILE_STORAGE_BACKEND=convex if you want parity.',
    );

    const syncConvex = await askYesNo(
      'Sync FILE_STORAGE_BACKEND=convex into Convex env too?',
      false,
    );
    if (syncConvex) {
      try {
        trySetConvexEnv('FILE_STORAGE_BACKEND', 'convex');
      } catch {
        console.log('⚠️  Failed to sync Convex env automatically. Set it manually if needed.');
      }
    }
    return;
  }

  const awsRegion = await askWithDefault(
    'AWS region',
    readEnvValue(envContent, 'AWS_REGION') ?? 'us-west-1',
  );
  const bucket = await askWithDefault(
    'AWS S3 files bucket',
    readEnvValue(envContent, 'AWS_S3_FILES_BUCKET') ?? 'tanstack-start-template-files-dev',
  );
  const convexSiteUrl = await askWithDefault('Convex site URL', convexSiteUrlFallback);
  const webhookSecret = await askWithDefault(
    'AWS malware webhook shared secret',
    readEnvValue(envContent, 'AWS_MALWARE_WEBHOOK_SHARED_SECRET') ?? (await generateSecret(32)),
  );
  const serveSecret = await askWithDefault(
    'AWS file serve signing secret',
    readEnvValue(envContent, 'AWS_FILE_SERVE_SIGNING_SECRET') ?? (await generateSecret(32)),
  );

  envContent = upsertEnvValue(envContent, 'AWS_REGION', awsRegion);
  envContent = upsertEnvValue(envContent, 'AWS_S3_FILES_BUCKET', bucket);
  envContent = upsertEnvValue(
    envContent,
    'AWS_MALWARE_WEBHOOK_SHARED_SECRET',
    maybeQuote(webhookSecret),
  );
  envContent = upsertEnvValue(envContent, 'AWS_FILE_SERVE_SIGNING_SECRET', maybeQuote(serveSecret));
  envContent = upsertEnvValue(envContent, 'CONVEX_SITE_URL', convexSiteUrl);

  writeFileSync(envPath, envContent, 'utf8');

  console.log(`\n✅ Storage configured for ${storageMode}.`);
  console.log(`   Updated: ${envPath}`);
  console.log('');
  console.log('Runtime envs written locally:');
  console.log(`   FILE_STORAGE_BACKEND=${storageMode}`);
  console.log(`   AWS_REGION=${awsRegion}`);
  console.log(`   AWS_S3_FILES_BUCKET=${bucket}`);
  console.log('   AWS_MALWARE_WEBHOOK_SHARED_SECRET=[set]');
  console.log('   AWS_FILE_SERVE_SIGNING_SECRET=[set]');
  console.log(`   CONVEX_SITE_URL=${convexSiteUrl}`);
  console.log('');
  console.log(
    'These same values must also exist in your Convex deployment env for AWS-backed modes.',
  );

  const syncConvex = await askYesNo('Sync these storage env vars into Convex now?', true);
  if (!syncConvex) {
    console.log('');
    console.log('Set these manually in Convex when ready:');
    console.log(`   npx convex env set FILE_STORAGE_BACKEND "${storageMode}"`);
    console.log(`   npx convex env set AWS_REGION "${awsRegion}"`);
    console.log(`   npx convex env set AWS_S3_FILES_BUCKET "${bucket}"`);
    console.log('   npx convex env set AWS_MALWARE_WEBHOOK_SHARED_SECRET "<secret>"');
    console.log('   npx convex env set AWS_FILE_SERVE_SIGNING_SECRET "<secret>"');
    console.log(`   npx convex env set CONVEX_SITE_URL "${convexSiteUrl}"`);
  } else {
    try {
      trySetConvexEnv('FILE_STORAGE_BACKEND', storageMode);
      trySetConvexEnv('AWS_REGION', awsRegion);
      trySetConvexEnv('AWS_S3_FILES_BUCKET', bucket);
      trySetConvexEnv('AWS_MALWARE_WEBHOOK_SHARED_SECRET', webhookSecret);
      trySetConvexEnv('AWS_FILE_SERVE_SIGNING_SECRET', serveSecret);
      trySetConvexEnv('CONVEX_SITE_URL', convexSiteUrl);
      console.log('\n✅ Convex env synced.');
    } catch {
      console.log('\n⚠️  Automatic Convex env sync failed.');
      console.log(
        '   Your .env.local is configured, but you still need to set the same values in Convex.',
      );
    }
  }

  console.log('');
  console.log('AWS-backed modes also require CDK deploy-time env vars from infra/README.md.');

  const shouldPreviewInfra = await askYesNo('Run `pnpm infra:preview` now?', false);
  if (shouldPreviewInfra) {
    try {
      run('pnpm infra:preview');
      console.log('✅ CDK preview completed.');
    } catch {
      console.log('⚠️  CDK preview failed.');
      console.log('   Check the required deploy-time env vars in infra/README.md and retry.');
    }
  }

  const shouldDeployInfra = await askYesNo('Run `pnpm infra:deploy` now?', false);
  if (shouldDeployInfra) {
    try {
      run('pnpm infra:deploy');
      console.log('✅ AWS storage infrastructure deployed.');
    } catch {
      console.log('⚠️  CDK deploy failed.');
      console.log('   Check the required deploy-time env vars in infra/README.md and retry.');
    }
  } else {
    console.log('Next steps for AWS-backed modes:');
    console.log('   1. Configure deploy-time CDK env vars from infra/README.md');
    console.log('   2. Run: pnpm infra:preview');
    console.log('   3. Run: pnpm infra:deploy');
  }
}

main().catch((error) => {
  console.error('\n❌ Storage setup failed');
  console.error(error);
  process.exit(1);
});
