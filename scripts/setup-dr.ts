#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import {
  buildDefaultBackupBucketName,
  buildDrSecretNames,
  buildRequiredNetlifyDrEnvVars,
  type DrHostnameStrategy,
  extractJsonText,
  extractHostnameFromUrl,
  getRequiredRecoveryEnvKeys,
  getStorageCoverageWarning,
  isLikelyConvexDeployKey,
  parseConvexEnvList,
  parseGitHubRepoFromRemote,
  parseSetupDrArgs,
} from './lib/setup-dr';
import {
  CLI_INSTALL_HINT,
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { loadProjectEnvFiles } from './lib/load-project-env-files';
import { convexEnvList } from './lib/convex-cli';
import {
  createNetlifyBuildHook,
  createRepoBackedNetlifySite,
  formatNetlifySiteSummary,
  getNetlifySiteDetails,
  getNetlifySiteEnvValue,
  isNetlifySiteRepoBacked,
  listNetlifySiteHooks,
  readNetlifyLinkedSiteIdFromDisk,
  reinitializeNetlifySiteContinuousDeployment,
  resolveNetlifySite,
  setNetlifySiteEnvVar,
  triggerNetlifySiteBuild,
  type NetlifySite,
} from './lib/netlify-cli';
import { emitStructuredOutput, printStatusSummary } from './lib/script-ux';

type CommandResult = {
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  stdout: string;
};

type AwsIdentity = {
  accountId?: string;
  arn?: string;
  region?: string;
};

type StackOutputs = Record<string, string>;

type SetupContext = {
  backupBucketName: string;
  backendSubdomain: string;
  convexDeployKey?: string;
  createdAwsAccessKey?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  domain?: string;
  ecsCpu: string;
  ecsMemoryMiB: string;
  frontendSubdomain: string;
  hostnameStrategy: DrHostnameStrategy;
  githubRepo?: string;
  netlifySiteInput?: string;
  projectSlug: string;
  runWorkflowTest: boolean;
  setupCloudflareNow: boolean;
  setupNetlifyNow: boolean;
  siteSubdomain: string;
  frontendCnameTarget?: string;
};

type ReadinessLane = 'ready' | 'partial' | 'blocked';

type SetupSummary = {
  backupLane: ReadinessLane;
  backendLane: ReadinessLane;
  completed: string[];
  frontendLane: ReadinessLane;
  needsAttention: string[];
  nextCommands: string[];
  warnings: string[];
  workflowTested: boolean;
};

const DEFAULT_PROJECT_SLUG = 'tanstack-start-template';
const DR_ENV_FILE_NAME = '.dr.env.local';
const GIT_REMOTE_NAME = 'origin';

loadProjectEnvFiles({ extraFilenames: [DR_ENV_FILE_NAME] });

function getDrBackupStackName() {
  return `${process.env.AWS_DR_PROJECT_SLUG?.trim() || DEFAULT_PROJECT_SLUG}-dr-backup-stack`;
}

function getDrEcsStackName() {
  return (
    process.env.AWS_DR_STACK_NAME?.trim() ||
    `${process.env.AWS_DR_PROJECT_SLUG?.trim() || DEFAULT_PROJECT_SLUG}-dr-ecs-stack`
  );
}

function printUsage() {
  console.log('Usage: pnpm run dr:setup -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --yes                 Run non-interactively with discovered/default values.');
  console.log('  --non-interactive     Alias for --yes.');
  console.log('  --hostname-strategy <provider-hostnames|custom-domain>');
  console.log('                        Choose provider-native URLs or your own DR domain.');
  console.log('  --domain <value>      DR base domain, for example example.com.');
  console.log('  --project-slug <id>   Override the DR resource slug.');
  console.log('  --github-repo <repo>  Target GitHub repo as owner/name.');
  console.log('  --netlify-site <id>   Existing Netlify site id or name for the DR frontend.');
  console.log('  --skip-github         Skip GitHub Actions secret and workflow setup.');
  console.log('  --skip-netlify        Skip dedicated Netlify DR site setup.');
  console.log('  --skip-ecs            Skip DR ECS stack preview and deploy.');
  console.log('  --skip-cloudflare     Skip Cloudflare DNS automation secret setup.');
  console.log(
    '  --plan                Print a DR plan after discovery and exit before changing providers.',
  );
  console.log('  --json                Print the final summary as JSON.');
  console.log('  -h, --help            Show this help text.');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm run dr:setup');
  console.log('  pnpm run dr:setup -- --yes --skip-netlify');
  console.log('  pnpm run dr:setup -- --hostname-strategy custom-domain --domain example.com');
  console.log('  pnpm run dr:setup -- --plan --json');
  console.log('');
  console.log('Docs: docs/DISASTER_RECOVERY_CONFIG.md');
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

function removeEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return envContent.replace(new RegExp(`^${escapedName}=.*(?:\n|$)`, 'm'), '');
}

function writeDirenvFile(input: { awsProfile?: string; awsRegion: string }) {
  const envrcPath = path.join(process.cwd(), '.envrc');
  const envrcContent = [
    '# Generated by: pnpm run dr:setup',
    '# Repo-local AWS CLI defaults for direnv',
    `export AWS_REGION=${JSON.stringify(input.awsRegion)}`,
    ...(input.awsProfile ? [`export AWS_PROFILE=${JSON.stringify(input.awsProfile)}`] : []),
    '',
  ].join('\n');

  writeFileSync(envrcPath, envrcContent, 'utf8');
  return envrcPath;
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

async function askYesNo(question: string, fallback = false) {
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} (${suffix}): `)).toLowerCase();
  if (!answer) {
    return fallback;
  }

  return answer === 'y' || answer === 'yes';
}

async function chooseHostnameStrategy(
  fallback: DrHostnameStrategy,
  yes: boolean,
): Promise<DrHostnameStrategy> {
  if (yes) {
    return fallback;
  }

  console.log('DR hostname strategy options:');
  console.log(
    '   1. provider-hostnames - default, use Netlify/AWS-generated hostnames and skip Cloudflare',
  );
  console.log('   2. custom-domain      - use your own domain and derived dr.* hostnames');
  console.log('');

  while (true) {
    const defaultChoice = fallback === 'custom-domain' ? '2' : '1';
    const answer = (await ask(`Choose DR hostname strategy [${defaultChoice}]: `)).toLowerCase();
    const value = answer || defaultChoice;

    if (value === '1' || value === 'provider-hostnames') {
      return 'provider-hostnames';
    }
    if (value === '2' || value === 'custom-domain') {
      return 'custom-domain';
    }

    console.log('Please choose 1 or 2.');
  }
}

function listAwsProfiles() {
  try {
    return runCommand('aws', ['configure', 'list-profiles'])
      .stdout.split('\n')
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

function quoteShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
  },
): CommandResult {
  const spawned = spawnSync(command, args, {
    cwd: options?.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options?.env,
    },
    input: options?.input,
  });

  return {
    exitCode: spawned.status,
    ok: spawned.status === 0,
    stderr: spawned.stderr ?? '',
    stdout: spawned.stdout ?? '',
  };
}

function ensureOk(result: CommandResult, message: string) {
  if (!result.ok) {
    const details = [result.stdout, result.stderr].join('\n').trim();
    throw new Error(details ? `${message}\n${details}` : message);
  }
}

function parseJsonOutput<T>(result: CommandResult): T | null {
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const jsonText = extractJsonText(combined);
  if (!jsonText) {
    return null;
  }

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}

function printSection(title: string) {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
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

function getAwsRegion() {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    runCommand('aws', ['configure', 'get', 'region']).stdout.trim() ||
    'us-west-1'
  );
}

function getAwsIdentity(hasAwsAuth: boolean): AwsIdentity {
  if (!hasAwsAuth) {
    return {};
  }

  const region = getAwsRegion();
  const result = runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
    env: { AWS_REGION: region },
  });
  const parsed = parseJsonOutput<{ Account?: string; Arn?: string }>(result);
  return {
    accountId: parsed?.Account,
    arn: parsed?.Arn,
    region,
  };
}

function getBootstrapBucketName(accountId: string, region: string) {
  return `cdk-hnb659fds-assets-${accountId}-${region}`;
}

function hasHealthyCdkBootstrap(accountId: string, region: string) {
  const bucketName = getBootstrapBucketName(accountId, region);
  const stackResult = runCommand(
    'aws',
    ['cloudformation', 'describe-stacks', '--stack-name', 'CDKToolkit', '--output', 'json'],
    {
      env: { AWS_REGION: region },
    },
  );
  const bucketResult = runCommand('aws', ['s3api', 'head-bucket', '--bucket', bucketName], {
    env: { AWS_REGION: region },
  });

  return {
    bucketName,
    ok: stackResult.ok && bucketResult.ok,
  };
}

function getStackOutputs(stackName: string, region: string): StackOutputs | null {
  const result = runCommand(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json',
    ],
    {
      env: { AWS_REGION: region },
    },
  );

  if (!result.ok) {
    return null;
  }

  const parsed = parseJsonOutput<Array<{ OutputKey?: string; OutputValue?: string }>>(result);
  if (!parsed) {
    return null;
  }

  const outputs: StackOutputs = {};
  for (const entry of parsed) {
    if (entry.OutputKey && entry.OutputValue) {
      outputs[entry.OutputKey] = entry.OutputValue;
    }
  }

  return outputs;
}

function secretExists(secretId: string, region: string) {
  return runCommand(
    'aws',
    ['secretsmanager', 'describe-secret', '--secret-id', secretId, '--output', 'json'],
    {
      env: { AWS_REGION: region },
    },
  ).ok;
}

function upsertAwsSecret(
  secretId: string,
  secretValue: string,
  region: string,
  description?: string,
) {
  if (secretExists(secretId, region)) {
    ensureOk(
      runCommand(
        'aws',
        [
          'secretsmanager',
          'put-secret-value',
          '--secret-id',
          secretId,
          '--secret-string',
          secretValue,
        ],
        {
          env: { AWS_REGION: region },
        },
      ),
      `Failed to update Secrets Manager secret ${secretId}`,
    );
    return 'updated';
  }

  const args = [
    'secretsmanager',
    'create-secret',
    '--name',
    secretId,
    '--secret-string',
    secretValue,
  ];
  if (description) {
    args.push('--description', description);
  }

  ensureOk(
    runCommand('aws', args, {
      env: { AWS_REGION: region },
    }),
    `Failed to create Secrets Manager secret ${secretId}`,
  );
  return 'created';
}

function getAwsSecretValue(secretId: string, region: string) {
  const result = runCommand(
    'aws',
    [
      'secretsmanager',
      'get-secret-value',
      '--secret-id',
      secretId,
      '--query',
      'SecretString',
      '--output',
      'text',
    ],
    {
      env: { AWS_REGION: region },
    },
  );
  if (!result.ok) {
    return null;
  }

  const value = result.stdout.trim();
  return !value || value === 'None' ? null : value;
}

function createDrCommandEnv(context: SetupContext, identity: AwsIdentity): NodeJS.ProcessEnv {
  return {
    AWS_DR_BACKUP_S3_BUCKET: context.backupBucketName,
    AWS_DR_ECS_CPU: context.ecsCpu,
    AWS_DR_ECS_MEMORY_MIB: context.ecsMemoryMiB,
    AWS_DR_HOSTNAME_STRATEGY: context.hostnameStrategy,
    AWS_DR_PROJECT_SLUG: context.projectSlug,
    AWS_REGION: identity.region,
    CDK_DEFAULT_REGION: identity.region,
    ...(context.domain ? { AWS_DR_DOMAIN: context.domain } : {}),
    ...(context.hostnameStrategy === 'custom-domain'
      ? {
          AWS_DR_BACKEND_SUBDOMAIN: context.backendSubdomain,
          AWS_DR_FRONTEND_SUBDOMAIN: context.frontendSubdomain,
          AWS_DR_SITE_SUBDOMAIN: context.siteSubdomain,
        }
      : {}),
  };
}

function persistDrConfig(envPath: string, envContent: string, context: SetupContext) {
  let nextEnvContent = envContent;
  const ecsStackName = `${context.projectSlug}-dr-ecs-stack`;

  nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_DR_PROJECT_SLUG', context.projectSlug);
  nextEnvContent = upsertEnvValue(
    nextEnvContent,
    'AWS_DR_HOSTNAME_STRATEGY',
    context.hostnameStrategy,
  );
  nextEnvContent = upsertEnvValue(
    nextEnvContent,
    'AWS_DR_BACKUP_S3_BUCKET',
    context.backupBucketName,
  );
  nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_DR_STACK_NAME', ecsStackName);
  nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_DR_ECS_CPU', context.ecsCpu);
  nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_DR_ECS_MEMORY_MIB', context.ecsMemoryMiB);

  if (context.hostnameStrategy === 'custom-domain' && context.domain) {
    nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_DR_DOMAIN', context.domain);
    nextEnvContent = upsertEnvValue(
      nextEnvContent,
      'AWS_DR_BACKEND_SUBDOMAIN',
      context.backendSubdomain,
    );
    nextEnvContent = upsertEnvValue(
      nextEnvContent,
      'AWS_DR_FRONTEND_SUBDOMAIN',
      context.frontendSubdomain,
    );
    nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_DR_SITE_SUBDOMAIN', context.siteSubdomain);
  } else {
    nextEnvContent = removeEnvValue(nextEnvContent, 'AWS_DR_DOMAIN');
    nextEnvContent = removeEnvValue(nextEnvContent, 'AWS_DR_BACKEND_SUBDOMAIN');
    nextEnvContent = removeEnvValue(nextEnvContent, 'AWS_DR_FRONTEND_SUBDOMAIN');
    nextEnvContent = removeEnvValue(nextEnvContent, 'AWS_DR_SITE_SUBDOMAIN');
  }

  writeFileSync(envPath, nextEnvContent, 'utf8');

  process.env.AWS_DR_PROJECT_SLUG = context.projectSlug;
  process.env.AWS_DR_HOSTNAME_STRATEGY = context.hostnameStrategy;
  process.env.AWS_DR_BACKUP_S3_BUCKET = context.backupBucketName;
  process.env.AWS_DR_STACK_NAME = ecsStackName;
  process.env.AWS_DR_ECS_CPU = context.ecsCpu;
  process.env.AWS_DR_ECS_MEMORY_MIB = context.ecsMemoryMiB;
  if (context.hostnameStrategy === 'custom-domain' && context.domain) {
    process.env.AWS_DR_DOMAIN = context.domain;
    process.env.AWS_DR_BACKEND_SUBDOMAIN = context.backendSubdomain;
    process.env.AWS_DR_FRONTEND_SUBDOMAIN = context.frontendSubdomain;
    process.env.AWS_DR_SITE_SUBDOMAIN = context.siteSubdomain;
  } else {
    delete process.env.AWS_DR_DOMAIN;
    delete process.env.AWS_DR_BACKEND_SUBDOMAIN;
    delete process.env.AWS_DR_FRONTEND_SUBDOMAIN;
    delete process.env.AWS_DR_SITE_SUBDOMAIN;
  }
}

function cleanupLegacyDrConfig(envPath: string, envContent: string) {
  let nextEnvContent = envContent;
  for (const name of [
    'AWS_DR_PROJECT_SLUG',
    'AWS_DR_HOSTNAME_STRATEGY',
    'AWS_DR_BACKUP_S3_BUCKET',
    'AWS_DR_STACK_NAME',
    'AWS_DR_ECS_CPU',
    'AWS_DR_ECS_MEMORY_MIB',
    'AWS_DR_DOMAIN',
    'AWS_DR_BACKEND_SUBDOMAIN',
    'AWS_DR_FRONTEND_SUBDOMAIN',
    'AWS_DR_SITE_SUBDOMAIN',
  ]) {
    nextEnvContent = removeEnvValue(nextEnvContent, name);
  }
  writeFileSync(envPath, nextEnvContent, 'utf8');
}

function runInteractive(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function getGitHubSecretNames(repo: string) {
  const result = runCommand('gh', [
    'secret',
    'list',
    '--repo',
    repo,
    '--app',
    'actions',
    '--json',
    'name',
  ]);
  if (!result.ok) {
    return new Set<string>();
  }

  const parsed = parseJsonOutput<Array<{ name?: string }>>(result) ?? [];
  return new Set(parsed.flatMap((entry) => (entry.name ? [entry.name] : [])));
}

function setGitHubSecret(repo: string, name: string, value: string) {
  ensureOk(
    runCommand('gh', ['secret', 'set', name, '--repo', repo, '--app', 'actions', '--body', value]),
    `Failed to set GitHub Actions secret ${name}`,
  );
}

function getConvexProdEnv() {
  try {
    return parseConvexEnvList(convexEnvList(true));
  } catch {
    return null;
  }
}

function getDefaultBranch(repo?: string) {
  if (repo) {
    const ghResult = runCommand('gh', [
      'repo',
      'view',
      repo,
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ]);
    if (ghResult.ok) {
      const branch = ghResult.stdout.trim();
      if (branch) {
        return branch;
      }
    }
  }

  const remoteHead = runCommand('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead.ok) {
    const branch = remoteHead.stdout.trim().replace(/^origin\//u, '');
    if (branch) {
      return branch;
    }
  }

  const localBranch = runCommand('git', ['branch', '--show-current']);
  if (localBranch.ok && localBranch.stdout.trim()) {
    return localBranch.stdout.trim();
  }

  return 'main';
}

function createIamAccessKey(userName: string, region: string) {
  const createdKey = parseJsonOutput<{
    AccessKey?: { AccessKeyId?: string; SecretAccessKey?: string };
  }>(
    runCommand('aws', ['iam', 'create-access-key', '--user-name', userName, '--output', 'json'], {
      env: { AWS_REGION: region },
    }),
  );

  return {
    accessKeyId: createdKey?.AccessKey?.AccessKeyId ?? '',
    secretAccessKey: createdKey?.AccessKey?.SecretAccessKey ?? '',
  };
}

function deleteIamAccessKey(userName: string, accessKeyId: string, region: string) {
  ensureOk(
    runCommand(
      'aws',
      ['iam', 'delete-access-key', '--user-name', userName, '--access-key-id', accessKeyId],
      {
        env: { AWS_REGION: region },
      },
    ),
    `Failed to delete IAM access key ${accessKeyId}`,
  );
}

function printSummary(summary: SetupSummary, json: boolean) {
  if (json) {
    emitStructuredOutput({
      ...summary,
      readiness: {
        backup: summary.backupLane,
        backend: summary.backendLane,
        frontend: summary.frontendLane,
        workflowTest: summary.workflowTested ? 'triggered' : 'not triggered',
      },
    });
    return;
  }

  printSection('Completed');
  if (summary.completed.length === 0) {
    console.log('- No automated steps completed.');
  } else {
    for (const line of summary.completed) {
      console.log(`- ${line}`);
    }
  }

  printSection('Needs Attention');
  if (summary.needsAttention.length === 0) {
    console.log('- None.');
  } else {
    for (const line of summary.needsAttention) {
      console.log(`- ${line}`);
    }
  }

  printSection('Readiness');
  console.log(`- Backup DR: ${summary.backupLane}`);
  console.log(`- Backend failover DR: ${summary.backendLane}`);
  console.log(`- Frontend failover DR: ${summary.frontendLane}`);
  console.log(`- Backup workflow drill: ${summary.workflowTested ? 'triggered' : 'not triggered'}`);

  if (summary.warnings.length > 0) {
    printSection('Warnings');
    for (const warning of summary.warnings) {
      console.log(`- ${warning}`);
    }
  }

  printSection('Next Recovery Test');
  for (const line of summary.nextCommands) {
    console.log(`- ${line}`);
  }
}

function buildRecoveryCommandForContext(context: SetupContext, backupBucketName: string) {
  const parts = [
    `AWS_DR_HOSTNAME_STRATEGY=${quoteShell(context.hostnameStrategy)}`,
    `AWS_DR_BACKUP_S3_BUCKET=${quoteShell(backupBucketName)}`,
  ];

  if (context.domain) {
    parts.push(`AWS_DR_DOMAIN=${quoteShell(context.domain)}`);
  }

  return `${parts.join(' ')} ./infra/aws-cdk/scripts/dr-recover-ecs.sh`;
}

function buildDrOrigins(
  context: SetupContext,
  ecsOutputs?: StackOutputs | null,
  netlifySite?: NetlifySite | null,
) {
  if (context.hostnameStrategy === 'custom-domain' && context.domain) {
    return {
      backendOrigin: `https://${context.backendSubdomain}.${context.domain}`,
      frontendOrigin: `https://${context.frontendSubdomain}.${context.domain}`,
      siteOrigin: `https://${context.siteSubdomain}.${context.domain}`,
    };
  }

  const frontendOrigin = netlifySite?.sslUrl ?? netlifySite?.url;
  const backendOrigin = ecsOutputs?.ConvexBackendUrl;
  const siteOrigin = ecsOutputs?.ConvexSiteUrl;
  if (!frontendOrigin || !backendOrigin || !siteOrigin) {
    return null;
  }

  return {
    backendOrigin,
    frontendOrigin,
    siteOrigin,
  };
}

async function requireInputOrPrompt(
  label: string,
  providedValue: string | undefined,
  yes: boolean,
) {
  if (providedValue?.trim()) {
    return providedValue.trim();
  }

  if (yes) {
    throw new Error(`${label} is required when running with --yes.`);
  }

  return await ask(`${label}: `);
}

async function main() {
  const flags = parseSetupDrArgs(process.argv.slice(2));
  if (flags.help) {
    printUsage();
    return;
  }

  console.log('🛟 Guided disaster recovery setup');
  console.log('');
  console.log('This flow discovers your current state, asks for the missing DR inputs once,');
  console.log(
    'and then automates the backup, backend failover, GitHub workflow, and Netlify setup',
  );
  console.log('where the required CLIs and auth are already available.');
  console.log('');
  console.log(
    'Prereqs for the full path: node, pnpm, git, aws, Convex access; plus gh/netlify for the optional hosted integrations.',
  );
  console.log(
    'Modifies: local env defaults, AWS stacks/resources, GitHub secrets/workflows, Netlify DR site/env, and DR helper secrets.',
  );
  console.log(
    'Safe to rerun: yes with care; deployment/update steps are idempotent, but they operate on real DR infrastructure.\n',
  );

  const summary: SetupSummary = {
    backendLane: 'blocked',
    backupLane: 'blocked',
    completed: [],
    frontendLane: flags.skipNetlify ? 'partial' : 'blocked',
    needsAttention: [],
    nextCommands: [],
    warnings: [],
    workflowTested: false,
  };

  printSection('Step 1: Preflight checks');
  const requiredMissing = findMissingCommands([
    { cmd: 'node', hint: CLI_INSTALL_HINT.node },
    { cmd: 'pnpm' },
    { cmd: 'git' },
    { cmd: 'aws' },
  ]);
  if (requiredMissing.length > 0) {
    printMissingCliSummary('Missing required CLIs', requiredMissing);
    process.exit(1);
  }
  requireCommands([
    { cmd: 'node', hint: CLI_INSTALL_HINT.node },
    { cmd: 'pnpm' },
    { cmd: 'git' },
    { cmd: 'aws' },
  ]);
  requirePnpmAndConvexCli();

  console.log('Required CLIs: node, pnpm, git, aws, convex (pnpm exec) — OK\n');
  console.log('Optional / feature-dependent:');
  for (const [binary, ok] of [
    ['gh', commandOnPath('gh')],
    ['jq', commandOnPath('jq')],
    ['curl', commandOnPath('curl')],
    ['netlify', commandOnPath('netlify')],
  ] as const) {
    const hint =
      binary === 'gh'
        ? 'install and run `gh auth login` for GitHub workflow/secret automation'
        : binary === 'netlify'
          ? 'install and run `netlify login` for DR frontend automation'
          : binary === 'jq'
            ? 'install for shell-based JSON helpers used in some recovery helpers'
            : 'install for webhook/build helper flows';
    console.log(`- ${binary}: ${ok ? 'found' : `missing (${hint})`}`);
  }
  console.log('');

  const envPath = path.join(process.cwd(), '.env.local');
  const drEnvPath = path.join(process.cwd(), DR_ENV_FILE_NAME);
  const envContent = readEnvFile(envPath);
  const drEnvContent = readEnvFile(drEnvPath);
  const awsRegionFromEnv =
    readEnvValue(envContent, 'AWS_REGION') ??
    readEnvValue(drEnvContent, 'AWS_REGION') ??
    process.env.AWS_REGION?.trim() ??
    process.env.AWS_DEFAULT_REGION?.trim() ??
    'us-west-1';
  const selectedAwsProfile = await chooseAwsProfile(
    readEnvValue(envContent, 'AWS_PROFILE') ?? process.env.AWS_PROFILE?.trim() ?? null,
  );

  process.env.AWS_REGION = awsRegionFromEnv;
  process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION?.trim() || awsRegionFromEnv;
  if (selectedAwsProfile) {
    process.env.AWS_PROFILE = selectedAwsProfile;
  }

  if (existsSync(envPath)) {
    let nextEnvContent = envContent;
    nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_REGION', awsRegionFromEnv);
    if (selectedAwsProfile) {
      nextEnvContent = upsertEnvValue(nextEnvContent, 'AWS_PROFILE', selectedAwsProfile);
    }
    writeFileSync(envPath, nextEnvContent, 'utf8');
  }

  const envrcPath = writeDirenvFile({
    awsProfile: selectedAwsProfile ?? undefined,
    awsRegion: awsRegionFromEnv,
  });
  console.log(`- AWS region: ${awsRegionFromEnv}`);
  console.log(`- AWS profile: ${selectedAwsProfile ?? 'current shell/default'}`);
  console.log(`- Repo direnv file: ${envrcPath}`);

  const awsAuth = runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
    env: { AWS_REGION: getAwsRegion() },
  }).ok;
  const ghAuth = commandOnPath('gh') && runCommand('gh', ['auth', 'status']).ok;
  const netlifyAuth = commandOnPath('netlify') && runCommand('netlify', ['status', '--json']).ok;
  const convexProdEnv = getConvexProdEnv();
  const identity = getAwsIdentity(awsAuth);
  const cdkBootstrap =
    awsAuth && identity.accountId && identity.region
      ? hasHealthyCdkBootstrap(identity.accountId, identity.region)
      : null;

  console.log(`- AWS auth: ${awsAuth ? 'ready' : 'not ready'}`);
  console.log(`- GitHub auth: ${ghAuth ? 'ready' : 'not ready'}`);
  console.log(`- Netlify auth: ${netlifyAuth ? 'ready' : 'not ready'}`);
  printStatusSummary('Provider readiness', [
    { label: 'AWS', value: awsAuth ? 'ready' : 'run `aws configure` or export AWS credentials' },
    {
      label: 'GitHub',
      value: commandOnPath('gh')
        ? ghAuth
          ? 'ready'
          : 'run `gh auth login` for workflow and secret automation'
        : CLI_INSTALL_HINT.gh,
    },
    {
      label: 'Netlify',
      value: commandOnPath('netlify')
        ? netlifyAuth
          ? 'ready'
          : 'run `netlify login` for DR frontend automation'
        : CLI_INSTALL_HINT.netlify,
    },
  ]);
  console.log(`- Convex prod access: ${convexProdEnv ? 'ready' : 'not ready'}`);
  if (cdkBootstrap) {
    console.log(
      `- CDK bootstrap: ${cdkBootstrap.ok ? 'ready' : `missing (${cdkBootstrap.bucketName})`}`,
    );
  }
  const gitRemote = runCommand('git', ['config', '--get', 'remote.origin.url']).stdout.trim();
  const discoveredRepo = flags.githubRepo ?? parseGitHubRepoFromRemote(gitRemote) ?? undefined;
  const linkedNetlifySiteId = readNetlifyLinkedSiteIdFromDisk();
  const linkedNetlifySite = linkedNetlifySiteId ? resolveNetlifySite(linkedNetlifySiteId) : null;
  const linkedNetlifySiteDetails = linkedNetlifySiteId
    ? getNetlifySiteDetails(linkedNetlifySiteId)
    : null;
  const defaultBranch = getDefaultBranch(discoveredRepo);
  const storageCoverageWarning = convexProdEnv ? getStorageCoverageWarning(convexProdEnv) : null;
  if (storageCoverageWarning) {
    summary.warnings.push(storageCoverageWarning);
  }

  printSection('Step 2: Discovery');
  console.log(`- Git remote: ${gitRemote || 'not configured'}`);
  console.log(`- GitHub repo: ${discoveredRepo ?? 'not detected'}`);
  console.log(
    `- Linked Netlify site: ${formatNetlifySiteSummary(linkedNetlifySite) ?? linkedNetlifySiteId ?? 'not linked'}`,
  );
  if (linkedNetlifySite || linkedNetlifySiteId) {
    console.log('  This is the currently linked app site, not the dedicated DR frontend site.');
  }
  console.log(
    `- Production storage mode: ${convexProdEnv?.FILE_STORAGE_BACKEND ?? 'convex (default or unknown)'}`,
  );
  console.log(`- Default branch: ${defaultBranch}`);

  const backupStackOutputs =
    awsAuth && identity.region ? getStackOutputs(getDrBackupStackName(), identity.region) : null;
  const ecsStackOutputs =
    awsAuth && identity.region ? getStackOutputs(getDrEcsStackName(), identity.region) : null;

  if (backupStackOutputs?.DrBackupBucketName) {
    console.log(`- Existing DR backup bucket: ${backupStackOutputs.DrBackupBucketName}`);
  }
  if (ecsStackOutputs?.ConvexBackendUrl) {
    console.log(`- Existing DR backend: ${ecsStackOutputs.ConvexBackendUrl}`);
  }
  if (identity.accountId || identity.arn || identity.region) {
    console.log(`- Resolved AWS account: ${identity.accountId ?? 'unknown'}`);
    console.log(`- Resolved AWS ARN: ${identity.arn ?? 'unknown'}`);
    console.log(`- Resolved AWS region: ${identity.region ?? 'unknown'}`);
    if (selectedAwsProfile) {
      console.log(`- Resolved AWS profile: ${selectedAwsProfile}`);
    }
  }
  if (flags.plan) {
    const planSummary = {
      mode: 'plan',
      changedLocally: [
        'Would update .env.local AWS_REGION/AWS_PROFILE when present',
        'Would refresh .envrc for repo-local AWS defaults',
      ],
      changedRemotely: [
        flags.skipGithub
          ? 'GitHub DR wiring skipped'
          : 'Would update GitHub DR secrets/workflows as needed',
        flags.skipNetlify
          ? 'Netlify DR setup skipped'
          : 'Would reconcile dedicated DR Netlify site/env/build hook',
        flags.skipEcs ? 'DR ECS deploy skipped' : 'Would preview/deploy DR ECS stack as confirmed',
        'Would reconcile DR Secrets Manager entries and backup stack as confirmed',
      ],
      nextCommands: ['pnpm run dr:setup', 'pnpm run dr:netlify:setup'],
      targets: {
        repo: discoveredRepo ?? null,
        linkedNetlifySite: formatNetlifySiteSummary(linkedNetlifySite),
        awsRegion: awsRegionFromEnv,
        awsProfile: selectedAwsProfile ?? null,
        defaultBranch,
      },
    };
    if (flags.json) {
      emitStructuredOutput(planSummary);
    } else {
      printSection('Plan');
      console.log('Changed locally:');
      for (const line of planSummary.changedLocally) {
        console.log(`- ${line}`);
      }
      console.log('Changed remotely:');
      for (const line of planSummary.changedRemotely) {
        console.log(`- ${line}`);
      }
      console.log('Next commands:');
      for (const line of planSummary.nextCommands) {
        console.log(`- ${line}`);
      }
    }
    return;
  }

  printSection('Step 3: Collect configuration');
  console.log('The DR frontend Netlify site can be created automatically later in this flow.');
  const defaultProjectSlug =
    flags.projectSlug ??
    readEnvValue(drEnvContent, 'AWS_DR_PROJECT_SLUG') ??
    discoveredRepo?.split('/')[1] ??
    'tanstack-start-template';
  const projectSlug = flags.yes
    ? defaultProjectSlug
    : await askWithDefault('Project slug for DR resources', defaultProjectSlug);
  const hostnameStrategy = await chooseHostnameStrategy(
    flags.hostnameStrategy ??
      (readEnvValue(drEnvContent, 'AWS_DR_HOSTNAME_STRATEGY') as DrHostnameStrategy | null) ??
      'provider-hostnames',
    flags.yes,
  );
  const needsCustomDomain =
    hostnameStrategy === 'custom-domain' && !(flags.skipEcs && flags.skipNetlify);
  if (hostnameStrategy === 'custom-domain') {
    console.log('Custom-domain mode will derive DR hostnames such as:');
    console.log('  - dr.example.com');
    console.log('  - dr-backend.example.com');
    console.log('  - dr-site.example.com');
  } else {
    console.log('Provider-hostnames mode will use Netlify and AWS-generated URLs directly.');
    console.log('No custom DNS or Cloudflare setup is required in this mode.');
  }
  const defaultDomain =
    flags.domain ?? readEnvValue(drEnvContent, 'AWS_DR_DOMAIN') ?? process.env.AWS_DR_DOMAIN ?? '';
  const domain = needsCustomDomain
    ? await requireInputOrPrompt(
        'Base domain for DR hostnames (example.com)',
        defaultDomain,
        flags.yes,
      )
    : undefined;
  const defaultBucketName =
    backupStackOutputs?.DrBackupBucketName ??
    buildDefaultBackupBucketName(projectSlug, identity.accountId, identity.region);
  const backupBucketName = flags.yes
    ? defaultBucketName
    : await askWithDefault('S3 bucket for Convex DR exports', defaultBucketName);
  const backendSubdomain =
    hostnameStrategy === 'custom-domain'
      ? flags.yes
        ? 'dr-backend'
        : await askWithDefault('DR backend subdomain', 'dr-backend')
      : 'dr-backend';
  const siteSubdomain =
    hostnameStrategy === 'custom-domain'
      ? flags.yes
        ? 'dr-site'
        : await askWithDefault('DR Convex site subdomain', 'dr-site')
      : 'dr-site';
  const frontendSubdomain =
    hostnameStrategy === 'custom-domain'
      ? flags.yes
        ? 'dr'
        : await askWithDefault('DR frontend subdomain', 'dr')
      : 'dr';
  const githubRepo = flags.skipGithub
    ? undefined
    : await requireInputOrPrompt('GitHub repository (owner/name)', discoveredRepo, flags.yes);
  const setupCloudflareNow =
    hostnameStrategy !== 'custom-domain'
      ? false
      : flags.skipCloudflare
        ? false
        : flags.yes
          ? false
          : await askYesNo('Configure Cloudflare DNS automation secrets now?', false);
  const setupNetlifyNow = flags.skipNetlify
    ? false
    : flags.yes
      ? true
      : await askYesNo('Create or validate a dedicated Netlify DR frontend site now?', true);
  const runWorkflowTest = flags.skipGithub
    ? false
    : flags.yes
      ? true
      : await askYesNo('Trigger the backup workflow once after configuration?', true);
  const useDefaultSizing = flags.skipEcs
    ? true
    : flags.yes
      ? true
      : await askYesNo('Use the default ECS sizing for the DR backend?', true);
  const ecsCpu = useDefaultSizing ? '2048' : await askWithDefault('ECS CPU units', '2048');
  const ecsMemoryMiB = useDefaultSizing ? '4096' : await askWithDefault('ECS memory (MiB)', '4096');

  const context: SetupContext = {
    backendSubdomain,
    backupBucketName,
    domain,
    ecsCpu,
    ecsMemoryMiB,
    frontendSubdomain,
    hostnameStrategy,
    githubRepo,
    netlifySiteInput: flags.netlifySite,
    projectSlug,
    runWorkflowTest,
    setupCloudflareNow,
    setupNetlifyNow,
    siteSubdomain,
  };

  persistDrConfig(drEnvPath, readEnvFile(drEnvPath), context);
  cleanupLegacyDrConfig(envPath, readEnvFile(envPath));
  summary.completed.push(`Persisted DR defaults into ${DR_ENV_FILE_NAME} for later dr:* commands.`);

  if (awsAuth && identity.accountId && identity.region && !cdkBootstrap?.ok) {
    throw new Error(
      `CDK bootstrap is not healthy in ${identity.accountId}/${identity.region}. Expected bootstrap bucket ${cdkBootstrap?.bucketName ?? 'unknown'}.\nRun: AWS_PROFILE=${selectedAwsProfile ?? 'default'} AWS_REGION=${identity.region} pnpm exec cdk bootstrap aws://${identity.accountId}/${identity.region}`,
    );
  }

  printSection('Step 4: Confirm external changes');
  console.log('- Backup stack preview/deploy');
  console.log(`- GitHub Actions secret updates${githubRepo ? ` for ${githubRepo}` : ''}`);
  console.log(`- Netlify DR site setup${setupNetlifyNow ? '' : ' (deferred)'}`);
  console.log(`- DR ECS stack deploy${flags.skipEcs ? ' (skipped)' : ''}`);
  console.log('- Secrets Manager secret sync/update');
  if (hostnameStrategy === 'custom-domain') {
    console.log(`- Cloudflare DNS automation${setupCloudflareNow ? '' : ' (deferred)'}`);
  }

  if (!flags.yes) {
    const shouldContinue = await askYesNo('Proceed with DR setup?', true);
    if (!shouldContinue) {
      console.log('Setup cancelled.');
      return;
    }
  }

  const drEnv = createDrCommandEnv(context, identity);
  const secretNames = buildDrSecretNames(projectSlug);

  printSection('Step 5: Deploy backup stack');
  if (!awsAuth || !identity.region) {
    summary.needsAttention.push('AWS auth is not ready, so the DR backup stack was not deployed.');
  } else {
    runInteractive('pnpm', ['run', 'dr:backup:preview'], drEnv);
    const deployBackup = flags.yes
      ? true
      : await askYesNo('Deploy or update the DR backup stack now?', true);
    if (deployBackup) {
      runInteractive('pnpm', ['run', 'dr:backup:deploy'], drEnv);
      summary.completed.push('Deployed the DR backup stack.');
      summary.backupLane = 'partial';
    } else {
      summary.needsAttention.push('DR backup stack deploy was skipped.');
    }
  }

  const freshBackupOutputs =
    awsAuth && identity.region ? getStackOutputs(getDrBackupStackName(), identity.region) : null;

  printSection('Step 6: Configure GitHub workflow readiness');
  if (flags.skipGithub) {
    summary.warnings.push('GitHub workflow setup was skipped with --skip-github.');
  } else if (!ghAuth || !githubRepo) {
    summary.needsAttention.push(
      'GitHub auth or repository discovery is missing, so Actions secrets were not configured.',
    );
  } else {
    const secretNamesInRepo = getGitHubSecretNames(githubRepo);

    if (!freshBackupOutputs?.DrBackupCiUserName) {
      summary.needsAttention.push(
        'The DR backup stack did not expose the CI IAM user name needed for GitHub secrets.',
      );
    } else if (awsAuth && identity.region) {
      const userName = freshBackupOutputs.DrBackupCiUserName;
      const listedKeys = runCommand(
        'aws',
        [
          'iam',
          'list-access-keys',
          '--user-name',
          userName,
          '--query',
          'AccessKeyMetadata[].AccessKeyId',
          '--output',
          'json',
        ],
        {
          env: { AWS_REGION: identity.region },
        },
      );
      const existingKeys = parseJsonOutput<string[]>(listedKeys) ?? [];
      let accessKeyId = '';
      let secretAccessKey = '';

      if (existingKeys.length === 0) {
        const shouldCreateKey = flags.yes
          ? true
          : await askYesNo(`Create a GitHub Actions access key for IAM user ${userName}?`, true);
        if (shouldCreateKey) {
          const createdKey = createIamAccessKey(userName, identity.region);
          accessKeyId = createdKey.accessKeyId;
          secretAccessKey = createdKey.secretAccessKey;
          if (accessKeyId && secretAccessKey) {
            context.createdAwsAccessKey = { accessKeyId, secretAccessKey };
            summary.completed.push(`Created a fresh IAM access key for ${userName}.`);
          }
        }
      } else {
        console.log(`- Existing IAM access keys found for ${userName}: ${existingKeys.join(', ')}`);
        if (!flags.yes) {
          const shouldRotateKey = await askYesNo(
            `Create a fresh GitHub Actions key for ${userName} now?`,
            true,
          );
          if (shouldRotateKey) {
            if (existingKeys.length >= 2) {
              const keyToDelete = await askWithDefault(
                'AWS access key id to delete before creating a new one',
                existingKeys[0] ?? '',
              );
              if (existingKeys.includes(keyToDelete)) {
                const confirmDelete = await askYesNo(
                  `Delete IAM access key ${keyToDelete} to free a slot?`,
                  false,
                );
                if (confirmDelete) {
                  deleteIamAccessKey(userName, keyToDelete, identity.region);
                  summary.completed.push(`Deleted IAM access key ${keyToDelete} for ${userName}.`);
                }
              }
            }

            const refreshedKeys =
              parseJsonOutput<string[]>(
                runCommand(
                  'aws',
                  [
                    'iam',
                    'list-access-keys',
                    '--user-name',
                    userName,
                    '--query',
                    'AccessKeyMetadata[].AccessKeyId',
                    '--output',
                    'json',
                  ],
                  {
                    env: { AWS_REGION: identity.region },
                  },
                ),
              ) ?? [];

            if (refreshedKeys.length < 2) {
              const createdKey = createIamAccessKey(userName, identity.region);
              accessKeyId = createdKey.accessKeyId;
              secretAccessKey = createdKey.secretAccessKey;
              if (accessKeyId && secretAccessKey) {
                context.createdAwsAccessKey = { accessKeyId, secretAccessKey };
                summary.completed.push(`Created a rotated IAM access key for ${userName}.`);
              }
            } else {
              summary.needsAttention.push(
                `IAM user ${userName} still has two access keys, so setup could not create a fresh GitHub Actions key automatically.`,
              );
            }
          } else {
            accessKeyId = await ask('AWS access key id for GitHub Actions (leave empty to skip): ');
            if (accessKeyId) {
              secretAccessKey = await ask('AWS secret access key for GitHub Actions: ');
            }
          }
        }
      }

      if (accessKeyId && secretAccessKey) {
        setGitHubSecret(githubRepo, 'AWS_DR_BACKUP_ACCESS_KEY_ID', accessKeyId);
        setGitHubSecret(githubRepo, 'AWS_DR_BACKUP_SECRET_ACCESS_KEY', secretAccessKey);
        setGitHubSecret(githubRepo, 'AWS_DR_BACKUP_REGION', identity.region);
        setGitHubSecret(
          githubRepo,
          'AWS_DR_BACKUP_S3_BUCKET',
          freshBackupOutputs?.DrBackupBucketName ?? backupBucketName,
        );
        summary.completed.push('Configured AWS DR backup secrets in GitHub Actions.');
      } else if (
        !secretNamesInRepo.has('AWS_DR_BACKUP_ACCESS_KEY_ID') ||
        !secretNamesInRepo.has('AWS_DR_BACKUP_SECRET_ACCESS_KEY')
      ) {
        summary.needsAttention.push(
          'GitHub Actions still needs AWS DR backup credentials. Rerun dr:setup and provide the key pair, or add the secrets manually.',
        );
      }
    }

    if (!secretNamesInRepo.has('CONVEX_DEPLOY_KEY')) {
      if (flags.yes) {
        summary.needsAttention.push(
          'CONVEX_DEPLOY_KEY is missing in GitHub Actions and cannot be auto-generated from this script.',
        );
      } else {
        const deployKey = await ask(
          'Convex production deploy key for GitHub Actions (leave empty to keep manual): ',
        );
        if (deployKey) {
          if (!isLikelyConvexDeployKey(deployKey)) {
            summary.needsAttention.push(
              'The provided CONVEX_DEPLOY_KEY does not look like a production deploy key.',
            );
          }
          setGitHubSecret(githubRepo, 'CONVEX_DEPLOY_KEY', deployKey);
          context.convexDeployKey = deployKey;
          setGitHubSecret(
            githubRepo,
            'DR_TEST_APP_NAME',
            `${convexProdEnv?.APP_NAME ?? 'TanStack Start Template'} DR Test`,
          );
          setGitHubSecret(
            githubRepo,
            'DR_TEST_BETTER_AUTH_SECRET',
            randomBytes(32).toString('hex'),
          );
          setGitHubSecret(githubRepo, 'DR_TEST_BETTER_AUTH_URL', 'http://127.0.0.1:3000');
          setGitHubSecret(githubRepo, 'DR_TEST_CONVEX_SITE_URL', 'http://127.0.0.1:3211');
          setGitHubSecret(githubRepo, 'DR_TEST_JWKS', convexProdEnv?.JWKS ?? '{"keys":[]}');
          summary.completed.push('Configured Convex deploy and DR test secrets in GitHub Actions.');
        } else {
          summary.needsAttention.push('CONVEX_DEPLOY_KEY is still missing from GitHub Actions.');
        }
      }
    }

    if (context.runWorkflowTest) {
      const workflowRun = runCommand('gh', [
        'workflow',
        'run',
        'dr-backup-convex-s3.yml',
        '--repo',
        githubRepo,
      ]);
      if (workflowRun.ok) {
        summary.completed.push('Triggered the weekly DR backup workflow once.');
        const latestRun = runCommand('gh', [
          'run',
          'list',
          '--repo',
          githubRepo,
          '--workflow',
          'dr-backup-convex-s3.yml',
          '--event',
          'workflow_dispatch',
          '--limit',
          '1',
          '--json',
          'url,status',
        ]);
        const latestParsed = parseJsonOutput<Array<{ status?: string; url?: string }>>(latestRun);
        if (latestParsed?.[0]?.url) {
          summary.completed.push(`Latest workflow run: ${latestParsed[0].url}`);
        }
        summary.workflowTested = true;
      } else {
        summary.needsAttention.push(
          'The backup workflow trigger failed. Verify GitHub auth and workflow permissions.',
        );
      }
    }

    if (summary.needsAttention.every((item) => !item.includes('GitHub Actions'))) {
      summary.backupLane = summary.workflowTested ? 'ready' : 'partial';
    }
  }

  printSection('Step 7: Create or validate the Netlify DR site');
  let drNetlifySite: NetlifySite | null = null;
  let netlifyRequiredEnvConfigured = false;
  let netlifyConvexDeployKeyReady = false;
  let netlifyDeployKeyDeferredUntilRecovery = false;
  if (flags.skipNetlify) {
    summary.frontendLane = 'partial';
    summary.warnings.push('Netlify DR setup was skipped with --skip-netlify.');
  } else if (!netlifyAuth) {
    summary.frontendLane = 'blocked';
    summary.needsAttention.push(
      'Netlify auth is not ready, so the DR frontend was not configured.',
    );
  } else if (!context.setupNetlifyNow) {
    summary.frontendLane = 'partial';
    summary.warnings.push('Dedicated Netlify DR site setup was deferred.');
  } else {
    if (context.netlifySiteInput) {
      drNetlifySite = resolveNetlifySite(context.netlifySiteInput);
    }

    if (!drNetlifySite && !flags.yes) {
      const existingInput = await ask(
        'Existing Netlify DR site id or name (leave empty and the script will create a dedicated DR site automatically): ',
      );
      if (existingInput) {
        drNetlifySite = resolveNetlifySite(existingInput);
      }
    }

    if (!drNetlifySite) {
      const desiredSiteName = `${projectSlug}-dr`;
      if (linkedNetlifySiteDetails?.buildSettings?.repo_url) {
        drNetlifySite = createRepoBackedNetlifySite({
          desiredName: desiredSiteName,
          primarySite: linkedNetlifySiteDetails,
        });
      }
      if (!drNetlifySite && linkedNetlifySiteDetails) {
        drNetlifySite = resolveNetlifySite(desiredSiteName);
      }
      if (drNetlifySite) {
        summary.completed.push(`Created or resolved Netlify DR site ${drNetlifySite.name}.`);
        console.log(
          `- Netlify DR site: ${formatNetlifySiteSummary(drNetlifySite) ?? drNetlifySite.name}`,
        );
        console.log('- Next: mirror the primary site repo/build settings onto the DR site.');
      }
    }

    if (!drNetlifySite) {
      console.log(
        '- Netlify DR site: automatic creation failed. The rest of the setup can continue, but the frontend DR lane will remain partial until a dedicated site exists.',
      );
      summary.frontendLane = 'partial';
      summary.needsAttention.push(
        'Could not create or resolve the dedicated Netlify DR site automatically. Provide --netlify-site on the next run or configure it manually.',
      );
    } else {
      let deployKeyForNetlify = '';
      let awsSecretDeployKeyForNetlify = '';
      if (awsAuth && identity.region) {
        awsSecretDeployKeyForNetlify =
          getAwsSecretValue(secretNames.convexAdminKey, identity.region)?.trim() ?? '';
        deployKeyForNetlify = awsSecretDeployKeyForNetlify;
      }
      if (!deployKeyForNetlify) {
        const existingNetlifyDeployKey = getNetlifySiteEnvValue(
          drNetlifySite.id,
          'CONVEX_DEPLOY_KEY',
        );
        if (existingNetlifyDeployKey?.trim()) {
          netlifyConvexDeployKeyReady = true;
          deployKeyForNetlify = existingNetlifyDeployKey.trim();
        } else if (awsAuth && identity.region) {
          netlifyDeployKeyDeferredUntilRecovery = true;
          summary.warnings.push(
            'The DR Netlify site does not have a self-hosted Convex admin token yet. That token is generated during recovery, so this part of the frontend setup is deferred until after the first recovery drill.',
          );
        } else if (!flags.yes) {
          deployKeyForNetlify = await ask(
            'Convex admin/deploy auth token for the DR Netlify site (leave empty to keep frontend DR partial): ',
          );
        }
      }

      if (deployKeyForNetlify) {
        if (!isLikelyConvexDeployKey(deployKeyForNetlify)) {
          if (awsSecretDeployKeyForNetlify) {
            summary.needsAttention.push(
              `Secrets Manager secret ${secretNames.convexAdminKey} does not contain a valid Convex admin/deploy auth token. Rerun ./infra/aws-cdk/scripts/dr-recover-ecs.sh after fixing admin-key generation.`,
            );
          } else {
            summary.needsAttention.push(
              'The provided Netlify CONVEX_DEPLOY_KEY does not look like a valid Convex admin/deploy auth token.',
            );
          }
        } else {
          try {
            setNetlifySiteEnvVar(drNetlifySite.id, 'CONVEX_DEPLOY_KEY', deployKeyForNetlify);
            netlifyConvexDeployKeyReady = true;
          } catch (error) {
            summary.needsAttention.push(
              `Failed to set Netlify CONVEX_DEPLOY_KEY automatically: ${(error as Error).message}`,
            );
          }
        }
      }

      if (!netlifyConvexDeployKeyReady && !netlifyDeployKeyDeferredUntilRecovery) {
        summary.needsAttention.push(
          'Netlify DR is still missing a validated CONVEX_DEPLOY_KEY, so the frontend build is not fully ready.',
        );
      }

      if (linkedNetlifySiteDetails?.buildSettings?.repo_url) {
        console.log(
          '- Reinitializing the DR site continuous deployment with `netlify init --forceReinitialize`',
        );
        const repoConfigured = reinitializeNetlifySiteContinuousDeployment({
          authToken: process.env.NETLIFY_AUTH_TOKEN,
          gitRemoteName: GIT_REMOTE_NAME,
          siteId: drNetlifySite.id,
        });
        if (repoConfigured.ok) {
          drNetlifySite = repoConfigured.site ?? drNetlifySite;
          console.log('- Connected the DR site to the repo via the official Netlify CLI flow');
          summary.completed.push(
            'Connected the DR Netlify site to the repo using the official Netlify CLI continuous deployment flow.',
          );
        } else {
          console.log('- Could not connect the DR site to the repo automatically');
          summary.needsAttention.push(
            `Could not connect the DR Netlify site to the repo automatically with \`netlify init --forceReinitialize\`. Complete the repository link in Netlify manually.${repoConfigured.error ? ` ${repoConfigured.error}` : ''}`,
          );
        }
      } else {
        console.log(
          '- Primary site repo/build metadata was missing, so repo-backed DR setup could not be mirrored automatically',
        );
        summary.needsAttention.push(
          'The linked primary Netlify site is missing repo/build metadata, so the DR site could not be configured as a repo-backed build automatically.',
        );
      }

      const drNetlifySiteDetails = getNetlifySiteDetails(drNetlifySite.id);
      if (!isNetlifySiteRepoBacked(drNetlifySiteDetails)) {
        summary.frontendLane = 'partial';
        summary.needsAttention.push(
          'The dedicated Netlify DR site exists, but it is still not connected to the repo/build settings. Open Netlify and connect the DR site to the same repository before relying on frontend failover.',
        );
      } else if (drNetlifySiteDetails) {
        drNetlifySite = drNetlifySiteDetails;
      }

      let buildHookUrl =
        listNetlifySiteHooks(drNetlifySite.id).find((hook) => hook.url)?.url ?? null;
      if (!buildHookUrl) {
        buildHookUrl = createNetlifyBuildHook(drNetlifySite.id, 'DR Recovery', defaultBranch);
      }

      if (buildHookUrl && awsAuth && identity.region) {
        upsertAwsSecret(
          secretNames.netlifyBuildHook,
          buildHookUrl,
          identity.region,
          'Netlify DR build hook used by dr-recover-ecs.sh',
        );
        summary.completed.push(
          'Configured the Netlify DR build hook secret in AWS Secrets Manager.',
        );
      } else {
        summary.frontendLane = 'partial';
        summary.needsAttention.push(
          'Could not capture a Netlify build hook automatically. Add the hook URL to AWS Secrets Manager manually.',
        );
      }

      const frontendCnameTarget = extractHostnameFromUrl(
        drNetlifySite.sslUrl ?? drNetlifySite.url ?? '',
      );
      if (frontendCnameTarget && awsAuth && identity.region) {
        context.frontendCnameTarget = frontendCnameTarget;
        upsertAwsSecret(
          secretNames.netlifyFrontendCnameTarget,
          frontendCnameTarget,
          identity.region,
          'Netlify DR frontend hostname used during recovery',
        );
        summary.completed.push(
          `Captured the Netlify DR frontend hostname (${frontendCnameTarget}).`,
        );
      } else {
        summary.frontendLane = 'partial';
        summary.needsAttention.push(
          'Could not determine the Netlify DR frontend hostname automatically.',
        );
      }

      if (drNetlifySite.sslUrl || drNetlifySite.url) {
        summary.completed.push(
          `Netlify DR site URL: ${drNetlifySite.sslUrl ?? drNetlifySite.url ?? drNetlifySite.name}`,
        );
      }

      if (triggerNetlifySiteBuild(drNetlifySite.id).ok) {
        summary.completed.push('Triggered an initial Netlify DR site build.');
      } else {
        summary.warnings.push(
          'The DR Netlify site was configured, but the initial Netlify build could not be triggered automatically.',
        );
      }
    }
  }

  printSection('Step 8: Deploy the DR ECS stack');
  const ecsShouldRun = !flags.skipEcs;
  if (!ecsShouldRun) {
    summary.backendLane = 'partial';
    summary.warnings.push('DR ECS deployment was skipped with --skip-ecs.');
  } else if (
    !awsAuth ||
    !identity.region ||
    (context.hostnameStrategy === 'custom-domain' && !context.domain)
  ) {
    summary.backendLane = 'blocked';
    summary.needsAttention.push(
      context.hostnameStrategy === 'custom-domain'
        ? 'AWS auth or the DR domain is missing, so the DR ECS stack was not deployed.'
        : 'AWS auth is missing, so the DR ECS stack was not deployed.',
    );
  } else {
    runInteractive('pnpm', ['run', 'dr:ecs:preview'], drEnv);
    const deployEcs = flags.yes
      ? true
      : await askYesNo('Deploy or update the DR ECS stack now?', true);
    if (deployEcs) {
      runInteractive('pnpm', ['run', 'dr:ecs:deploy'], drEnv);
      summary.completed.push('Deployed the DR ECS stack.');
      summary.backendLane = 'partial';
    } else {
      summary.needsAttention.push('DR ECS stack deploy was skipped.');
    }
  }

  const postDeployEcsOutputs =
    awsAuth && identity.region ? getStackOutputs(getDrEcsStackName(), identity.region) : null;

  if (drNetlifySite) {
    const drOrigins = buildDrOrigins(context, postDeployEcsOutputs, drNetlifySite);
    if (!drOrigins) {
      summary.frontendLane = 'partial';
      summary.needsAttention.push(
        'The DR backend/site URLs are not available yet, so Netlify DR env vars could not be fully configured.',
      );
    } else {
      const envEntries = Object.entries(
        buildRequiredNetlifyDrEnvVars(convexProdEnv ?? {}, drOrigins),
      );
      netlifyRequiredEnvConfigured = true;

      for (const [key, value] of envEntries) {
        try {
          setNetlifySiteEnvVar(drNetlifySite.id, key, value);
        } catch (error) {
          netlifyRequiredEnvConfigured = false;
          summary.needsAttention.push(
            `Failed to set Netlify env ${key} automatically: ${(error as Error).message}`,
          );
        }
      }

      if (netlifyRequiredEnvConfigured) {
        summary.completed.push('Configured the required Netlify DR runtime env vars.');
      }
    }
  }

  printSection('Step 9: Sync the DR runtime secret');
  if (!awsAuth || !identity.region) {
    console.log('- AWS auth: missing');
    summary.needsAttention.push(
      'AWS auth is not ready, so the DR runtime secret was not synchronized.',
    );
  } else if (!convexProdEnv) {
    console.log('- Convex prod env access: missing');
    summary.needsAttention.push(
      'Convex production env access is not ready, so the DR runtime secret could not be synchronized.',
    );
  } else {
    const requiredRecoveryKeys = getRequiredRecoveryEnvKeys(convexProdEnv);
    const missingRecoveryKeys = requiredRecoveryKeys.filter(
      (key) => !(convexProdEnv[key] ?? '').trim(),
    );
    if (missingRecoveryKeys.length > 0) {
      console.log(
        `- Recovery-critical keys missing from Convex prod: ${missingRecoveryKeys.join(', ')}`,
      );
      summary.needsAttention.push(
        `The Convex production env is missing recovery-critical keys: ${missingRecoveryKeys.join(', ')}.`,
      );
    } else {
      console.log('- Recovery-critical keys present in Convex prod env');
    }

    upsertAwsSecret(
      secretNames.convexEnv,
      JSON.stringify(convexProdEnv, null, 2),
      identity.region,
      'Convex production env vars replayed during DR recovery',
    );
    console.log(`- Synced ${secretNames.convexEnv}`);
    summary.completed.push(`Synchronized ${secretNames.convexEnv} from Convex production env.`);

    if (context.setupCloudflareNow) {
      if (flags.yes) {
        console.log('- Cloudflare DNS automation: requested but deferred in --yes mode');
        summary.needsAttention.push(
          `Cloudflare automation was requested, but the token and zone id must be supplied interactively when not already present. Update ${secretNames.cloudflareDnsToken} and ${secretNames.cloudflareZoneId} manually or rerun without --yes.`,
        );
      } else {
        const cloudflareToken = await ask('Cloudflare DNS API token: ');
        const cloudflareZoneId = await ask('Cloudflare zone id: ');
        if (cloudflareToken && cloudflareZoneId) {
          upsertAwsSecret(
            secretNames.cloudflareDnsToken,
            cloudflareToken,
            identity.region,
            'Cloudflare token used for DR DNS cutover automation',
          );
          upsertAwsSecret(
            secretNames.cloudflareZoneId,
            cloudflareZoneId,
            identity.region,
            'Cloudflare zone id used for DR DNS cutover automation',
          );
          console.log('- Synced Cloudflare DNS automation secrets');
          summary.completed.push('Configured the Cloudflare DNS automation secrets.');
        } else {
          console.log('- Cloudflare DNS automation: incomplete input');
          summary.needsAttention.push(
            'Cloudflare DNS automation was requested, but the token or zone id was left blank.',
          );
        }
      }
    } else {
      console.log('- Cloudflare DNS automation: not requested');
      if (context.hostnameStrategy === 'custom-domain') {
        summary.warnings.push(
          `Cloudflare automation is still optional. Add ${secretNames.cloudflareDnsToken} and ${secretNames.cloudflareZoneId} later if you want automated DNS cutover.`,
        );
      }
    }
  }

  printSection('Step 10: Final readiness validation');
  const finalBackupOutputs =
    awsAuth && identity.region ? getStackOutputs(getDrBackupStackName(), identity.region) : null;
  const finalEcsOutputs =
    awsAuth && identity.region ? getStackOutputs(getDrEcsStackName(), identity.region) : null;
  const hasDrEnvSecret =
    awsAuth && identity.region ? secretExists(secretNames.convexEnv, identity.region) : false;
  const hasBuildHookSecret =
    awsAuth && identity.region
      ? secretExists(secretNames.netlifyBuildHook, identity.region)
      : false;
  const hasFrontendCnameTargetSecret =
    awsAuth && identity.region
      ? secretExists(secretNames.netlifyFrontendCnameTarget, identity.region)
      : false;

  console.log(`- Backup lane: ${summary.backupLane}`);
  console.log(`- Backend lane: ${summary.backendLane}`);
  console.log(`- Frontend lane: ${summary.frontendLane}`);
  console.log(`- DR env secret: ${hasDrEnvSecret ? 'present' : 'missing'}`);
  if (!flags.skipNetlify) {
    console.log(`- Netlify build hook secret: ${hasBuildHookSecret ? 'present' : 'missing'}`);
    console.log(
      `- Netlify frontend hostname secret: ${hasFrontendCnameTargetSecret ? 'present' : 'missing'}`,
    );
  }

  if (finalBackupOutputs?.DrBackupBucketName && summary.backupLane !== 'blocked') {
    summary.backupLane = summary.workflowTested ? 'ready' : 'partial';
  }

  if (finalEcsOutputs?.ConvexBackendUrl && hasDrEnvSecret && summary.backendLane !== 'blocked') {
    summary.backendLane = 'ready';
    summary.completed.push(`DR backend URL: ${finalEcsOutputs.ConvexBackendUrl}`);
    if (finalEcsOutputs.ConvexSiteUrl) {
      summary.completed.push(`DR Convex site URL: ${finalEcsOutputs.ConvexSiteUrl}`);
    }
  }

  if (
    hasBuildHookSecret &&
    hasFrontendCnameTargetSecret &&
    netlifyRequiredEnvConfigured &&
    netlifyConvexDeployKeyReady &&
    summary.frontendLane !== 'blocked'
  ) {
    summary.frontendLane = 'ready';
  }

  if (!drNetlifySite && !flags.skipNetlify) {
    summary.needsAttention.push(
      'A dedicated Netlify DR site still does not exist, so the frontend failover lane is incomplete.',
    );
  } else if (drNetlifySite && summary.frontendLane !== 'ready') {
    summary.needsAttention.push(
      'The dedicated Netlify DR site exists, but its build hook, hostname secret, or required runtime env is still incomplete.',
    );
  }

  if (!hasDrEnvSecret) {
    summary.needsAttention.push(
      `Secrets Manager secret ${secretNames.convexEnv} is still missing.`,
    );
  }
  if (!hasBuildHookSecret && !flags.skipNetlify) {
    summary.needsAttention.push(
      `Secrets Manager secret ${secretNames.netlifyBuildHook} is still missing.`,
    );
  }
  if (!hasFrontendCnameTargetSecret && !flags.skipNetlify) {
    summary.needsAttention.push(
      `Secrets Manager secret ${secretNames.netlifyFrontendCnameTarget} is still missing.`,
    );
  }

  console.log(`- Final backup lane: ${summary.backupLane}`);
  console.log(`- Final backend lane: ${summary.backendLane}`);
  console.log(`- Final frontend lane: ${summary.frontendLane}`);

  summary.nextCommands.push(
    githubRepo
      ? `gh workflow run dr-backup-convex-s3.yml --repo ${githubRepo}`
      : 'gh workflow run dr-backup-convex-s3.yml --repo <owner/repo>',
  );
  const recoveryCommand = buildRecoveryCommandForContext(
    context,
    finalBackupOutputs?.DrBackupBucketName ?? backupBucketName,
  );
  summary.nextCommands.push(recoveryCommand);

  if (
    !flags.json &&
    !flags.yes &&
    summary.backendLane === 'ready' &&
    summary.backupLane !== 'blocked'
  ) {
    printSection('Step 11: Optional recovery run');
    const shouldRunRecoveryNow = await askYesNo(
      'Run the DR recovery script now to execute a live recovery drill?',
      false,
    );
    if (shouldRunRecoveryNow) {
      runInteractive('sh', ['-lc', recoveryCommand], {
        AWS_REGION: identity.region,
      });
      summary.completed.push('Ran the DR recovery script from the guided setup flow.');

      if (drNetlifySite && netlifyDeployKeyDeferredUntilRecovery) {
        try {
          runInteractive('pnpm', ['run', 'dr:netlify:setup'], {
            AWS_REGION: identity.region,
          });
          netlifyConvexDeployKeyReady = true;
          summary.frontendLane = netlifyRequiredEnvConfigured ? 'ready' : summary.frontendLane;
          summary.completed.push(
            'Refreshed the DR Netlify site after recovery so it picked up the generated self-hosted Convex admin token.',
          );
        } catch (error) {
          summary.needsAttention.push(
            `Recovery succeeded, but the post-recovery Netlify refresh failed: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  printSummary(summary, flags.json);
}

main().catch((error) => {
  console.error('\n❌ DR setup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
