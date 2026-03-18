#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
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

function run(command: string) {
  execSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
}

async function chooseStorageMode(): Promise<StorageMode> {
  console.log('🗂️  Production storage mode options:');
  console.log('   1. convex      - default, no AWS required');
  console.log('   2. s3-primary  - direct-to-S3, GuardDuty on canonical object');
  console.log('   3. s3-mirror   - upload to Convex first, then mirror to S3');
  console.log('');

  while (true) {
    const answer = (await ask('Choose production storage mode [1]: ')) || '1';
    if (answer === '1' || answer === 'convex') return 'convex';
    if (answer === '2' || answer === 's3-primary') return 's3-primary';
    if (answer === '3' || answer === 's3-mirror') return 's3-mirror';
    console.log('Please choose 1, 2, or 3.');
  }
}

async function setConvexProdEnv(vars: Record<string, string>) {
  console.log('\n☁️  Setting Convex production env vars...');
  for (const [name, value] of Object.entries(vars)) {
    run(`npx convex env set ${name} "${value}" --prod`);
  }
}

async function setNetlifyEnv(vars: Record<string, string>) {
  console.log('\n🌐 Setting Netlify env vars...');
  for (const [name, value] of Object.entries(vars)) {
    run(`npx netlify env:set ${name} "${value}"`);
  }
}

async function main() {
  console.log('🚀 Production storage setup\n');
  console.log('This script sets storage runtime env vars in both Convex prod and Netlify.');
  console.log(
    'It assumes you already have access to both CLIs and that your Netlify site is linked.\n',
  );

  const shouldContinue = await askYesNo('Continue?', true);
  if (!shouldContinue) {
    console.log('👋 Cancelled.');
    return;
  }

  const storageMode = await chooseStorageMode();

  const envVars: Record<string, string> = {
    FILE_STORAGE_BACKEND: storageMode,
  };

  if (storageMode !== 'convex') {
    const awsRegion = await askWithDefault('AWS region', 'us-west-1');
    const bucket = await askWithDefault(
      'AWS S3 files bucket',
      'tanstack-start-template-files-prod',
    );
    const convexSiteUrl = await askWithDefault(
      'Convex site URL',
      'https://your-deployment.convex.site',
    );
    const webhookSecret = await askWithDefault(
      'AWS malware webhook shared secret',
      await generateSecret(32),
    );
    const serveSecret = await askWithDefault(
      'AWS file serve signing secret',
      await generateSecret(32),
    );

    envVars.AWS_REGION = awsRegion;
    envVars.AWS_S3_FILES_BUCKET = bucket;
    envVars.AWS_MALWARE_WEBHOOK_SHARED_SECRET = webhookSecret;
    envVars.AWS_FILE_SERVE_SIGNING_SECRET = serveSecret;
    envVars.CONVEX_SITE_URL = convexSiteUrl;
  }

  console.log('\nValues to set:');
  for (const [name, value] of Object.entries(envVars)) {
    const displayValue = name.includes('SECRET') ? '[generated/set]' : value;
    console.log(`   ${name}=${displayValue}`);
  }

  const setConvex = await askYesNo('\nSet these in Convex production now?', true);
  if (setConvex) {
    try {
      await setConvexProdEnv(envVars);
      console.log('✅ Convex production env updated.');
    } catch {
      console.log('⚠️  Failed while setting Convex production env vars.');
      console.log('   You can retry manually with `npx convex env set ... --prod`.');
    }
  }

  const setNetlify = await askYesNo('\nSet these in Netlify now?', true);
  if (setNetlify) {
    try {
      await setNetlifyEnv(envVars);
      console.log('✅ Netlify env updated.');
    } catch {
      console.log('⚠️  Failed while setting Netlify env vars.');
      console.log('   Make sure the site is linked, then retry with `npx netlify env:set ...`.');
    }
  }

  console.log('\nDone.');
  console.log('If you chose an AWS-backed mode, the remaining step is infrastructure deployment:');
  console.log('   1. export the CDK deploy env vars from infra/README.md');
  console.log('   2. pnpm infra:preview');
  console.log('   3. pnpm infra:deploy');
}

main().catch((error) => {
  console.error('\n❌ Production storage setup failed');
  console.error(error);
  process.exit(1);
});
