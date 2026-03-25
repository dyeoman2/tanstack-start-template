#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveConvexSiteUrl } from '../src/lib/convex-url';
import {
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { convexEnvSet } from './lib/convex-cli';
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
import { getCloudFormationStackOutputs } from './lib/aws-cloudformation';
import {
  buildStorageStackName,
  findForbiddenStorageEnvNames,
  STORAGE_OPERATOR_DEPLOY_ENV_NAMES,
  STORAGE_STACK_OUTPUT_NAMES,
} from './lib/storage-env-contract';

type StorageMode = 'convex' | 's3-primary' | 's3-mirror';
type AwsIdentity = {
  accountId?: string;
  arn?: string;
  region: string;
};

const PROD_ENV_FILE = '.env.prod';
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

function buildStorageDeployEnv(input: {
  alertEmailAddress?: string;
  awsRegion: string;
  awsProfile?: string;
  buckets: {
    clean: string;
    mirror: string;
    quarantine: string;
    rejected: string;
  };
  convexCallbackSharedSecret: string;
  convexSiteUrl: string;
  fileServeSigningSecret: string;
  brokerSharedSecret: string;
  guardDutyWebhookSecret: string;
  inspectionWebhookSecret: string;
  workerSharedSecret: string;
}) {
  return {
    AWS_REGION: input.awsRegion,
    ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    ...(input.alertEmailAddress ? { AWS_STORAGE_ALERT_EMAIL: input.alertEmailAddress } : {}),
    CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || input.awsRegion,
    AWS_CONVEX_STORAGE_CALLBACK_BASE_URL: trimTrailingSlashes(input.convexSiteUrl),
    AWS_CONVEX_STORAGE_CALLBACK_SHARED_SECRET: input.convexCallbackSharedSecret,
    AWS_FILE_SERVE_SIGNING_SECRET: input.fileServeSigningSecret,
    AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET: input.guardDutyWebhookSecret,
    AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET: input.inspectionWebhookSecret,
    AWS_STORAGE_BROKER_SHARED_SECRET: input.brokerSharedSecret,
    AWS_STORAGE_WORKER_SHARED_SECRET: input.workerSharedSecret,
    AWS_S3_QUARANTINE_BUCKET_NAME: input.buckets.quarantine,
    AWS_S3_CLEAN_BUCKET_NAME: input.buckets.clean,
    AWS_S3_REJECTED_BUCKET_NAME: input.buckets.rejected,
    AWS_S3_MIRROR_BUCKET_NAME: input.buckets.mirror,
  } satisfies Partial<Record<(typeof STORAGE_OPERATOR_DEPLOY_ENV_NAMES)[number], string>> &
    Record<
      Exclude<(typeof STORAGE_OPERATOR_DEPLOY_ENV_NAMES)[number], 'AWS_STORAGE_ALERT_EMAIL'>,
      string
    >;
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

function formatEnvValue(value: string) {
  if (/^[A-Za-z0-9._:/@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildManualConvexEnvSetCommand(name: string, value: string) {
  if (name.includes('SECRET')) {
    return `printf '%s' ${shellSingleQuote(value)} | pnpm exec convex env set ${name} --prod`;
  }

  return `pnpm exec convex env set ${name} ${shellSingleQuote(value)} --prod`;
}

function writeProdEnvFile(values: Record<string, string>) {
  const lines = [
    '# Production operator environment',
    '# Generated by: pnpm run storage:setup:prod',
    `# Generated on: ${new Date().toISOString()}`,
    '',
    ...Object.entries(values).map(([name, value]) => `${name}=${formatEnvValue(value)}`),
    '',
  ];
  const filePath = path.join(process.cwd(), PROD_ENV_FILE);
  writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
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

function getStorageSetupReadiness(input: {
  brokerRuntimeUrl?: string;
  storageMode: StorageMode;
  workerRuntimeUrl?: string;
}) {
  if (input.storageMode === 'convex') {
    return 'ready';
  }

  return input.brokerRuntimeUrl && input.workerRuntimeUrl ? 'ready' : 'needs attention';
}

function getStorageRuntimeUrlWarning(input: {
  brokerRuntimeUrl?: string;
  storageMode: StorageMode;
  workerRuntimeUrl?: string;
}) {
  if (input.storageMode === 'convex') {
    return null;
  }

  if (input.brokerRuntimeUrl && input.workerRuntimeUrl) {
    return null;
  }

  return 'Production S3-backed storage is configured, but STORAGE_BROKER_URL and STORAGE_WORKER_URL are still missing. Deploy the storage stack or rediscover the CloudFormation outputs before treating production storage as ready.';
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
    'What this does: configure production storage runtime vars in Convex and optionally preview/deploy production AWS storage infra.',
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

  console.log('🚀 Production storage setup\n');
  console.log('This flow configures production storage runtime env in Convex prod.');
  console.log(
    'It also derives the production storage CDK env and can preview/deploy the prod storage stack.\n',
  );
  console.log('Prereqs: Convex prod access; AWS CLI for S3-backed modes.');
  console.log(
    'Modifies: Convex prod env, local operator env, and optional AWS infra when confirmed.',
  );
  console.log('Safe to rerun: yes; deploy actions remain opt-in.\n');
  const requiredMissing = findMissingCommands([{ cmd: 'pnpm' }]);
  if (requiredMissing.length > 0) {
    printMissingCliSummary('Missing required CLIs', requiredMissing);
    process.exit(1);
  }
  const optionalMissing = findMissingCommands([{ cmd: 'aws' }]);
  printMissingCliSummary('Optional CLIs you may want before S3-related steps', optionalMissing);
  const preflightRegion =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-west-1';
  printStatusSummary('Provider auth status', [
    { label: 'AWS', value: getAwsAuthStatus(preflightRegion) },
  ]);

  const shouldContinue = await askYesNo('Continue?', true);
  if (!shouldContinue) {
    console.log('Cancelled.');
    return;
  }

  requirePnpmAndConvexCli();
  assertNoForbiddenStorageEnvVars(process.env);

  const storageMode = await chooseStorageMode();
  if (storageMode !== 'convex') {
    requireCommands([{ cmd: 'aws' }]);
  }
  const awsRegion = await askWithDefault(
    'AWS region',
    process.env.AWS_REGION?.trim() || 'us-west-1',
  );
  const awsProfile = await chooseAwsProfile(process.env.AWS_PROFILE?.trim() || null);
  const awsIdentity =
    storageMode === 'convex' ? null : getAwsIdentity(awsRegion, awsProfile ?? undefined);
  const storageProjectSlug =
    process.env.AWS_STORAGE_PROJECT_SLUG?.trim() || 'tanstack-start-template';
  const auditArchiveProjectSlug =
    process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG?.trim() || storageProjectSlug;
  const storageStackName = buildStorageStackName(storageProjectSlug, 'prod');
  const auditArchiveStackName = buildAuditArchiveStackName(auditArchiveProjectSlug);
  const stackOutputs =
    storageMode === 'convex'
      ? null
      : getStorageStackOutputs({
          awsProfile: awsProfile ?? undefined,
          region: awsRegion,
          stackName: storageStackName,
        });
  let auditArchiveOutputs =
    storageMode === 'convex'
      ? null
      : getStorageStackOutputs({
          awsProfile: awsProfile ?? undefined,
          region: awsRegion,
          stackName: auditArchiveStackName,
        });
  const discoveredBrokerRuntimeUrl =
    stackOutputs?.[STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl]?.trim() || '';
  const discoveredWorkerRuntimeUrl =
    stackOutputs?.[STORAGE_STACK_OUTPUT_NAMES.workerRuntimeUrl]?.trim() || '';
  if (storageMode !== 'convex') {
    if (discoveredBrokerRuntimeUrl || discoveredWorkerRuntimeUrl) {
      console.log('\nDetected existing storage stack runtime outputs:');
      console.log(
        `   ${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl}=${discoveredBrokerRuntimeUrl || '[missing]'}`,
      );
      console.log(
        `   ${STORAGE_STACK_OUTPUT_NAMES.workerRuntimeUrl}=${discoveredWorkerRuntimeUrl || '[missing]'}`,
      );
    } else {
      console.log(`\nNo deployed storage stack outputs found yet for ${storageStackName}.`);
    }
  }

  const operatorEnvVars: Record<string, string> = {};
  const convexProdEnvVars: Record<string, string> = {
    FILE_STORAGE_BACKEND: storageMode,
  };

  let storageDeployEnv: NodeJS.ProcessEnv | null = null;

  if (storageMode !== 'convex') {
    const auditArchiveRuntimeReady = Boolean(
      auditArchiveOutputs?.AuditArchiveBucketName?.trim() &&
      auditArchiveOutputs?.AuditArchiveBucketKeyArn?.trim() &&
      auditArchiveOutputs?.AuditArchiveRoleArn?.trim(),
    );
    if (!auditArchiveRuntimeReady) {
      console.log(
        `No deployed audit archive stack outputs found yet for ${auditArchiveStackName}.`,
      );
      const shouldRunAuditArchiveSetup = await askYesNo(
        'Run guided audit archive setup now so S3-backed production storage has repo-managed archive infrastructure?',
        false,
      );
      if (shouldRunAuditArchiveSetup) {
        try {
          run('pnpm run audit-archive:setup -- --prod', {
            AWS_REGION: awsRegion,
            ...(awsProfile ? { AWS_PROFILE: awsProfile } : {}),
            ...(awsIdentity?.arn
              ? { AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: awsIdentity.arn }
              : {}),
            AWS_AUDIT_ARCHIVE_PROJECT_SLUG: auditArchiveProjectSlug,
          });
          changedRemotely.push('Ran guided audit archive setup (prod)');
          auditArchiveOutputs =
            getStorageStackOutputs({
              awsProfile: awsProfile ?? undefined,
              region: awsRegion,
              stackName: auditArchiveStackName,
            }) ?? null;
        } catch {
          console.log('⚠️  Guided audit archive setup did not complete.');
          console.log('   You can rerun `pnpm run audit-archive:setup -- --prod` later.');
        }
      } else if (!nextCommands.includes('pnpm run audit-archive:setup -- --prod')) {
        nextCommands.push('pnpm run audit-archive:setup -- --prod');
      }
    }

    const bucketBase = await askWithDefault(
      'AWS S3 storage bucket base name',
      'tanstack-start-template-prod-storage',
    );
    const buckets = buildScopedBucketNames(bucketBase);
    const quarantineKmsKeyArn = await askRequired(
      'AWS quarantine bucket KMS key ARN or alias ARN',
      process.env.AWS_S3_QUARANTINE_KMS_KEY_ARN?.trim() ||
        buildStorageKmsKeyArn({
          accountId: awsIdentity?.accountId,
          awsRegion,
          kind: 'quarantine',
          projectSlug: 'tanstack-start-template',
          stage: 'prod',
        }) ||
        undefined,
    );
    const cleanKmsKeyArn = await askRequired(
      'AWS clean bucket KMS key ARN or alias ARN',
      process.env.AWS_S3_CLEAN_KMS_KEY_ARN?.trim() ||
        buildStorageKmsKeyArn({
          accountId: awsIdentity?.accountId,
          awsRegion,
          kind: 'clean',
          projectSlug: 'tanstack-start-template',
          stage: 'prod',
        }) ||
        undefined,
    );
    const rejectedKmsKeyArn = await askRequired(
      'AWS rejected bucket KMS key ARN or alias ARN',
      process.env.AWS_S3_REJECTED_KMS_KEY_ARN?.trim() ||
        buildStorageKmsKeyArn({
          accountId: awsIdentity?.accountId,
          awsRegion,
          kind: 'rejected',
          projectSlug: 'tanstack-start-template',
          stage: 'prod',
        }) ||
        undefined,
    );
    const mirrorKmsKeyArn = await askRequired(
      'AWS mirror bucket KMS key ARN or alias ARN',
      process.env.AWS_S3_MIRROR_KMS_KEY_ARN?.trim() ||
        buildStorageKmsKeyArn({
          accountId: awsIdentity?.accountId,
          awsRegion,
          kind: 'mirror',
          projectSlug: 'tanstack-start-template',
          stage: 'prod',
        }) ||
        undefined,
    );
    const convexSiteUrl = await askWithDefault('Convex site URL', getDefaultConvexSiteUrl());
    const auditArchiveBucket = await askRequired(
      'AWS audit archive bucket name',
      process.env.AWS_AUDIT_ARCHIVE_BUCKET?.trim() ||
        auditArchiveOutputs?.AuditArchiveBucketName?.trim() ||
        buildAuditArchiveBucketName(auditArchiveProjectSlug),
    );
    const auditArchiveKmsKeyArn = await askRequired(
      'AWS audit archive KMS key ARN',
      process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN?.trim() ||
        auditArchiveOutputs?.AuditArchiveBucketKeyArn?.trim() ||
        buildAuditArchiveKmsKeyArn({
          accountId: awsIdentity?.accountId,
          awsRegion,
          projectSlug: auditArchiveProjectSlug,
        }) ||
        undefined,
    );
    const auditArchiveRoleArn = await askRequired(
      'AWS audit archive role ARN',
      process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN?.trim() ||
        auditArchiveOutputs?.AuditArchiveRoleArn?.trim() ||
        buildAuditArchiveRoleArn({
          accountId: awsIdentity?.accountId,
          projectSlug: auditArchiveProjectSlug,
        }) ||
        undefined,
    );
    const auditArchivePrefix = await askWithDefault(
      'AWS audit archive object prefix',
      process.env.AWS_AUDIT_ARCHIVE_PREFIX?.trim() || DEFAULT_AUDIT_ARCHIVE_PREFIX,
    );
    const guardDutyWebhookSecret = await askWithDefault(
      'AWS GuardDuty webhook shared secret',
      await generateSecret(32),
    );
    const inspectionWebhookSecret = await askWithDefault(
      'AWS storage inspection webhook shared secret',
      await generateSecret(32),
    );
    const serveSecret = await askWithDefault(
      'AWS file serve signing secret',
      await generateSecret(32),
    );
    const brokerSharedSecret = await askWithDefault(
      'Storage broker shared secret',
      process.env.AWS_STORAGE_BROKER_SHARED_SECRET?.trim() || (await generateSecret(32)),
    );
    const workerSharedSecret = await askWithDefault(
      'Storage worker shared secret',
      process.env.AWS_STORAGE_WORKER_SHARED_SECRET?.trim() || (await generateSecret(32)),
    );
    const convexCallbackSharedSecret = await askWithDefault(
      'Convex storage callback shared secret',
      process.env.AWS_CONVEX_STORAGE_CALLBACK_SHARED_SECRET?.trim() || (await generateSecret(32)),
    );
    let brokerRuntimeUrl = (
      await ask(
        'Storage broker runtime URL (leave empty until after infra deploy): ',
        discoveredBrokerRuntimeUrl || process.env.STORAGE_BROKER_URL?.trim() || undefined,
      )
    ).trim();
    let workerRuntimeUrl = (
      await ask(
        'Storage worker runtime URL (leave empty until after infra deploy): ',
        discoveredWorkerRuntimeUrl || process.env.STORAGE_WORKER_URL?.trim() || undefined,
      )
    ).trim();
    const alertEmailAddress = (
      await ask(
        'AWS storage alert email (leave empty to disable prod SNS email alerts): ',
        process.env.AWS_STORAGE_ALERT_EMAIL?.trim() || undefined,
      )
    ).trim();

    operatorEnvVars.AWS_REGION = awsRegion;
    operatorEnvVars.AWS_S3_QUARANTINE_BUCKET = buckets.quarantine;
    operatorEnvVars.AWS_S3_CLEAN_BUCKET = buckets.clean;
    operatorEnvVars.AWS_S3_REJECTED_BUCKET = buckets.rejected;
    operatorEnvVars.AWS_S3_MIRROR_BUCKET = buckets.mirror;
    operatorEnvVars.AWS_S3_QUARANTINE_KMS_KEY_ARN = quarantineKmsKeyArn;
    operatorEnvVars.AWS_S3_CLEAN_KMS_KEY_ARN = cleanKmsKeyArn;
    operatorEnvVars.AWS_S3_REJECTED_KMS_KEY_ARN = rejectedKmsKeyArn;
    operatorEnvVars.AWS_S3_MIRROR_KMS_KEY_ARN = mirrorKmsKeyArn;
    operatorEnvVars.AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET = guardDutyWebhookSecret;
    operatorEnvVars.AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET = inspectionWebhookSecret;
    operatorEnvVars.AWS_FILE_SERVE_SIGNING_SECRET = serveSecret;
    operatorEnvVars.CONVEX_SITE_URL = convexSiteUrl;
    operatorEnvVars.AWS_AUDIT_ARCHIVE_BUCKET = auditArchiveBucket;
    operatorEnvVars.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN = auditArchiveKmsKeyArn;
    operatorEnvVars.AWS_AUDIT_ARCHIVE_ROLE_ARN = auditArchiveRoleArn;
    operatorEnvVars.AWS_AUDIT_ARCHIVE_PREFIX = auditArchivePrefix;
    if (brokerRuntimeUrl) {
      operatorEnvVars.STORAGE_BROKER_URL = brokerRuntimeUrl;
    }
    if (workerRuntimeUrl) {
      operatorEnvVars.STORAGE_WORKER_URL = workerRuntimeUrl;
    }
    operatorEnvVars.AWS_STORAGE_BROKER_SHARED_SECRET = brokerSharedSecret;
    operatorEnvVars.AWS_STORAGE_WORKER_SHARED_SECRET = workerSharedSecret;
    operatorEnvVars.AWS_CONVEX_STORAGE_CALLBACK_SHARED_SECRET = convexCallbackSharedSecret;
    if (alertEmailAddress) {
      operatorEnvVars.AWS_STORAGE_ALERT_EMAIL = alertEmailAddress;
    }

    convexProdEnvVars.AWS_REGION = awsRegion;
    convexProdEnvVars.AWS_S3_QUARANTINE_BUCKET = buckets.quarantine;
    convexProdEnvVars.AWS_S3_CLEAN_BUCKET = buckets.clean;
    convexProdEnvVars.AWS_S3_REJECTED_BUCKET = buckets.rejected;
    convexProdEnvVars.AWS_S3_MIRROR_BUCKET = buckets.mirror;
    convexProdEnvVars.AWS_S3_QUARANTINE_KMS_KEY_ARN = quarantineKmsKeyArn;
    convexProdEnvVars.AWS_S3_CLEAN_KMS_KEY_ARN = cleanKmsKeyArn;
    convexProdEnvVars.AWS_S3_REJECTED_KMS_KEY_ARN = rejectedKmsKeyArn;
    convexProdEnvVars.AWS_S3_MIRROR_KMS_KEY_ARN = mirrorKmsKeyArn;
    convexProdEnvVars.AWS_AUDIT_ARCHIVE_BUCKET = auditArchiveBucket;
    convexProdEnvVars.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN = auditArchiveKmsKeyArn;
    convexProdEnvVars.AWS_AUDIT_ARCHIVE_ROLE_ARN = auditArchiveRoleArn;
    convexProdEnvVars.AWS_AUDIT_ARCHIVE_PREFIX = auditArchivePrefix;
    convexProdEnvVars.AWS_FILE_SERVE_SIGNING_SECRET = serveSecret;
    convexProdEnvVars.STORAGE_BROKER_SHARED_SECRET = brokerSharedSecret;
    convexProdEnvVars.STORAGE_WORKER_SHARED_SECRET = workerSharedSecret;
    convexProdEnvVars.CONVEX_STORAGE_CALLBACK_SHARED_SECRET = convexCallbackSharedSecret;
    if (brokerRuntimeUrl) {
      convexProdEnvVars.STORAGE_BROKER_URL = brokerRuntimeUrl;
    }
    if (workerRuntimeUrl) {
      convexProdEnvVars.STORAGE_WORKER_URL = workerRuntimeUrl;
    }

    storageDeployEnv = buildStorageDeployEnv({
      awsRegion,
      awsProfile: awsProfile ?? undefined,
      buckets,
      brokerSharedSecret,
      convexCallbackSharedSecret,
      convexSiteUrl,
      fileServeSigningSecret: serveSecret,
      guardDutyWebhookSecret,
      inspectionWebhookSecret,
      alertEmailAddress: alertEmailAddress || undefined,
      workerSharedSecret,
    });
  }
  printTargetSummary('Provider target summary', [
    `Storage mode: ${storageMode}`,
    `AWS region: ${awsRegion}`,
    `AWS profile: ${awsProfile ?? 'current shell/default'}`,
    `Storage stack: ${storageMode === 'convex' ? 'n/a' : storageStackName}`,
    `Quarantine bucket: ${operatorEnvVars.AWS_S3_QUARANTINE_BUCKET ?? 'n/a'}`,
    `Audit archive bucket: ${operatorEnvVars.AWS_AUDIT_ARCHIVE_BUCKET ?? 'n/a'}`,
    `Alert email: ${operatorEnvVars.AWS_STORAGE_ALERT_EMAIL ?? 'disabled'}`,
    'Netlify storage env sync: not required',
  ]);

  const persistedEnvVars = {
    ...operatorEnvVars,
  };

  console.log('\nProduction env values:');
  for (const [name, value] of Object.entries(persistedEnvVars)) {
    const displayValue = name.includes('SECRET') ? '[generated/set]' : value;
    console.log(`   ${name}=${displayValue}`);
  }

  const prodEnvPath = writeProdEnvFile(persistedEnvVars);
  changedLocally.push(`Wrote ${prodEnvPath} with production storage operator env`);
  console.log(`\n📝 Saved production operator env to ${prodEnvPath}`);
  console.log(
    '   Standalone `pnpm storage:preview:prod` and `pnpm storage:deploy:prod` reuse this file.',
  );

  if (!storageDeployEnv) {
    console.log('\nDone.');
    console.log('No AWS storage infrastructure deployment is required for convex mode.');
    nextCommands.push('pnpm run deploy:doctor -- --prod');
    const finalSummary = {
      changedLocally,
      changedRemotely,
      nextCommands,
      readiness: {
        convexEnv: 'not required',
        operatorEnv: 'ready',
        storage: 'ready',
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

  console.log('\nDerived storage deploy env for production:');
  console.log(`   AWS_REGION=${storageDeployEnv.AWS_REGION}`);
  if (storageDeployEnv.AWS_PROFILE) {
    console.log(`   AWS_PROFILE=${storageDeployEnv.AWS_PROFILE}`);
  }
  console.log(
    `   AWS_CONVEX_STORAGE_CALLBACK_BASE_URL=${storageDeployEnv.AWS_CONVEX_STORAGE_CALLBACK_BASE_URL}`,
  );
  console.log('   AWS_CONVEX_STORAGE_CALLBACK_SHARED_SECRET=[set]');
  console.log('   AWS_FILE_SERVE_SIGNING_SECRET=[set]');
  console.log('   AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET=[set]');
  console.log('   AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET=[set]');
  console.log('   AWS_STORAGE_BROKER_SHARED_SECRET=[set]');
  console.log('   AWS_STORAGE_WORKER_SHARED_SECRET=[set]');
  if (storageDeployEnv.AWS_STORAGE_ALERT_EMAIL) {
    console.log(`   AWS_STORAGE_ALERT_EMAIL=${storageDeployEnv.AWS_STORAGE_ALERT_EMAIL}`);
  }
  console.log(`   AWS_S3_QUARANTINE_BUCKET_NAME=${storageDeployEnv.AWS_S3_QUARANTINE_BUCKET_NAME}`);
  console.log(`   AWS_S3_CLEAN_BUCKET_NAME=${storageDeployEnv.AWS_S3_CLEAN_BUCKET_NAME}`);
  console.log(`   AWS_S3_REJECTED_BUCKET_NAME=${storageDeployEnv.AWS_S3_REJECTED_BUCKET_NAME}`);
  console.log(`   AWS_S3_MIRROR_BUCKET_NAME=${storageDeployEnv.AWS_S3_MIRROR_BUCKET_NAME}`);
  console.log('');

  const deployTargetIdentity = getAwsIdentity(
    String(storageDeployEnv.AWS_REGION),
    storageDeployEnv.AWS_PROFILE ? String(storageDeployEnv.AWS_PROFILE) : undefined,
  );
  if (deployTargetIdentity) {
    console.log('Resolved AWS deploy target:');
    console.log(`   Account=${deployTargetIdentity.accountId ?? '[unknown]'}`);
    console.log(`   ARN=${deployTargetIdentity.arn ?? '[unknown]'}`);
    console.log(`   Region=${deployTargetIdentity.region}`);
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
      const outputs =
        getStorageStackOutputs({
          awsProfile: awsProfile ?? undefined,
          region: awsRegion,
          stackName: storageStackName,
        }) ?? {};
      const nextBrokerRuntimeUrl = outputs?.[STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl] ?? '';
      const nextWorkerRuntimeUrl = outputs?.[STORAGE_STACK_OUTPUT_NAMES.workerRuntimeUrl] ?? '';
      if (nextBrokerRuntimeUrl && nextWorkerRuntimeUrl) {
        operatorEnvVars.STORAGE_BROKER_URL = nextBrokerRuntimeUrl;
        operatorEnvVars.STORAGE_WORKER_URL = nextWorkerRuntimeUrl;
        convexProdEnvVars.STORAGE_BROKER_URL = nextBrokerRuntimeUrl;
        convexProdEnvVars.STORAGE_WORKER_URL = nextWorkerRuntimeUrl;
        persistedEnvVars.STORAGE_BROKER_URL = nextBrokerRuntimeUrl;
        persistedEnvVars.STORAGE_WORKER_URL = nextWorkerRuntimeUrl;
        const refreshedEnvPath = writeProdEnvFile(operatorEnvVars);
        changedLocally.push(`Updated ${refreshedEnvPath} with deployed storage runtime URLs`);
        console.log(`   ${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl}=${nextBrokerRuntimeUrl}`);
        console.log(`   ${STORAGE_STACK_OUTPUT_NAMES.workerRuntimeUrl}=${nextWorkerRuntimeUrl}`);
      } else {
        console.log('⚠️  Storage stack deployed, but runtime URL outputs are still missing.');
      }
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

  const setConvex = await askYesNo('\nSet these in Convex production now?', true);
  if (setConvex) {
    if (!convexProdEnvVars.STORAGE_BROKER_URL || !convexProdEnvVars.STORAGE_WORKER_URL) {
      console.log(
        '\n⚠️  Skipping Convex production env sync because broker/worker runtime URLs are still missing.',
      );
      console.log(
        `   Deploy the storage stack or fetch ${STORAGE_STACK_OUTPUT_NAMES.brokerRuntimeUrl} and ${STORAGE_STACK_OUTPUT_NAMES.workerRuntimeUrl} from the deployed stack, then rerun this script or set the Convex env vars manually.`,
      );
      warnings.push(
        'Convex production storage env sync was skipped because storage runtime URLs are still missing.',
      );
    } else {
      console.log('\n☁️  Setting Convex production env vars...');
      const convexEnvValues: Record<string, string> = {
        FILE_STORAGE_BACKEND: String(convexProdEnvVars.FILE_STORAGE_BACKEND),
        AWS_REGION: String(convexProdEnvVars.AWS_REGION),
        AWS_S3_QUARANTINE_BUCKET: String(convexProdEnvVars.AWS_S3_QUARANTINE_BUCKET),
        AWS_S3_CLEAN_BUCKET: String(convexProdEnvVars.AWS_S3_CLEAN_BUCKET),
        AWS_S3_REJECTED_BUCKET: String(convexProdEnvVars.AWS_S3_REJECTED_BUCKET),
        AWS_S3_MIRROR_BUCKET: String(convexProdEnvVars.AWS_S3_MIRROR_BUCKET),
        AWS_S3_QUARANTINE_KMS_KEY_ARN: String(convexProdEnvVars.AWS_S3_QUARANTINE_KMS_KEY_ARN),
        AWS_S3_CLEAN_KMS_KEY_ARN: String(convexProdEnvVars.AWS_S3_CLEAN_KMS_KEY_ARN),
        AWS_S3_REJECTED_KMS_KEY_ARN: String(convexProdEnvVars.AWS_S3_REJECTED_KMS_KEY_ARN),
        AWS_S3_MIRROR_KMS_KEY_ARN: String(convexProdEnvVars.AWS_S3_MIRROR_KMS_KEY_ARN),
        AWS_AUDIT_ARCHIVE_BUCKET: String(convexProdEnvVars.AWS_AUDIT_ARCHIVE_BUCKET),
        AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: String(convexProdEnvVars.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN),
        AWS_AUDIT_ARCHIVE_ROLE_ARN: String(convexProdEnvVars.AWS_AUDIT_ARCHIVE_ROLE_ARN),
        AWS_AUDIT_ARCHIVE_PREFIX: String(convexProdEnvVars.AWS_AUDIT_ARCHIVE_PREFIX),
        AWS_FILE_SERVE_SIGNING_SECRET: String(convexProdEnvVars.AWS_FILE_SERVE_SIGNING_SECRET),
        STORAGE_BROKER_URL: String(convexProdEnvVars.STORAGE_BROKER_URL),
        STORAGE_BROKER_SHARED_SECRET: String(convexProdEnvVars.STORAGE_BROKER_SHARED_SECRET),
        STORAGE_WORKER_URL: String(convexProdEnvVars.STORAGE_WORKER_URL),
        STORAGE_WORKER_SHARED_SECRET: String(convexProdEnvVars.STORAGE_WORKER_SHARED_SECRET),
        CONVEX_STORAGE_CALLBACK_SHARED_SECRET: String(
          convexProdEnvVars.CONVEX_STORAGE_CALLBACK_SHARED_SECRET,
        ),
      };
      const failedKeys: Array<{ name: string; value: string }> = [];
      for (const [name, value] of Object.entries(convexEnvValues)) {
        try {
          console.log(`   Setting ${name}...`);
          convexEnvSet(name, value, true);
        } catch (error) {
          failedKeys.push({ name, value });
          console.log(`   ⚠️  Failed to set ${name}.`);
          console.log(`      ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (failedKeys.length === 0) {
        console.log('✅ Convex production env updated.');
        changedRemotely.push('Updated Convex production storage env vars');
      } else {
        console.log('⚠️  Some Convex production env vars were not updated.');
        console.log('   Retry manually with:');
        for (const failed of failedKeys) {
          console.log(`   ${buildManualConvexEnvSetCommand(failed.name, failed.value)}`);
        }
      }
    }
  }

  const storageRuntimeWarning = getStorageRuntimeUrlWarning({
    brokerRuntimeUrl: convexProdEnvVars.STORAGE_BROKER_URL,
    storageMode,
    workerRuntimeUrl: convexProdEnvVars.STORAGE_WORKER_URL,
  });
  if (storageRuntimeWarning) {
    warnings.push(storageRuntimeWarning);
    if (!nextCommands.includes('pnpm run storage:setup:prod')) {
      nextCommands.push('pnpm run storage:setup:prod');
    }
  }

  const finalSummary = {
    changedLocally,
    changedRemotely,
    nextCommands,
    readiness: {
      convexEnv:
        storageMode === 'convex'
          ? 'not required'
          : convexProdEnvVars.STORAGE_BROKER_URL && convexProdEnvVars.STORAGE_WORKER_URL
            ? 'ready'
            : 'needs attention',
      operatorEnv: 'ready',
      storage: getStorageSetupReadiness({
        brokerRuntimeUrl: convexProdEnvVars.STORAGE_BROKER_URL,
        storageMode,
        workerRuntimeUrl: convexProdEnvVars.STORAGE_WORKER_URL,
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
  console.error('\n❌ Production storage setup failed');
  console.error(error);
  process.exit(1);
});
