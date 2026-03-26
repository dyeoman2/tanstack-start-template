#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process';
import {
  CLI_INSTALL_HINT,
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { convexEnvSet } from './lib/convex-cli';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { generateSecret } from '../src/lib/server/crypto.server';
import {
  emitStructuredOutput,
  maybeWriteStructuredOutputArtifact,
  printFinalChangeSummary,
  printStatusSummary,
  printTargetSummary,
  routeLogsToStderrWhenJson,
} from './lib/script-ux';
import { deriveConvexSiteUrl } from '../src/lib/convex-url';
import { upsertStructuredEnvValue } from './lib/env-file';
import { getCloudFormationStackOutputs } from './lib/aws-cloudformation';
import {
  buildStorageStackName,
  CONVEX_STORAGE_RUNTIME_ENV_NAMES,
  LEGACY_FORBIDDEN_STORAGE_ENV_NAMES,
  findForbiddenStorageEnvNames,
  STORAGE_STACK_OUTPUT_NAMES,
} from './lib/storage-env-contract';

type StorageMode = 'convex' | 's3-primary' | 's3-mirror';
type AwsIdentity = {
  accountId?: string;
  arn?: string;
  region: string;
};

const DEFAULT_PROJECT_SLUG = 'tanstack-start-template';
const DEFAULT_AUDIT_ARCHIVE_PREFIX = 'audit-ledger/';

function buildAuditArchiveStackName(projectSlug: string) {
  return `${projectSlug}-audit-archive-stack`;
}

function buildAuditArchiveBucketName(projectSlug: string) {
  return `${projectSlug}-audit-archive`;
}

function buildAuditArchiveKmsKeyArn(input: {
  accountId?: string;
  awsRegion: string;
  projectSlug: string;
}) {
  if (!input.accountId) {
    return null;
  }

  return `arn:aws:kms:${input.awsRegion}:${input.accountId}:alias/${input.projectSlug}-audit-archive`;
}

function buildAuditArchiveRoleArn(input: { accountId?: string; projectSlug: string }) {
  if (!input.accountId) {
    return null;
  }

  return `arn:aws:iam::${input.accountId}:role/${input.projectSlug}-audit-archive`;
}

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

async function askRequired(question: string, fallback?: string) {
  while (true) {
    const answer = fallback ? await ask(`${question}: `, fallback) : await ask(`${question}: `);
    const value = (answer || fallback || '').trim();
    if (value) {
      return value;
    }

    console.log('This value is required.');
  }
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

function maybeQuote(value: string) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function trySetConvexEnv(name: string, value: string) {
  convexEnvSet(name, value, false);
}

function buildStorageKmsKeyArn(input: {
  accountId?: string;
  awsRegion: string;
  kind: 'clean' | 'mirror' | 'quarantine' | 'rejected';
  projectSlug: string;
  stage: 'dev' | 'prod';
}) {
  if (!input.accountId) {
    return null;
  }

  return `arn:aws:kms:${input.awsRegion}:${input.accountId}:alias/${input.projectSlug}-${input.stage}-${input.kind}`;
}

function buildScopedBucketNames(bucketBase: string) {
  return {
    clean: `${bucketBase}-clean`,
    mirror: `${bucketBase}-mirror`,
    quarantine: `${bucketBase}-quarantine`,
    rejected: `${bucketBase}-rejected`,
  };
}

function getStorageSetupReadiness(input: {
  brokerAccessKeyId?: string;
  brokerRuntimeUrl?: string;
  storageMode: StorageMode;
  brokerSecretAccessKey?: string;
}) {
  if (input.storageMode === 'convex') {
    return 'ready';
  }

  return input.brokerRuntimeUrl && input.brokerAccessKeyId && input.brokerSecretAccessKey
    ? 'ready'
    : 'needs attention';
}

function getStorageRuntimeUrlWarning(input: {
  brokerAccessKeyId?: string;
  brokerRuntimeUrl?: string;
  storageMode: StorageMode;
  brokerSecretAccessKey?: string;
}) {
  if (input.storageMode === 'convex') {
    return null;
  }

  if (input.brokerRuntimeUrl && input.brokerAccessKeyId && input.brokerSecretAccessKey) {
    return null;
  }

  return 'S3-backed storage is configured locally, but STORAGE_BROKER_URL plus broker access key outputs still need to be discovered from the deployed AWS storage stack or entered manually.';
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

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function buildStorageDeployEnv(input: {
  alertEmailAddress?: string;
  awsRegion: string;
  awsProfile?: string;
  buckets: ReturnType<typeof buildScopedBucketNames>;
  decisionCallbackSharedSecret: string;
  documentResultCallbackSharedSecret: string;
  inspectionCallbackSharedSecret: string;
  convexSiteUrl: string;
  fileServeSigningSecret: string;
}) {
  return {
    AWS_REGION: input.awsRegion,
    ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    ...(input.alertEmailAddress ? { AWS_STORAGE_ALERT_EMAIL: input.alertEmailAddress } : {}),
    CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || input.awsRegion,
    AWS_CONVEX_STORAGE_CALLBACK_BASE_URL: trimTrailingSlashes(input.convexSiteUrl),
    AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET: input.decisionCallbackSharedSecret,
    AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET: input.documentResultCallbackSharedSecret,
    AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET: input.inspectionCallbackSharedSecret,
    AWS_FILE_SERVE_SIGNING_SECRET: input.fileServeSigningSecret,
    AWS_S3_QUARANTINE_BUCKET_NAME: input.buckets.quarantine,
    AWS_S3_CLEAN_BUCKET_NAME: input.buckets.clean,
    AWS_S3_REJECTED_BUCKET_NAME: input.buckets.rejected,
    AWS_S3_MIRROR_BUCKET_NAME: input.buckets.mirror,
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

function assertNoForbiddenStorageEnvVars(envVars: Record<string, string | null | undefined>) {
  const forbidden = findForbiddenStorageEnvNames(envVars);
  if (forbidden.length === 0) {
    return;
  }

  throw new Error(`Remove legacy storage env vars before continuing: ${forbidden.join(', ')}.`);
}

function getStorageStackOutputs(input: { awsProfile?: string; region: string; stackName: string }) {
  return getCloudFormationStackOutputs(input);
}

function writeDirenvFile(input: { awsProfile?: string; awsRegion: string }) {
  const envrcPath = join(process.cwd(), '.envrc');
  const envrcContent = [
    '# Generated by: pnpm run storage:setup',
    '# Repo-local AWS CLI defaults for direnv',
    `export AWS_REGION=${JSON.stringify(input.awsRegion)}`,
    ...(input.awsProfile ? [`export AWS_PROFILE=${JSON.stringify(input.awsProfile)}`] : []),
    '',
  ].join('\n');

  writeFileSync(envrcPath, envrcContent, 'utf8');
  return envrcPath;
}

async function chooseStorageMode(): Promise<StorageMode> {
  console.log('🗂️  Storage mode options:');
  console.log('   1. convex      - default, convex only, no AWS required');
  console.log('   2. s3          - s3 only with GuardDuty malware scanning');
  console.log(
    '   3. mirror      - upload to Convex first, then mirror to S3 with GuardDuty malware scanning',
  );
  console.log('');

  while (true) {
    const answer = (await ask('Choose storage mode [1]: ')) || '1';
    if (answer === '1' || answer === 'convex') return 'convex';
    if (answer === '2' || answer === 's3' || answer === 's3-primary') return 's3-primary';
    if (answer === '3' || answer === 'mirror' || answer === 's3-mirror') return 's3-mirror';
    console.log('Please choose 1, 2, or 3.');
  }
}

function printUsage() {
  console.log('Usage: pnpm run storage:setup [--json]');
  console.log('');
  console.log(
    'What this does: configure local storage mode, optionally sync storage envs to Convex dev, and optionally preview/deploy AWS storage infra.',
  );
  console.log('Use this instead of storage:setup:prod for local/dev storage configuration.');
  console.log('Docs: docs/SCRIPT_COMMAND_MAP.md');
  console.log('');
  console.log('Modes: convex, s3, mirror');
  console.log(
    'Safe to rerun: yes; it updates local/Convex settings and only deploys AWS infra when you confirm.',
  );
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

function getAwsAuthStatus() {
  if (!commandOnPath('aws')) {
    return 'cli missing';
  }
  return spawnSync('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
    stdio: 'ignore',
  }).status === 0
    ? 'ready'
    : 'run `aws configure` or export AWS credentials';
}

function getNetlifyAuthStatus() {
  if (!commandOnPath('netlify')) {
    return 'cli missing';
  }
  return process.env.NETLIFY_AUTH_TOKEN?.trim()
    ? 'token available'
    : 'run `netlify login` if you want Netlify-related automation';
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
  const warnings: string[] = [];

  console.log('🔧 Storage setup\n');
  console.log(
    'What this does: choose a storage mode, update .env.local, optionally sync Convex dev env, and optionally preview/deploy AWS infra.',
  );
  console.log('Prereqs: .env.local; Convex CLI access. AWS CLI only needed for S3-backed modes.');
  console.log(
    'Modifies: .env.local, optional Convex dev env, optional .envrc, optional AWS stacks when confirmed.',
  );
  console.log('Safe to rerun: yes; infrastructure deploys remain opt-in.\n');
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
  printStatusSummary('Provider auth status', [
    { label: 'AWS', value: getAwsAuthStatus() },
    {
      label: 'Netlify',
      value: !commandOnPath('netlify') ? CLI_INSTALL_HINT.netlify : getNetlifyAuthStatus(),
    },
  ]);
  requirePnpmAndConvexCli();

  const cwd = process.cwd();
  const envPath = join(cwd, '.env.local');
  if (!existsSync(envPath)) {
    console.log('❌ .env.local not found.');
    console.log('   Run: pnpm run setup:env');
    process.exit(1);
  }

  let envContent = readEnvFile(envPath);
  assertNoForbiddenStorageEnvVars({
    ...process.env,
    ...Object.fromEntries(
      LEGACY_FORBIDDEN_STORAGE_ENV_NAMES.map((name) => [name, readEnvValue(envContent, name)]),
    ),
  });
  const storageMode = await chooseStorageMode();
  envContent = upsertStructuredEnvValue(envContent, 'FILE_STORAGE_BACKEND', storageMode, {
    sectionMarker: '# STORAGE',
  });

  const convexSiteUrlFallback =
    readEnvValue(envContent, 'CONVEX_SITE_URL') ??
    (readEnvValue(envContent, 'VITE_CONVEX_URL')
      ? deriveConvexSiteUrl(readEnvValue(envContent, 'VITE_CONVEX_URL') as string)
      : null) ??
    'http://127.0.0.1:3210';

  if (storageMode === 'convex') {
    writeFileSync(envPath, envContent, 'utf8');
    changedLocally.push(`Updated ${envPath} with FILE_STORAGE_BACKEND=convex`);
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
        changedRemotely.push('Set Convex dev env FILE_STORAGE_BACKEND=convex');
      } catch {
        console.log('⚠️  Failed to sync Convex env automatically. Set it manually if needed.');
      }
    }
    nextCommands.push('pnpm dev');
    const finalSummary = {
      changedLocally,
      changedRemotely,
      nextCommands,
      readiness: {
        localStorage: 'ready',
      },
      warnings,
    };
    maybeWriteStructuredOutputArtifact(finalSummary);
    if (json) {
      emitStructuredOutput(finalSummary);
    } else {
      printFinalChangeSummary(finalSummary);
    }
    return;
  }

  requireCommands([{ cmd: 'aws' }]);
  const awsRegion = await askWithDefault(
    'AWS region',
    readEnvValue(envContent, 'AWS_REGION') ?? 'us-west-1',
  );
  const awsProfile = await chooseAwsProfile(
    readEnvValue(envContent, 'AWS_PROFILE') ?? process.env.AWS_PROFILE?.trim() ?? null,
  );
  const awsIdentity = getAwsIdentity(awsRegion, awsProfile ?? undefined);
  const storageProjectSlug =
    readEnvValue(envContent, 'AWS_STORAGE_PROJECT_SLUG') ??
    process.env.AWS_STORAGE_PROJECT_SLUG?.trim() ??
    DEFAULT_PROJECT_SLUG;
  const auditArchiveProjectSlug =
    readEnvValue(envContent, 'AWS_AUDIT_ARCHIVE_PROJECT_SLUG') ??
    process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG?.trim() ??
    storageProjectSlug;
  const storageStackName = buildStorageStackName(storageProjectSlug, 'dev');
  const auditArchiveStackName = buildAuditArchiveStackName(auditArchiveProjectSlug);
  const stackOutputs =
    getStorageStackOutputs({
      awsProfile: awsProfile ?? undefined,
      region: awsRegion,
      stackName: storageStackName,
    }) ?? {};
  let auditArchiveOutputs =
    getStorageStackOutputs({
      awsProfile: awsProfile ?? undefined,
      region: awsRegion,
      stackName: auditArchiveStackName,
    }) ?? {};
  const discoveredBrokerRuntimeUrl =
    stackOutputs[STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl] ?? '';
  const discoveredBrokerAccessKeyId =
    stackOutputs[STORAGE_STACK_OUTPUT_NAMES.brokerAccessKeyId] ?? '';
  const discoveredBrokerSecretAccessKey =
    stackOutputs[STORAGE_STACK_OUTPUT_NAMES.brokerSecretAccessKey] ?? '';
  if (
    discoveredBrokerRuntimeUrl ||
    discoveredBrokerAccessKeyId ||
    discoveredBrokerSecretAccessKey
  ) {
    console.log('\nDetected existing storage stack runtime outputs:');
    console.log(
      `   ${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl}=${discoveredBrokerRuntimeUrl || '[missing]'}`,
    );
    console.log(
      `   ${STORAGE_STACK_OUTPUT_NAMES.brokerAccessKeyId}=${discoveredBrokerAccessKeyId || '[missing]'}`,
    );
    console.log('   StorageBrokerSecretAccessKey=[set from CloudFormation output]');
  } else {
    console.log(`\nNo deployed storage stack outputs found yet for ${storageStackName}.`);
  }
  const auditArchiveRuntimeReady = Boolean(
    auditArchiveOutputs.AuditArchiveBucketName &&
    auditArchiveOutputs.AuditArchiveBucketKeyArn &&
    auditArchiveOutputs.AuditArchiveRoleArn,
  );
  if (!auditArchiveRuntimeReady) {
    console.log(`No deployed audit archive stack outputs found yet for ${auditArchiveStackName}.`);
    const shouldRunAuditArchiveSetup = await askYesNo(
      'Run guided audit archive setup now so S3-backed storage has repo-managed archive infrastructure?',
      false,
    );
    if (shouldRunAuditArchiveSetup) {
      try {
        run('pnpm run audit-archive:setup', {
          AWS_REGION: awsRegion,
          ...(awsProfile ? { AWS_PROFILE: awsProfile } : {}),
          ...(awsIdentity?.arn ? { AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: awsIdentity.arn } : {}),
          AWS_AUDIT_ARCHIVE_PROJECT_SLUG: auditArchiveProjectSlug,
        });
        changedRemotely.push('Ran guided audit archive setup (dev)');
        envContent = readEnvFile(envPath);
        auditArchiveOutputs =
          getStorageStackOutputs({
            awsProfile: awsProfile ?? undefined,
            region: awsRegion,
            stackName: auditArchiveStackName,
          }) ?? {};
      } catch {
        console.log('⚠️  Guided audit archive setup did not complete.');
        console.log('   You can rerun `pnpm run audit-archive:setup` later.');
      }
    } else if (!nextCommands.includes('pnpm run audit-archive:setup')) {
      nextCommands.push('pnpm run audit-archive:setup');
    }
  }
  const bucketBase = await askWithDefault(
    'AWS S3 storage bucket base name',
    'tanstack-start-template-dev-storage',
  );
  const buckets = buildScopedBucketNames(bucketBase);
  const quarantineKmsKeyArn = await askRequired(
    'AWS quarantine bucket KMS key ARN or alias ARN',
    readEnvValue(envContent, 'AWS_S3_QUARANTINE_KMS_KEY_ARN') ??
      buildStorageKmsKeyArn({
        accountId: awsIdentity?.accountId,
        awsRegion,
        kind: 'quarantine',
        projectSlug: 'tanstack-start-template',
        stage: 'dev',
      }) ??
      undefined,
  );
  const cleanKmsKeyArn = await askRequired(
    'AWS clean bucket KMS key ARN or alias ARN',
    readEnvValue(envContent, 'AWS_S3_CLEAN_KMS_KEY_ARN') ??
      buildStorageKmsKeyArn({
        accountId: awsIdentity?.accountId,
        awsRegion,
        kind: 'clean',
        projectSlug: 'tanstack-start-template',
        stage: 'dev',
      }) ??
      undefined,
  );
  const rejectedKmsKeyArn = await askRequired(
    'AWS rejected bucket KMS key ARN or alias ARN',
    readEnvValue(envContent, 'AWS_S3_REJECTED_KMS_KEY_ARN') ??
      buildStorageKmsKeyArn({
        accountId: awsIdentity?.accountId,
        awsRegion,
        kind: 'rejected',
        projectSlug: 'tanstack-start-template',
        stage: 'dev',
      }) ??
      undefined,
  );
  const mirrorKmsKeyArn = await askRequired(
    'AWS mirror bucket KMS key ARN or alias ARN',
    readEnvValue(envContent, 'AWS_S3_MIRROR_KMS_KEY_ARN') ??
      buildStorageKmsKeyArn({
        accountId: awsIdentity?.accountId,
        awsRegion,
        kind: 'mirror',
        projectSlug: 'tanstack-start-template',
        stage: 'dev',
      }) ??
      undefined,
  );
  const convexSiteUrl = await askWithDefault('Convex site URL', convexSiteUrlFallback);
  const auditArchiveBucket = await askRequired(
    'AWS audit archive bucket name',
    readEnvValue(envContent, 'AWS_AUDIT_ARCHIVE_BUCKET') ??
      auditArchiveOutputs.AuditArchiveBucketName ??
      buildAuditArchiveBucketName(auditArchiveProjectSlug),
  );
  const auditArchiveKmsKeyArn = await askRequired(
    'AWS audit archive KMS key ARN',
    readEnvValue(envContent, 'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN') ??
      auditArchiveOutputs.AuditArchiveBucketKeyArn ??
      buildAuditArchiveKmsKeyArn({
        accountId: awsIdentity?.accountId,
        awsRegion,
        projectSlug: auditArchiveProjectSlug,
      }) ??
      undefined,
  );
  const auditArchiveRoleArn = await askRequired(
    'AWS audit archive role ARN',
    readEnvValue(envContent, 'AWS_AUDIT_ARCHIVE_ROLE_ARN') ??
      auditArchiveOutputs.AuditArchiveRoleArn ??
      buildAuditArchiveRoleArn({
        accountId: awsIdentity?.accountId,
        projectSlug: auditArchiveProjectSlug,
      }) ??
      undefined,
  );
  const auditArchivePrefix = await askWithDefault(
    'AWS audit archive object prefix',
    readEnvValue(envContent, 'AWS_AUDIT_ARCHIVE_PREFIX') ?? DEFAULT_AUDIT_ARCHIVE_PREFIX,
  );
  const serveSecret = await askWithDefault(
    'AWS file serve signing secret',
    readEnvValue(envContent, 'AWS_FILE_SERVE_SIGNING_SECRET') ?? (await generateSecret(32)),
  );
  const decisionCallbackSharedSecret = await askWithDefault(
    'Convex storage decision callback shared secret',
    readEnvValue(envContent, 'CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET') ??
      // Legacy fallback for older shared-secret deployments.
      readEnvValue(envContent, 'AWS_CONVEX_STORAGE_CALLBACK_SHARED_SECRET') ??
      (await generateSecret(32)),
  );
  const documentResultCallbackSharedSecret = await askWithDefault(
    'Convex document result callback shared secret',
    readEnvValue(envContent, 'CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET') ??
      (await generateSecret(32)),
  );
  const inspectionCallbackSharedSecret = await askWithDefault(
    'Convex storage inspection callback shared secret',
    readEnvValue(envContent, 'CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET') ??
      // Legacy fallback for older inspection-webhook deployments.
      readEnvValue(envContent, 'AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET') ??
      (await generateSecret(32)),
  );
  let brokerRuntimeUrl = (
    await ask(
      'Storage broker runtime URL (leave empty until after infra deploy): ',
      discoveredBrokerRuntimeUrl || readEnvValue(envContent, 'STORAGE_BROKER_URL') || undefined,
    )
  ).trim();
  let brokerAccessKeyId = (
    await ask(
      'Storage broker access key id (leave empty until after infra deploy): ',
      discoveredBrokerAccessKeyId ||
        readEnvValue(envContent, 'STORAGE_BROKER_ACCESS_KEY_ID') ||
        undefined,
    )
  ).trim();
  let brokerSecretAccessKey = (
    await ask(
      'Storage broker secret access key (leave empty until after infra deploy): ',
      discoveredBrokerSecretAccessKey ||
        readEnvValue(envContent, 'STORAGE_BROKER_SECRET_ACCESS_KEY') ||
        undefined,
    )
  ).trim();
  const brokerSessionToken = (
    await ask(
      'Storage broker session token (optional, leave empty for long-lived access keys): ',
      readEnvValue(envContent, 'STORAGE_BROKER_SESSION_TOKEN') || undefined,
    )
  ).trim();
  const alertEmailAddress = (
    await ask(
      'AWS storage alert email (leave empty to disable prod SNS email alerts): ',
      readEnvValue(envContent, 'AWS_STORAGE_ALERT_EMAIL') ?? undefined,
    )
  ).trim();

  envContent = upsertStructuredEnvValue(envContent, 'AWS_REGION', awsRegion, {
    sectionMarker: '# STORAGE',
  });
  if (awsProfile) {
    envContent = upsertStructuredEnvValue(envContent, 'AWS_PROFILE', awsProfile, {
      sectionMarker: '# STORAGE',
    });
  }
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_S3_QUARANTINE_BUCKET',
    buckets.quarantine,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(envContent, 'AWS_S3_CLEAN_BUCKET', buckets.clean, {
    sectionMarker: '# STORAGE',
  });
  envContent = upsertStructuredEnvValue(envContent, 'AWS_S3_REJECTED_BUCKET', buckets.rejected, {
    sectionMarker: '# STORAGE',
  });
  envContent = upsertStructuredEnvValue(envContent, 'AWS_S3_MIRROR_BUCKET', buckets.mirror, {
    sectionMarker: '# STORAGE',
  });
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_S3_QUARANTINE_KMS_KEY_ARN',
    quarantineKmsKeyArn,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(envContent, 'AWS_S3_CLEAN_KMS_KEY_ARN', cleanKmsKeyArn, {
    sectionMarker: '# STORAGE',
  });
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_S3_REJECTED_KMS_KEY_ARN',
    rejectedKmsKeyArn,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(envContent, 'AWS_S3_MIRROR_KMS_KEY_ARN', mirrorKmsKeyArn, {
    sectionMarker: '# STORAGE',
  });
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_FILE_SERVE_SIGNING_SECRET',
    maybeQuote(serveSecret),
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(envContent, 'CONVEX_SITE_URL', convexSiteUrl, {
    sectionMarker: '# STORAGE',
  });
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_AUDIT_ARCHIVE_BUCKET',
    auditArchiveBucket,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN',
    auditArchiveKmsKeyArn,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_AUDIT_ARCHIVE_ROLE_ARN',
    auditArchiveRoleArn,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(
    envContent,
    'AWS_AUDIT_ARCHIVE_PREFIX',
    auditArchivePrefix,
    {
      sectionMarker: '# STORAGE',
    },
  );
  envContent = upsertStructuredEnvValue(
    envContent,
    'CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET',
    maybeQuote(decisionCallbackSharedSecret),
    { sectionMarker: '# STORAGE' },
  );
  envContent = upsertStructuredEnvValue(
    envContent,
    'CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET',
    maybeQuote(documentResultCallbackSharedSecret),
    { sectionMarker: '# STORAGE' },
  );
  envContent = upsertStructuredEnvValue(
    envContent,
    'CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET',
    maybeQuote(inspectionCallbackSharedSecret),
    { sectionMarker: '# STORAGE' },
  );
  if (brokerRuntimeUrl) {
    envContent = upsertStructuredEnvValue(envContent, 'STORAGE_BROKER_URL', brokerRuntimeUrl, {
      sectionMarker: '# STORAGE',
    });
  }
  if (brokerAccessKeyId) {
    envContent = upsertStructuredEnvValue(
      envContent,
      'STORAGE_BROKER_ACCESS_KEY_ID',
      maybeQuote(brokerAccessKeyId),
      {
        sectionMarker: '# STORAGE',
      },
    );
  }
  if (brokerSecretAccessKey) {
    envContent = upsertStructuredEnvValue(
      envContent,
      'STORAGE_BROKER_SECRET_ACCESS_KEY',
      maybeQuote(brokerSecretAccessKey),
      {
        sectionMarker: '# STORAGE',
      },
    );
  }
  if (brokerSessionToken) {
    envContent = upsertStructuredEnvValue(
      envContent,
      'STORAGE_BROKER_SESSION_TOKEN',
      maybeQuote(brokerSessionToken),
      {
        sectionMarker: '# STORAGE',
      },
    );
  }
  if (!brokerSessionToken && readEnvValue(envContent, 'STORAGE_BROKER_SESSION_TOKEN')) {
    envContent = upsertStructuredEnvValue(envContent, 'STORAGE_BROKER_SESSION_TOKEN', '', {
      sectionMarker: '# STORAGE',
    });
  }
  if (alertEmailAddress) {
    envContent = upsertStructuredEnvValue(
      envContent,
      'AWS_STORAGE_ALERT_EMAIL',
      alertEmailAddress,
      {
        sectionMarker: '# STORAGE',
      },
    );
  }

  writeFileSync(envPath, envContent, 'utf8');
  changedLocally.push(`Updated ${envPath} with storage env for ${storageMode}`);

  console.log(`\n✅ Storage configured for ${storageMode}.`);
  console.log(`   Updated: ${envPath}`);
  console.log('');
  console.log('Storage env written locally:');
  console.log(`   FILE_STORAGE_BACKEND=${storageMode}`);
  console.log(`   AWS_REGION=${awsRegion}`);
  if (awsProfile) {
    console.log(`   AWS_PROFILE=${awsProfile}`);
  }
  console.log(`   AWS_S3_QUARANTINE_BUCKET=${buckets.quarantine}`);
  console.log(`   AWS_S3_CLEAN_BUCKET=${buckets.clean}`);
  console.log(`   AWS_S3_REJECTED_BUCKET=${buckets.rejected}`);
  console.log(`   AWS_S3_MIRROR_BUCKET=${buckets.mirror}`);
  console.log(`   AWS_S3_QUARANTINE_KMS_KEY_ARN=${quarantineKmsKeyArn}`);
  console.log(`   AWS_S3_CLEAN_KMS_KEY_ARN=${cleanKmsKeyArn}`);
  console.log(`   AWS_S3_REJECTED_KMS_KEY_ARN=${rejectedKmsKeyArn}`);
  console.log(`   AWS_S3_MIRROR_KMS_KEY_ARN=${mirrorKmsKeyArn}`);
  console.log(`   AWS_AUDIT_ARCHIVE_BUCKET=${auditArchiveBucket}`);
  console.log(`   AWS_AUDIT_ARCHIVE_KMS_KEY_ARN=${auditArchiveKmsKeyArn}`);
  console.log(`   AWS_AUDIT_ARCHIVE_ROLE_ARN=${auditArchiveRoleArn}`);
  console.log(`   AWS_AUDIT_ARCHIVE_PREFIX=${auditArchivePrefix}`);
  console.log('   AWS_FILE_SERVE_SIGNING_SECRET=[set]');
  console.log('   CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET=[set]');
  console.log('   CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET=[set]');
  console.log('   CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET=[set]');
  if (brokerRuntimeUrl) {
    console.log(`   STORAGE_BROKER_URL=${brokerRuntimeUrl}`);
  }
  if (brokerAccessKeyId) {
    console.log('   STORAGE_BROKER_ACCESS_KEY_ID=[set]');
  }
  if (brokerSecretAccessKey) {
    console.log('   STORAGE_BROKER_SECRET_ACCESS_KEY=[set]');
  }
  if (brokerSessionToken) {
    console.log('   STORAGE_BROKER_SESSION_TOKEN=[set]');
  }
  if (alertEmailAddress) {
    console.log(`   AWS_STORAGE_ALERT_EMAIL=${alertEmailAddress}`);
  }
  console.log(`   CONVEX_SITE_URL=${convexSiteUrl}`);
  console.log('');
  console.log(
    'Syncing to Convex will set the storage vars there; CONVEX_SITE_URL remains local because Convex provides it as a built-in env var.',
  );
  printTargetSummary('Provider target summary', [
    `AWS region: ${awsRegion}`,
    `AWS profile: ${awsProfile ?? 'current shell/default'}`,
    `Storage stack: ${storageStackName}`,
    `Quarantine bucket: ${buckets.quarantine}`,
    `Audit archive bucket: ${auditArchiveBucket}`,
    `Alert email: ${alertEmailAddress || 'disabled'}`,
    `Convex site URL: ${convexSiteUrl}`,
  ]);
  const storageDeployEnv = buildStorageDeployEnv({
    awsRegion,
    awsProfile: awsProfile ?? undefined,
    buckets,
    decisionCallbackSharedSecret,
    documentResultCallbackSharedSecret,
    inspectionCallbackSharedSecret,
    convexSiteUrl,
    fileServeSigningSecret: serveSecret,
    alertEmailAddress: alertEmailAddress || undefined,
  });

  console.log('Derived storage deploy env for this local setup:');
  console.log(`   AWS_REGION=${storageDeployEnv.AWS_REGION}`);
  if (storageDeployEnv.AWS_PROFILE) {
    console.log(`   AWS_PROFILE=${storageDeployEnv.AWS_PROFILE}`);
  }
  console.log(
    `   AWS_CONVEX_STORAGE_CALLBACK_BASE_URL=${storageDeployEnv.AWS_CONVEX_STORAGE_CALLBACK_BASE_URL}`,
  );
  console.log('   AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET=[set]');
  console.log('   AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET=[set]');
  console.log('   AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET=[set]');
  console.log('   AWS_FILE_SERVE_SIGNING_SECRET=[set]');
  if (storageDeployEnv.AWS_STORAGE_ALERT_EMAIL) {
    console.log(`   AWS_STORAGE_ALERT_EMAIL=${storageDeployEnv.AWS_STORAGE_ALERT_EMAIL}`);
  }
  console.log(`   AWS_S3_QUARANTINE_BUCKET_NAME=${storageDeployEnv.AWS_S3_QUARANTINE_BUCKET_NAME}`);
  console.log(`   AWS_S3_CLEAN_BUCKET_NAME=${storageDeployEnv.AWS_S3_CLEAN_BUCKET_NAME}`);
  console.log(`   AWS_S3_REJECTED_BUCKET_NAME=${storageDeployEnv.AWS_S3_REJECTED_BUCKET_NAME}`);
  console.log(`   AWS_S3_MIRROR_BUCKET_NAME=${storageDeployEnv.AWS_S3_MIRROR_BUCKET_NAME}`);
  console.log('');

  const envrcPath = writeDirenvFile({
    awsProfile: awsProfile ?? undefined,
    awsRegion: awsRegion,
  });
  console.log(`Wrote repo-local direnv file: ${envrcPath}`);
  console.log(
    'If you use direnv, run `direnv allow` so plain `aws ...` commands in this repo use the same profile.',
  );
  console.log('');

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

  const shouldPreviewInfra = await askYesNo('Run `pnpm storage:preview:dev` now?', false);
  if (shouldPreviewInfra) {
    try {
      run('pnpm storage:preview:dev', storageDeployEnv);
      console.log('✅ CDK preview completed.');
      changedRemotely.push('Ran AWS storage preview (dev)');
    } catch {
      console.log('⚠️  CDK preview failed.');
      console.log('   Check your AWS credentials/bootstrap and retry.');
    }
  }

  const shouldDeployInfra = await askYesNo('Run `pnpm storage:deploy:dev` now?', false);
  if (shouldDeployInfra) {
    try {
      run('pnpm storage:deploy:dev', storageDeployEnv);
      console.log('✅ AWS storage infrastructure deployed.');
      changedRemotely.push('Deployed AWS storage infrastructure (dev)');
      const outputs =
        getStorageStackOutputs({
          awsProfile: awsProfile ?? undefined,
          region: awsRegion,
          stackName: storageStackName,
        }) ?? {};
      const nextBrokerRuntimeUrl = outputs?.[STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl] ?? '';
      const nextBrokerAccessKeyId = outputs?.[STORAGE_STACK_OUTPUT_NAMES.brokerAccessKeyId] ?? '';
      const nextBrokerSecretAccessKey =
        outputs?.[STORAGE_STACK_OUTPUT_NAMES.brokerSecretAccessKey] ?? '';
      if (nextBrokerRuntimeUrl && nextBrokerAccessKeyId && nextBrokerSecretAccessKey) {
        brokerRuntimeUrl = nextBrokerRuntimeUrl;
        brokerAccessKeyId = nextBrokerAccessKeyId;
        brokerSecretAccessKey = nextBrokerSecretAccessKey;
        envContent = upsertStructuredEnvValue(envContent, 'STORAGE_BROKER_URL', brokerRuntimeUrl, {
          sectionMarker: '# STORAGE',
        });
        envContent = upsertStructuredEnvValue(
          envContent,
          'STORAGE_BROKER_ACCESS_KEY_ID',
          maybeQuote(brokerAccessKeyId),
          { sectionMarker: '# STORAGE' },
        );
        envContent = upsertStructuredEnvValue(
          envContent,
          'STORAGE_BROKER_SECRET_ACCESS_KEY',
          maybeQuote(brokerSecretAccessKey),
          { sectionMarker: '# STORAGE' },
        );
        writeFileSync(envPath, envContent, 'utf8');
        changedLocally.push(`Updated ${envPath} with deployed storage broker outputs`);
        console.log(`   ${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl}=${brokerRuntimeUrl}`);
        console.log('   StorageBrokerAccessKeyId=[set]');
        console.log('   StorageBrokerSecretAccessKey=[set]');
      }
    } catch {
      console.log('⚠️  CDK deploy failed.');
      console.log('   Check your AWS credentials/bootstrap and retry.');
    }
  } else {
    console.log('Next steps for AWS-backed modes:');
    console.log('   1. Your local runtime storage env is already saved in .env.local');
    console.log('   2. Run: pnpm storage:preview:dev');
    console.log('   3. Run: pnpm storage:deploy:dev');
    nextCommands.push('pnpm storage:preview:dev');
    nextCommands.push('pnpm storage:deploy:dev');
  }

  const syncConvex = await askYesNo('Sync these storage env vars into Convex now?', true);
  if (!syncConvex) {
    console.log('');
    console.log('Set these manually in Convex when ready:');
    for (const [name, value] of Object.entries({
      FILE_STORAGE_BACKEND: storageMode,
      AWS_REGION: awsRegion,
      AWS_S3_QUARANTINE_BUCKET: buckets.quarantine,
      AWS_S3_CLEAN_BUCKET: buckets.clean,
      AWS_S3_REJECTED_BUCKET: buckets.rejected,
      AWS_S3_MIRROR_BUCKET: buckets.mirror,
      AWS_S3_QUARANTINE_KMS_KEY_ARN: quarantineKmsKeyArn,
      AWS_S3_CLEAN_KMS_KEY_ARN: cleanKmsKeyArn,
      AWS_S3_REJECTED_KMS_KEY_ARN: rejectedKmsKeyArn,
      AWS_S3_MIRROR_KMS_KEY_ARN: mirrorKmsKeyArn,
      AWS_AUDIT_ARCHIVE_BUCKET: auditArchiveBucket,
      AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: auditArchiveKmsKeyArn,
      AWS_AUDIT_ARCHIVE_ROLE_ARN: auditArchiveRoleArn,
      AWS_AUDIT_ARCHIVE_PREFIX: auditArchivePrefix,
      AWS_FILE_SERVE_SIGNING_SECRET: '<secret>',
      STORAGE_BROKER_URL: brokerRuntimeUrl || `<${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl}>`,
      STORAGE_BROKER_ACCESS_KEY_ID:
        brokerAccessKeyId || `<${STORAGE_STACK_OUTPUT_NAMES.brokerAccessKeyId}>`,
      STORAGE_BROKER_SECRET_ACCESS_KEY:
        brokerSecretAccessKey || `<${STORAGE_STACK_OUTPUT_NAMES.brokerSecretAccessKey}>`,
      CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET: '<secret>',
      CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET: '<secret>',
      CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET: '<secret>',
    })) {
      console.log(`   pnpm exec convex env set ${name} "${value}"`);
    }
  } else if (!brokerRuntimeUrl || !brokerAccessKeyId || !brokerSecretAccessKey) {
    console.log(
      '\n⚠️  Skipping Convex env sync because broker URL or broker access key outputs are still missing.',
    );
    console.log(
      `   Deploy the storage stack or fetch ${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl}, ${STORAGE_STACK_OUTPUT_NAMES.brokerAccessKeyId}, and ${STORAGE_STACK_OUTPUT_NAMES.brokerSecretAccessKey} from the deployed stack, then rerun this script or set the Convex env vars manually.`,
    );
  } else {
    try {
      const convexEnvValues: Record<string, string> = {
        FILE_STORAGE_BACKEND: storageMode,
        AWS_REGION: awsRegion,
        AWS_S3_QUARANTINE_BUCKET: buckets.quarantine,
        AWS_S3_CLEAN_BUCKET: buckets.clean,
        AWS_S3_REJECTED_BUCKET: buckets.rejected,
        AWS_S3_MIRROR_BUCKET: buckets.mirror,
        AWS_S3_QUARANTINE_KMS_KEY_ARN: quarantineKmsKeyArn,
        AWS_S3_CLEAN_KMS_KEY_ARN: cleanKmsKeyArn,
        AWS_S3_REJECTED_KMS_KEY_ARN: rejectedKmsKeyArn,
        AWS_S3_MIRROR_KMS_KEY_ARN: mirrorKmsKeyArn,
        AWS_AUDIT_ARCHIVE_BUCKET: auditArchiveBucket,
        AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: auditArchiveKmsKeyArn,
        AWS_AUDIT_ARCHIVE_ROLE_ARN: auditArchiveRoleArn,
        AWS_AUDIT_ARCHIVE_PREFIX: auditArchivePrefix,
        AWS_FILE_SERVE_SIGNING_SECRET: serveSecret,
        STORAGE_BROKER_URL: brokerRuntimeUrl,
        STORAGE_BROKER_ACCESS_KEY_ID: brokerAccessKeyId,
        STORAGE_BROKER_SECRET_ACCESS_KEY: brokerSecretAccessKey,
        CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET: decisionCallbackSharedSecret,
        CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET: documentResultCallbackSharedSecret,
        CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET: inspectionCallbackSharedSecret,
      };
      if (brokerSessionToken) {
        convexEnvValues.STORAGE_BROKER_SESSION_TOKEN = brokerSessionToken;
      }

      for (const name of CONVEX_STORAGE_RUNTIME_ENV_NAMES) {
        trySetConvexEnv(name, convexEnvValues[name]);
      }
      for (const [name, value] of Object.entries({
        AWS_AUDIT_ARCHIVE_BUCKET: auditArchiveBucket,
        AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: auditArchiveKmsKeyArn,
        AWS_AUDIT_ARCHIVE_ROLE_ARN: auditArchiveRoleArn,
        AWS_AUDIT_ARCHIVE_PREFIX: auditArchivePrefix,
      })) {
        trySetConvexEnv(name, value);
      }
      console.log('\n✅ Convex env synced.');
      changedRemotely.push(
        'Updated Convex dev env for storage backend/AWS and audit archive settings',
      );
    } catch {
      console.log('\n⚠️  Automatic Convex env sync failed.');
      console.log(
        '   Your .env.local is configured, but you still need to set the storage and audit archive env vars in Convex.',
      );
    }
  }

  const storageRuntimeWarning = getStorageRuntimeUrlWarning({
    brokerAccessKeyId,
    brokerRuntimeUrl,
    brokerSecretAccessKey,
    storageMode,
  });
  if (storageRuntimeWarning) {
    warnings.push(storageRuntimeWarning);
    if (!nextCommands.includes('pnpm run storage:setup')) {
      nextCommands.push('pnpm run storage:setup');
    }
  }

  const finalSummary = {
    changedLocally,
    changedRemotely,
    nextCommands,
    readiness: {
      awsInfra: shouldDeployInfra ? 'deploy attempted' : 'pending deploy',
      convexEnv:
        brokerRuntimeUrl && brokerAccessKeyId && brokerSecretAccessKey
          ? 'ready'
          : 'needs attention',
      localStorage: getStorageSetupReadiness({
        brokerAccessKeyId,
        brokerRuntimeUrl,
        brokerSecretAccessKey,
        storageMode,
      }),
    },
    warnings,
  };
  maybeWriteStructuredOutputArtifact(finalSummary);
  if (json) {
    emitStructuredOutput(finalSummary);
  } else {
    printFinalChangeSummary(finalSummary);
  }
}

main().catch((error) => {
  console.error('\n❌ Storage setup failed');
  console.error(error);
  process.exit(1);
});
