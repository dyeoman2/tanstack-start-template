#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { convexEnvSet } from './lib/convex-cli';
import { upsertStructuredEnvValue } from './lib/env-file';
import { getCloudFormationStackOutputs } from './lib/aws-cloudformation';
import { loadOptionalEnvFile } from './lib/load-env-file';
import {
  checkAwsCredentials,
  checkCdkBootstrap,
  checkConvexProdAccess,
} from './lib/provider-preflight';
import {
  emitStructuredOutput,
  maybeWriteStructuredOutputArtifact,
  printFinalChangeSummary,
  printStatusSummary,
  printTargetSummary,
  routeLogsToStderrWhenJson,
} from './lib/script-ux';

const LOCAL_ENV_FILE = '.env.local';
const PROD_ENV_FILE = '.env.prod';
const DEFAULT_PROJECT_SLUG = 'tanstack-start-template';
const DEFAULT_RETENTION_DAYS = '2555';
const DEFAULT_ARCHIVE_PREFIX = 'audit-ledger/';

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

async function resolveOptionalInput(input: {
  fallback?: string;
  nonInteractive: boolean;
  question: string;
}) {
  if (input.nonInteractive) {
    return input.fallback?.trim() ?? '';
  }

  return (
    await ask(`${input.question}: `, input.fallback?.trim() ? input.fallback.trim() : undefined)
  ).trim();
}

async function resolveDefaultedInput(input: {
  fallback: string;
  nonInteractive: boolean;
  question: string;
}) {
  if (input.nonInteractive) {
    return input.fallback;
  }

  return askWithDefault(input.question, input.fallback);
}

async function resolveRequiredInput(input: {
  fallback?: string;
  nonInteractive: boolean;
  question: string;
}) {
  if (input.nonInteractive) {
    const value = input.fallback?.trim() ?? '';
    if (!value) {
      throw new Error(`${input.question} is required in non-interactive mode.`);
    }
    return value;
  }

  return askRequired(input.question, input.fallback);
}

function readEnvFile(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function readEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envContent.match(new RegExp(`^${escapedName}=(.*)$`, 'm'));
  return match?.[1]?.trim()?.replace(/^"(.*)"$/, '$1') || null;
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

function buildAuditArchiveStackName(projectSlug: string) {
  return `${projectSlug}-audit-archive-stack`;
}

function run(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
  const result = spawnSync(command, args, {
    cwd: options?.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...options?.env,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status ?? 1}`);
  }
}

function writeProdEnvValue(envContent: string, name: string, value: string) {
  return upsertStructuredEnvValue(envContent, name, value, {
    sectionMarker: '# AUDIT ARCHIVE',
  });
}

function printUsage() {
  console.log('Usage: pnpm run audit-archive:setup -- [--prod] [--yes] [--json]');
  console.log('');
  console.log(
    'What this does: configure immutable audit archive AWS inputs for local/dev by default or production with --prod, optionally preview/deploy the stack, capture CloudFormation outputs, and optionally sync Convex runtime env.',
  );
  console.log('Use this when S3-backed storage needs immutable audit archive infrastructure.');
  console.log('Docs: docs/DEPLOY_ENVIRONMENT.md');
  console.log('');
  console.log('Safe to rerun: yes; operator env and Convex runtime env can be refreshed.');
}

async function main() {
  const json = process.argv.includes('--json');
  const prod = process.argv.includes('--prod');
  const yes = process.argv.includes('--yes') || process.argv.includes('--non-interactive');
  routeLogsToStderrWhenJson(json);
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const changedLocally: string[] = [];
  const changedRemotely: string[] = [];
  const nextCommands: string[] = [];
  const warnings: string[] = [];
  let convexEnvSynced = false;
  const targetEnvFile = prod ? PROD_ENV_FILE : LOCAL_ENV_FILE;
  const targetEnvLabel = prod ? 'production' : 'local development';
  const convexTarget = prod ? 'production' : 'current development';
  const rerunCommand = prod
    ? 'pnpm run audit-archive:setup -- --prod'
    : 'pnpm run audit-archive:setup';
  const deployDoctorCommand = prod ? 'pnpm run deploy:doctor -- --prod' : 'pnpm run deploy:doctor';

  console.log('🧾 Audit archive setup\n');
  console.log(
    `This flow configures immutable audit archive stack inputs for ${targetEnvLabel}, can preview/deploy the AWS stack, records CloudFormation outputs in ${targetEnvFile}, and can sync Convex ${convexTarget} runtime env.\n`,
  );

  const requiredMissing = findMissingCommands([{ cmd: 'pnpm' }, { cmd: 'aws' }]);
  if (requiredMissing.length > 0) {
    for (const item of requiredMissing) {
      console.log(`- ${item.cmd}: ${item.hint}`);
    }
    process.exit(1);
  }

  printStatusSummary('Provider auth status', [
    {
      label: 'AWS',
      value: getAwsAuthStatus(
        process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-west-1',
      ),
    },
    {
      label: 'Convex',
      value: commandOnPath('pnpm') ? 'available if you opt into runtime sync' : 'cli missing',
    },
  ]);

  const shouldContinue = yes || (await askYesNo('Continue?', true));
  if (!shouldContinue) {
    console.log('Cancelled.');
    return;
  }

  requireCommands([{ cmd: 'aws' }]);
  requirePnpmAndConvexCli();

  const targetEnvPath = path.join(process.cwd(), targetEnvFile);
  loadOptionalEnvFile(path.join(process.cwd(), '.env'));
  loadOptionalEnvFile(targetEnvPath);
  let targetEnvContent = readEnvFile(targetEnvPath);
  const awsRegion = await resolveDefaultedInput({
    fallback:
      readEnvValue(targetEnvContent, 'AWS_REGION') ?? process.env.AWS_REGION?.trim() ?? 'us-west-1',
    nonInteractive: yes,
    question: 'AWS region',
  });
  const awsProfile = await (yes
    ? Promise.resolve(
        readEnvValue(targetEnvContent, 'AWS_PROFILE') ?? process.env.AWS_PROFILE?.trim() ?? null,
      )
    : chooseAwsProfile(
        readEnvValue(targetEnvContent, 'AWS_PROFILE') ?? process.env.AWS_PROFILE?.trim() ?? null,
      ));
  const projectSlug = await resolveDefaultedInput({
    fallback:
      readEnvValue(targetEnvContent, 'AWS_AUDIT_ARCHIVE_PROJECT_SLUG') ??
      process.env.AWS_AUDIT_ARCHIVE_PROJECT_SLUG?.trim() ??
      DEFAULT_PROJECT_SLUG,
    nonInteractive: yes,
    question: 'Audit archive project slug',
  });
  const awsCredentialCheck = checkAwsCredentials({
    awsProfile: awsProfile ?? undefined,
    region: awsRegion,
  });
  if (!awsCredentialCheck.ok) {
    throw new Error(awsCredentialCheck.detail);
  }
  const stackName = buildAuditArchiveStackName(projectSlug);
  const currentOutputs =
    getCloudFormationStackOutputs({
      awsProfile: awsProfile ?? undefined,
      region: awsRegion,
      stackName,
    }) ?? {};
  const defaultBucketName =
    readEnvValue(targetEnvContent, 'AWS_AUDIT_ARCHIVE_BUCKET_NAME') ??
    process.env.AWS_AUDIT_ARCHIVE_BUCKET_NAME?.trim() ??
    currentOutputs.AuditArchiveBucketName ??
    '';
  const bucketNameInput = await resolveOptionalInput({
    fallback: defaultBucketName || undefined,
    nonInteractive: yes,
    question: 'Audit archive bucket name (leave empty to let CDK name it)',
  });
  const retentionDays = await resolveDefaultedInput({
    fallback:
      readEnvValue(targetEnvContent, 'AWS_AUDIT_ARCHIVE_RETENTION_DAYS') ??
      process.env.AWS_AUDIT_ARCHIVE_RETENTION_DAYS?.trim() ??
      DEFAULT_RETENTION_DAYS,
    nonInteractive: yes,
    question: 'Audit archive retention days',
  });
  const trustedPrincipalArn = await resolveRequiredInput({
    fallback:
      readEnvValue(targetEnvContent, 'AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN') ??
      process.env.AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN?.trim() ??
      undefined,
    nonInteractive: yes,
    question: 'Trusted principal ARN for the audit archive role',
  });
  const archivePrefix = await resolveDefaultedInput({
    fallback:
      readEnvValue(targetEnvContent, 'AWS_AUDIT_ARCHIVE_PREFIX') ??
      process.env.AWS_AUDIT_ARCHIVE_PREFIX?.trim() ??
      DEFAULT_ARCHIVE_PREFIX,
    nonInteractive: yes,
    question: 'Audit archive runtime prefix',
  });

  printTargetSummary('Provider target summary', [
    `AWS region: ${awsRegion}`,
    `AWS profile: ${awsProfile ?? 'current shell/default'}`,
    `Audit archive stack: ${stackName}`,
    `Bucket name: ${bucketNameInput || 'CDK generated'}`,
    `Trusted principal: ${trustedPrincipalArn}`,
    `Runtime prefix: ${archivePrefix}`,
    `Convex target: ${convexTarget}`,
  ]);

  targetEnvContent = writeProdEnvValue(targetEnvContent, 'AWS_REGION', awsRegion);
  if (awsProfile) {
    targetEnvContent = writeProdEnvValue(targetEnvContent, 'AWS_PROFILE', awsProfile);
  }
  targetEnvContent = writeProdEnvValue(
    targetEnvContent,
    'AWS_AUDIT_ARCHIVE_PROJECT_SLUG',
    projectSlug,
  );
  targetEnvContent = writeProdEnvValue(
    targetEnvContent,
    'AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN',
    trustedPrincipalArn,
  );
  targetEnvContent = writeProdEnvValue(
    targetEnvContent,
    'AWS_AUDIT_ARCHIVE_RETENTION_DAYS',
    retentionDays,
  );
  targetEnvContent = writeProdEnvValue(targetEnvContent, 'AWS_AUDIT_ARCHIVE_PREFIX', archivePrefix);
  if (bucketNameInput.trim()) {
    targetEnvContent = writeProdEnvValue(
      targetEnvContent,
      'AWS_AUDIT_ARCHIVE_BUCKET_NAME',
      bucketNameInput.trim(),
    );
  }

  writeFileSync(targetEnvPath, targetEnvContent, 'utf8');
  changedLocally.push(`Updated ${targetEnvPath} with audit archive deploy-time configuration`);

  const deployEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_REGION: awsRegion,
    ...(awsProfile ? { AWS_PROFILE: awsProfile } : {}),
    AWS_AUDIT_ARCHIVE_PROJECT_SLUG: projectSlug,
    AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN: trustedPrincipalArn,
    AWS_AUDIT_ARCHIVE_RETENTION_DAYS: retentionDays,
    ...(bucketNameInput.trim() ? { AWS_AUDIT_ARCHIVE_BUCKET_NAME: bucketNameInput.trim() } : {}),
    CDK_DEFAULT_REGION: process.env.CDK_DEFAULT_REGION || awsRegion,
  };

  const infraRoot = path.join(process.cwd(), 'infra', 'aws-cdk');
  const appPath = 'node ./bin/app.mjs';
  const shouldPreviewInfra = yes ? false : await askYesNo('Run audit archive preview now?', false);
  if (shouldPreviewInfra) {
    const bootstrapCheck = checkCdkBootstrap({
      awsProfile: awsProfile ?? undefined,
      region: awsRegion,
    });
    if (!bootstrapCheck.ok) {
      throw new Error(bootstrapCheck.detail);
    }
    run('pnpm', ['exec', 'cdk', 'synth', '--app', appPath, stackName], {
      cwd: infraRoot,
      env: deployEnv,
    });
    changedRemotely.push('Ran AWS audit archive preview');
  }

  const shouldDeployInfra = yes ? true : await askYesNo('Run audit archive deploy now?', false);
  if (shouldDeployInfra) {
    const bootstrapCheck = checkCdkBootstrap({
      awsProfile: awsProfile ?? undefined,
      region: awsRegion,
    });
    if (!bootstrapCheck.ok) {
      throw new Error(bootstrapCheck.detail);
    }
    run(
      'pnpm',
      ['exec', 'cdk', 'deploy', '--require-approval', 'never', '--app', appPath, stackName],
      {
        cwd: infraRoot,
        env: deployEnv,
      },
    );
    changedRemotely.push('Deployed AWS audit archive infrastructure');
  } else {
    nextCommands.push(rerunCommand);
  }

  const finalOutputs =
    getCloudFormationStackOutputs({
      awsProfile: awsProfile ?? undefined,
      region: awsRegion,
      stackName,
    }) ?? {};
  const runtimeBucket = finalOutputs.AuditArchiveBucketName?.trim() || '';
  const runtimeKmsKeyArn = finalOutputs.AuditArchiveBucketKeyArn?.trim() || '';
  const runtimeRoleArn = finalOutputs.AuditArchiveRoleArn?.trim() || '';

  if (runtimeBucket && runtimeKmsKeyArn && runtimeRoleArn) {
    targetEnvContent = writeProdEnvValue(
      targetEnvContent,
      'AWS_AUDIT_ARCHIVE_BUCKET',
      runtimeBucket,
    );
    targetEnvContent = writeProdEnvValue(
      targetEnvContent,
      'AWS_AUDIT_ARCHIVE_KMS_KEY_ARN',
      runtimeKmsKeyArn,
    );
    targetEnvContent = writeProdEnvValue(
      targetEnvContent,
      'AWS_AUDIT_ARCHIVE_ROLE_ARN',
      runtimeRoleArn,
    );
    writeFileSync(targetEnvPath, targetEnvContent, 'utf8');
    changedLocally.push(`Updated ${targetEnvPath} with audit archive runtime outputs`);
  }

  const setConvex = yes
    ? true
    : await askYesNo(`Sync audit archive runtime env into Convex ${convexTarget} now?`, true);
  if (setConvex) {
    if (!runtimeBucket || !runtimeKmsKeyArn || !runtimeRoleArn) {
      warnings.push(
        'Convex audit archive runtime sync was skipped because CloudFormation outputs are still missing.',
      );
      console.log(
        '\n⚠️  Skipping Convex sync because audit archive stack outputs are still missing.',
      );
    } else {
      if (prod) {
        const convexCheck = checkConvexProdAccess();
        if (!convexCheck.ok) {
          throw new Error(convexCheck.detail);
        }
      }
      const runtimeEnvVars: Record<string, string> = {
        AWS_AUDIT_ARCHIVE_BUCKET: runtimeBucket,
        AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: runtimeKmsKeyArn,
        AWS_AUDIT_ARCHIVE_ROLE_ARN: runtimeRoleArn,
        AWS_AUDIT_ARCHIVE_PREFIX: archivePrefix,
      };
      for (const [name, value] of Object.entries(runtimeEnvVars)) {
        convexEnvSet(name, value, prod);
      }
      changedRemotely.push(`Updated Convex ${convexTarget} audit archive env vars`);
      convexEnvSynced = true;
    }
  }

  const runtimeReady = Boolean(runtimeBucket && runtimeKmsKeyArn && runtimeRoleArn);
  if (!runtimeReady) {
    warnings.push(
      'Audit archive deploy-time inputs are saved, but runtime outputs are still missing. Deploy the stack before treating immutable audit archive as configured.',
    );
    if (!nextCommands.includes(deployDoctorCommand)) {
      nextCommands.push(deployDoctorCommand);
    }
  } else if (!nextCommands.includes(deployDoctorCommand)) {
    nextCommands.push(deployDoctorCommand);
  }

  const finalSummary = {
    changedLocally,
    changedRemotely,
    nextCommands,
    readiness: {
      auditArchive: runtimeReady ? 'ready' : 'needs attention',
      convexEnv: !setConvex
        ? 'skipped'
        : runtimeReady && convexEnvSynced
          ? 'ready'
          : 'needs attention',
      operatorEnv: 'ready',
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
  console.error('\n❌ Audit archive setup failed');
  console.error(error);
  process.exit(1);
});
