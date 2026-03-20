#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process';
import { deriveConvexSiteUrl } from '../src/lib/convex-url';
import {
  CLI_INSTALL_HINT,
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { runNetlify } from './lib/netlify-cli';
import { convexEnvSet } from './lib/convex-cli';
import { createInterface } from 'node:readline';
import { generateSecret } from '../src/lib/server/crypto.server';
import {
  emitStructuredOutput,
  printFinalChangeSummary,
  printStatusSummary,
  printTargetSummary,
  routeLogsToStderrWhenJson,
} from './lib/script-ux';

type StorageMode = 'convex' | 's3-primary' | 's3-mirror';
type AwsIdentity = {
  accountId?: string;
  arn?: string;
  region: string;
};

function createPrompt() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(question: string, initialValue?: string) {
  const rl = createPrompt();
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    if (initialValue) {
      rl.write(initialValue);
    }
  });
}

async function askWithDefault(question: string, fallback: string) {
  const answer = await ask(`${question}: `, fallback);
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

function run(command: string, env?: NodeJS.ProcessEnv) {
  execSync(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: 'inherit',
  });
}

function getDefaultConvexSiteUrl() {
  const explicit = process.env.CONVEX_SITE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const convexUrl = process.env.VITE_CONVEX_URL?.trim();
  if (convexUrl) {
    return deriveConvexSiteUrl(convexUrl);
  }

  return 'https://your-deployment.convex.site';
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function buildGuardDutyWebhookUrl(convexSiteUrl: string) {
  return `${trimTrailingSlashes(convexSiteUrl)}/aws/guardduty-malware`;
}

function buildStorageDeployEnv(input: {
  awsRegion: string;
  awsProfile?: string;
  bucket: string;
  convexSiteUrl: string;
  webhookSecret: string;
}) {
  return {
    AWS_REGION: input.awsRegion,
    ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    AWS_S3_FILES_BUCKET: input.bucket,
    CONVEX_SITE_URL: input.convexSiteUrl,
    CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || input.awsRegion,
    AWS_CONVEX_GUARDDUTY_WEBHOOK_URL: buildGuardDutyWebhookUrl(input.convexSiteUrl),
    AWS_MALWARE_WEBHOOK_SHARED_SECRET: input.webhookSecret,
    AWS_S3_FILES_BUCKET_NAME: input.bucket,
  };
}

function listAwsProfiles() {
  try {
    return execSync('aws configure list-profiles', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function chooseAwsProfile(currentProfile: string | null) {
  const profiles = listAwsProfiles();
  if (profiles.length === 0) {
    return currentProfile;
  }

  console.log('AWS CLI profiles:');
  for (const [index, profile] of profiles.entries()) {
    const marker = profile === currentProfile ? ' (current)' : '';
    console.log(`   ${index + 1}. ${profile}${marker}`);
  }
  console.log('');

  const defaultProfile =
    (currentProfile && profiles.includes(currentProfile) ? currentProfile : null) ??
    profiles[0] ??
    null;

  const answer = await ask(
    `Select AWS profile by number or name${defaultProfile ? ` [${defaultProfile}]` : ''}: `,
  );

  if (!answer) {
    return defaultProfile;
  }

  const asNumber = Number.parseInt(answer, 10);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= profiles.length) {
    return profiles[asNumber - 1] ?? defaultProfile;
  }

  if (profiles.includes(answer)) {
    return answer;
  }

  console.log(
    `Profile "${answer}" was not found in aws configure list-profiles. Keeping ${defaultProfile ?? 'current shell profile'}.`,
  );
  return defaultProfile;
}

function getAwsIdentity(region: string, awsProfile?: string): AwsIdentity | null {
  try {
    const output = execSync('aws sts get-caller-identity --output json', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AWS_REGION: region,
        ...(awsProfile ? { AWS_PROFILE: awsProfile } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();

    const parsed = JSON.parse(output) as { Account?: string; Arn?: string };
    return {
      accountId: parsed.Account,
      arn: parsed.Arn,
      region,
    };
  } catch {
    return null;
  }
}

async function chooseStorageMode(): Promise<StorageMode> {
  console.log('🗂️  Production storage mode options:');
  console.log('   1. convex      - default, convex only, no AWS required');
  console.log('   2. s3          - s3 only with GuardDuty malware scanning');
  console.log(
    '   3. mirror      - upload to Convex first, then mirror to S3 with GuardDuty malware scanning',
  );
  console.log('');

  while (true) {
    const answer = (await ask('Choose production storage mode [1]: ')) || '1';
    if (answer === '1' || answer === 'convex') return 'convex';
    if (answer === '2' || answer === 's3' || answer === 's3-primary') return 's3-primary';
    if (answer === '3' || answer === 'mirror' || answer === 's3-mirror') return 's3-mirror';
    console.log('Please choose 1, 2, or 3.');
  }
}

function printUsage() {
  console.log('Usage: pnpm run storage:setup:prod [--json]');
  console.log('');
  console.log(
    'What this does: configure production storage runtime vars in Convex/Netlify and optionally preview/deploy production AWS storage infra.',
  );
  console.log('Use this instead of storage:setup for production runtime/env wiring.');
  console.log('Docs: docs/SCRIPT_COMMAND_MAP.md');
  console.log('');
  console.log('Modes: convex, s3, mirror');
  console.log('Safe to rerun: yes; runtime envs can be refreshed and infra deploys remain opt-in.');
}

function printMissingCliSummary(
  title: string,
  missing: ReadonlyArray<{ cmd: string; hint: string }>,
) {
  if (missing.length === 0) {
    return;
  }

  console.log(`\n${title}`);
  for (const item of missing) {
    console.log(`- ${item.cmd}: ${item.hint}`);
  }
}

function getAwsAuthStatus(region: string) {
  if (!commandOnPath('aws')) {
    return 'cli missing';
  }
  return spawnSync('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      AWS_REGION: region,
    },
  }).status === 0
    ? 'ready'
    : 'run `aws configure` or export AWS credentials';
}

function getNetlifyAuthStatus() {
  if (!commandOnPath('netlify')) {
    return 'cli missing';
  }
  return runNetlify(['status', '--json']).ok ? 'ready' : 'run `netlify login`';
}

async function main() {
  const json = process.argv.includes('--json');
  routeLogsToStderrWhenJson(json);
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }
  const changedLocally: string[] = [];
  const changedRemotely: string[] = [];
  const nextCommands: string[] = [];

  console.log('🚀 Production storage setup\n');
  console.log('This flow configures production runtime env in Convex prod and Netlify.');
  console.log(
    'It also derives the production storage CDK env and can preview/deploy the prod storage stack.\n',
  );
  console.log(
    'Prereqs: Convex prod access; Netlify CLI/site link if you want Netlify env sync; AWS CLI for S3-backed modes.',
  );
  console.log('Modifies: Convex prod env, Netlify env, and optional AWS infra when confirmed.');
  console.log('Safe to rerun: yes; deploy actions remain opt-in.\n');
  const requiredMissing = findMissingCommands([{ cmd: 'pnpm' }]);
  if (requiredMissing.length > 0) {
    printMissingCliSummary('Missing required CLIs', requiredMissing);
    process.exit(1);
  }
  const optionalMissing = findMissingCommands([{ cmd: 'aws' }, { cmd: 'netlify' }]);
  printMissingCliSummary(
    'Optional CLIs you may want before S3 or Netlify-related steps',
    optionalMissing,
  );
  const preflightRegion =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-west-1';
  printStatusSummary('Provider auth status', [
    { label: 'AWS', value: getAwsAuthStatus(preflightRegion) },
    {
      label: 'Netlify',
      value: !commandOnPath('netlify') ? CLI_INSTALL_HINT.netlify : getNetlifyAuthStatus(),
    },
  ]);

  const shouldContinue = await askYesNo('Continue?', true);
  if (!shouldContinue) {
    console.log('Cancelled.');
    return;
  }

  requirePnpmAndConvexCli();

  const storageMode = await chooseStorageMode();
  if (storageMode !== 'convex') {
    requireCommands([{ cmd: 'aws' }]);
  }
  const awsRegion = await askWithDefault(
    'AWS region',
    process.env.AWS_REGION?.trim() || 'us-west-1',
  );
  const awsProfile = await chooseAwsProfile(process.env.AWS_PROFILE?.trim() || null);

  const runtimeEnvVars: Record<string, string> = {
    FILE_STORAGE_BACKEND: storageMode,
  };
  const convexProdEnvVars: Record<string, string> = {
    FILE_STORAGE_BACKEND: storageMode,
  };

  let storageDeployEnv: NodeJS.ProcessEnv | null = null;

  if (storageMode !== 'convex') {
    const bucket = await askWithDefault(
      'AWS S3 files bucket',
      'tanstack-start-template-prod-files-bucket',
    );
    const convexSiteUrl = await askWithDefault('Convex site URL', getDefaultConvexSiteUrl());
    const webhookSecret = await askWithDefault(
      'AWS malware webhook shared secret',
      await generateSecret(32),
    );
    const serveSecret = await askWithDefault(
      'AWS file serve signing secret',
      await generateSecret(32),
    );

    runtimeEnvVars.AWS_REGION = awsRegion;
    runtimeEnvVars.AWS_S3_FILES_BUCKET = bucket;
    runtimeEnvVars.AWS_MALWARE_WEBHOOK_SHARED_SECRET = webhookSecret;
    runtimeEnvVars.AWS_FILE_SERVE_SIGNING_SECRET = serveSecret;
    runtimeEnvVars.CONVEX_SITE_URL = convexSiteUrl;

    convexProdEnvVars.AWS_REGION = awsRegion;
    convexProdEnvVars.AWS_S3_FILES_BUCKET = bucket;
    convexProdEnvVars.AWS_MALWARE_WEBHOOK_SHARED_SECRET = webhookSecret;
    convexProdEnvVars.AWS_FILE_SERVE_SIGNING_SECRET = serveSecret;

    storageDeployEnv = buildStorageDeployEnv({
      awsRegion,
      awsProfile: awsProfile ?? undefined,
      bucket,
      convexSiteUrl,
      webhookSecret,
    });
  }
  printTargetSummary('Provider target summary', [
    `Storage mode: ${storageMode}`,
    `AWS region: ${awsRegion}`,
    `AWS profile: ${awsProfile ?? 'current shell/default'}`,
    `Bucket: ${runtimeEnvVars.AWS_S3_FILES_BUCKET ?? 'n/a'}`,
    `Netlify env sync: linked site required if enabled`,
  ]);

  console.log('\nProduction runtime env values:');
  for (const [name, value] of Object.entries(runtimeEnvVars)) {
    const displayValue = name.includes('SECRET') ? '[generated/set]' : value;
    console.log(`   ${name}=${displayValue}`);
  }

  const setConvex = await askYesNo('\nSet these in Convex production now?', true);
  if (setConvex) {
    try {
      console.log('\n☁️  Setting Convex production env vars...');
      for (const [name, value] of Object.entries(convexProdEnvVars)) {
        convexEnvSet(name, value, true);
      }
      console.log('✅ Convex production env updated.');
      changedRemotely.push('Updated Convex production storage env vars');
    } catch {
      console.log('⚠️  Failed while setting Convex production env vars.');
      console.log('   You can retry manually with `pnpm exec convex env set ... --prod`.');
    }
  }

  const setNetlify = await askYesNo('\nSet these in Netlify now?', true);
  if (setNetlify) {
    requireCommands([{ cmd: 'netlify' }]);
    try {
      console.log('\n🌐 Setting Netlify env vars...');
      for (const [name, value] of Object.entries(runtimeEnvVars)) {
        run(`pnpm exec netlify env:set ${name} "${value}" --context production --force`);
      }
      console.log('✅ Netlify env updated.');
      changedRemotely.push('Updated Netlify production storage env vars');
    } catch {
      console.log('⚠️  Failed while setting Netlify env vars.');
      console.log(
        '   Make sure the site is linked, then retry with `pnpm exec netlify env:set ...`.',
      );
    }
  }

  if (!storageDeployEnv) {
    console.log('\nDone.');
    console.log('No AWS storage infrastructure deployment is required for convex mode.');
    nextCommands.push('pnpm run deploy:doctor -- --prod');
    const finalSummary = { changedLocally, changedRemotely, nextCommands };
    if (json) {
      emitStructuredOutput(finalSummary);
    } else {
      printFinalChangeSummary(finalSummary);
    }
    return;
  }

  console.log('\nDerived storage deploy env for production:');
  console.log(`   AWS_REGION=${storageDeployEnv.AWS_REGION}`);
  if (storageDeployEnv.AWS_PROFILE) {
    console.log(`   AWS_PROFILE=${storageDeployEnv.AWS_PROFILE}`);
  }
  console.log(
    `   AWS_CONVEX_GUARDDUTY_WEBHOOK_URL=${storageDeployEnv.AWS_CONVEX_GUARDDUTY_WEBHOOK_URL}`,
  );
  console.log('   AWS_MALWARE_WEBHOOK_SHARED_SECRET=[set]');
  console.log(`   AWS_S3_FILES_BUCKET_NAME=${storageDeployEnv.AWS_S3_FILES_BUCKET_NAME}`);
  console.log('');

  const awsIdentity = getAwsIdentity(
    String(storageDeployEnv.AWS_REGION),
    storageDeployEnv.AWS_PROFILE ? String(storageDeployEnv.AWS_PROFILE) : undefined,
  );
  if (awsIdentity) {
    console.log('Resolved AWS deploy target:');
    console.log(`   Account=${awsIdentity.accountId ?? '[unknown]'}`);
    console.log(`   ARN=${awsIdentity.arn ?? '[unknown]'}`);
    console.log(`   Region=${awsIdentity.region}`);
    if (storageDeployEnv.AWS_PROFILE) {
      console.log(`   AWS_PROFILE=${storageDeployEnv.AWS_PROFILE}`);
    }
  } else {
    console.log('Could not resolve AWS account with `aws sts get-caller-identity`.');
    console.log('Check your AWS credentials before previewing or deploying.');
  }

  const shouldPreviewInfra = await askYesNo('Run `pnpm storage:preview:prod` now?', false);
  if (shouldPreviewInfra) {
    try {
      run('pnpm storage:preview:prod', storageDeployEnv);
      console.log('✅ CDK preview completed.');
      changedRemotely.push('Ran AWS storage preview (prod)');
    } catch {
      console.log('⚠️  CDK preview failed.');
      console.log('   Check your AWS credentials/bootstrap and retry.');
    }
  }

  const shouldDeployInfra = await askYesNo('Run `pnpm storage:deploy:prod` now?', false);
  if (shouldDeployInfra) {
    try {
      run('pnpm storage:deploy:prod', storageDeployEnv);
      console.log('✅ AWS storage infrastructure deployed.');
      changedRemotely.push('Deployed AWS storage infrastructure (prod)');
    } catch {
      console.log('⚠️  CDK deploy failed.');
      console.log('   Check your AWS credentials/bootstrap and retry.');
    }
  } else {
    console.log('Next steps for AWS-backed modes:');
    console.log(
      '   1. Export the production runtime storage env vars in your shell or CI environment',
    );
    console.log('   2. Run: pnpm storage:preview:prod');
    console.log('   3. Run: pnpm storage:deploy:prod');
    console.log('   4. Or rerun pnpm run storage:setup:prod when you want the guided flow again');
    nextCommands.push('pnpm storage:preview:prod');
    nextCommands.push('pnpm storage:deploy:prod');
  }
  const finalSummary = { changedLocally, changedRemotely, nextCommands };
  if (json) {
    emitStructuredOutput(finalSummary);
  } else {
    printFinalChangeSummary(finalSummary);
  }
}

main().catch((error) => {
  console.error('\n❌ Production storage setup failed');
  console.error(error);
  process.exit(1);
});
