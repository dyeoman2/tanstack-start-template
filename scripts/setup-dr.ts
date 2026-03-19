#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import {
  buildDefaultBackupBucketName,
  buildDrSecretNames,
  buildRequiredNetlifyDrEnvVars,
  extractJsonText,
  extractHostnameFromUrl,
  getRequiredRecoveryEnvKeys,
  getStorageCoverageWarning,
  isLikelyConvexDeployKey,
  parseConvexEnvList,
  parseGitHubRepoFromRemote,
  parseSetupDrArgs,
} from './lib/setup-dr';

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

type NetlifySite = {
  accountSlug?: string;
  id: string;
  name: string;
  sslUrl?: string;
  url?: string;
};

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

const DEFAULT_DR_BACKUP_STACK_NAME = 'TanStackStartDrBackupStack';
const DEFAULT_DR_ECS_STACK_NAME = 'TanStackStartDrEcsStack';

function getDrBackupStackName() {
  return DEFAULT_DR_BACKUP_STACK_NAME;
}

function getDrEcsStackName() {
  return process.env.AWS_DR_STACK_NAME?.trim() || DEFAULT_DR_ECS_STACK_NAME;
}

function printUsage() {
  console.log('Usage: pnpm run setup:dr -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --yes                 Run non-interactively with discovered/default values.');
  console.log('  --domain <value>      DR base domain, for example example.com.');
  console.log('  --project-slug <id>   Override the DR resource slug.');
  console.log('  --github-repo <repo>  Target GitHub repo as owner/name.');
  console.log('  --netlify-site <id>   Existing Netlify site id or name for the DR frontend.');
  console.log('  --skip-github         Skip GitHub Actions secret and workflow setup.');
  console.log('  --skip-netlify        Skip dedicated Netlify DR site setup.');
  console.log('  --skip-ecs            Skip DR ECS stack preview and deploy.');
  console.log('  --skip-cloudflare     Skip Cloudflare DNS automation secret setup.');
  console.log('  --json                Print the final summary as JSON.');
  console.log('  -h, --help            Show this help text.');
}

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
    const details = [result.stdout, result.stderr]
      .join('\n')
      .trim();
    throw new Error(details ? `${message}\n${details}` : message);
  }
}

function commandExists(command: string) {
  return runCommand('sh', ['-lc', `command -v ${command}`]).ok;
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

function readNetlifyLinkedSiteId() {
  const statePath = path.join(process.cwd(), '.netlify', 'state.json');
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as { siteId?: string };
    return parsed.siteId ?? null;
  } catch {
    return null;
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

function upsertAwsSecret(secretId: string, secretValue: string, region: string, description?: string) {
  if (secretExists(secretId, region)) {
    ensureOk(
      runCommand(
        'aws',
        ['secretsmanager', 'put-secret-value', '--secret-id', secretId, '--secret-string', secretValue],
        {
          env: { AWS_REGION: region },
        },
      ),
      `Failed to update Secrets Manager secret ${secretId}`,
    );
    return 'updated';
  }

  const args = ['secretsmanager', 'create-secret', '--name', secretId, '--secret-string', secretValue];
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

function createDrCommandEnv(context: SetupContext, identity: AwsIdentity): NodeJS.ProcessEnv {
  return {
    AWS_DR_BACKUP_S3_BUCKET: context.backupBucketName,
    AWS_DR_BACKEND_SUBDOMAIN: context.backendSubdomain,
    AWS_DR_DOMAIN: context.domain,
    AWS_DR_ECS_CPU: context.ecsCpu,
    AWS_DR_ECS_MEMORY_MIB: context.ecsMemoryMiB,
    AWS_DR_FRONTEND_SUBDOMAIN: context.frontendSubdomain,
    AWS_DR_PROJECT_SLUG: context.projectSlug,
    AWS_DR_SITE_SUBDOMAIN: context.siteSubdomain,
    AWS_REGION: identity.region,
    CDK_DEFAULT_REGION: identity.region,
  };
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
  const result = runCommand('gh', ['secret', 'list', '--repo', repo, '--app', 'actions', '--json', 'name']);
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
  const result = runCommand('npx', ['convex', 'env', 'list', '--prod']);
  if (!result.ok) {
    return null;
  }

  return parseConvexEnvList(result.stdout);
}

function buildNetlifySiteTempDir(siteId: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'setup-dr-netlify-'));
  mkdirSync(path.join(tempDir, '.netlify'), { recursive: true });
  writeFileSync(path.join(tempDir, '.netlify', 'state.json'), JSON.stringify({ siteId }, null, 2));
  return tempDir;
}

function listNetlifySites() {
  const result = runCommand('netlify', ['sites:list', '--json']);
  if (!result.ok) {
    return [];
  }

  const parsed =
    parseJsonOutput<Array<{ account_slug?: string; id?: string; name?: string; ssl_url?: string; url?: string }>>(
      result,
    ) ?? [];

  return parsed.flatMap((site) =>
    site.id && site.name
      ? [
          {
            accountSlug: site.account_slug,
            id: site.id,
            name: site.name,
            sslUrl: site.ssl_url,
            url: site.url,
          } satisfies NetlifySite,
        ]
      : [],
  );
}

function resolveNetlifySite(siteInput: string) {
  const sites = listNetlifySites();
  return sites.find((site) => site.id === siteInput || site.name === siteInput) ?? null;
}

function createNetlifySite(name: string, accountSlug?: string) {
  const args = ['sites:create', '--disable-linking', '--name', name];
  if (accountSlug) {
    args.push('--account-slug', accountSlug);
  }

  const result = runCommand('netlify', args);
  if (!result.ok) {
    return null;
  }

  return resolveNetlifySite(name);
}

function setNetlifySiteEnvVar(siteId: string, key: string, value: string) {
  const tempDir = buildNetlifySiteTempDir(siteId);
  try {
    ensureOk(
      runCommand(
        'netlify',
        ['env:set', key, value, '--context', 'production', '--force'],
        {
          cwd: tempDir,
        },
      ),
      `Failed to set Netlify env var ${key}`,
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function listNetlifySiteHooks(siteId: string) {
  const getViaApi = runCommand('netlify', ['api', 'listSiteBuildHooks', '--data', JSON.stringify({ site_id: siteId })]);
  const parsed = parseJsonOutput<Array<{ branch?: string; id?: string; title?: string; url?: string }>>(getViaApi);
  if (parsed) {
    return parsed;
  }

  const tempDir = buildNetlifySiteTempDir(siteId);
  try {
    const result = runCommand('netlify', ['status:hooks'], { cwd: tempDir });
    const urls = result.stdout.match(/https:\/\/[^\s]+/gu) ?? [];
    return urls.map((url, index) => ({
      id: `parsed-${index + 1}`,
      title: 'Existing build hook',
      url,
    }));
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function createNetlifyBuildHook(siteId: string, title: string, branch: string) {
  const result = runCommand('netlify', [
    'api',
    'createSiteBuildHook',
    '--data',
    JSON.stringify({
      body: {
        branch,
        title,
      },
      site_id: siteId,
    }),
  ]);

  return parseJsonOutput<{ url?: string }>(result)?.url ?? null;
}

function getNetlifySiteEnvValue(siteId: string, key: string) {
  const tempDir = buildNetlifySiteTempDir(siteId);
  try {
    const result = runCommand('netlify', ['env:get', key, '--context', 'production'], {
      cwd: tempDir,
    });
    if (!result.ok) {
      return null;
    }

    const value = result.stdout.trim() || result.stderr.trim();
    return value || null;
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
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
    runCommand(
      'aws',
      ['iam', 'create-access-key', '--user-name', userName, '--output', 'json'],
      {
        env: { AWS_REGION: region },
      },
    ),
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
    console.log(JSON.stringify(summary, null, 2));
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

function buildRecoveryCommand(domain: string, backupBucketName: string) {
  return `AWS_DR_DOMAIN=${quoteShell(domain)} AWS_DR_BACKUP_S3_BUCKET=${quoteShell(backupBucketName)} ./infra/aws-cdk/scripts/dr-recover-ecs.sh`;
}

async function requireInputOrPrompt(label: string, providedValue: string | undefined, yes: boolean) {
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
  console.log('and then automates the backup, backend failover, GitHub workflow, and Netlify setup');
  console.log('where the required CLIs and auth are already available.');

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
  const binaryChecks = [
    ['node', commandExists('node')],
    ['pnpm', commandExists('pnpm')],
    ['aws', commandExists('aws')],
    ['gh', commandExists('gh')],
    ['jq', commandExists('jq')],
    ['curl', commandExists('curl')],
    ['netlify', commandExists('netlify')],
    ['npx', commandExists('npx')],
  ] as const;

  for (const [binary, ok] of binaryChecks) {
    console.log(`- ${binary}: ${ok ? 'found' : 'missing'}`);
  }

  const missingRequired = binaryChecks
    .filter(([binary, ok]) => !ok && ['node', 'pnpm', 'aws', 'npx'].includes(binary))
    .map(([binary]) => binary);
  if (missingRequired.length > 0) {
    throw new Error(`Missing required binaries: ${missingRequired.join(', ')}`);
  }

  const awsAuth = runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
    env: { AWS_REGION: getAwsRegion() },
  }).ok;
  const ghAuth = commandExists('gh') && runCommand('gh', ['auth', 'status']).ok;
  const netlifyAuth = commandExists('netlify') && runCommand('netlify', ['status', '--json']).ok;
  const convexProdEnv = getConvexProdEnv();

  console.log(`- AWS auth: ${awsAuth ? 'ready' : 'not ready'}`);
  console.log(`- GitHub auth: ${ghAuth ? 'ready' : 'not ready'}`);
  console.log(`- Netlify auth: ${netlifyAuth ? 'ready' : 'not ready'}`);
  console.log(`- Convex prod access: ${convexProdEnv ? 'ready' : 'not ready'}`);

  const identity = getAwsIdentity(awsAuth);
  const gitRemote = runCommand('git', ['config', '--get', 'remote.origin.url']).stdout.trim();
  const discoveredRepo = flags.githubRepo ?? parseGitHubRepoFromRemote(gitRemote) ?? undefined;
  const linkedNetlifySiteId = readNetlifyLinkedSiteId();
  const defaultBranch = getDefaultBranch(discoveredRepo);
  const storageCoverageWarning = convexProdEnv ? getStorageCoverageWarning(convexProdEnv) : null;
  if (storageCoverageWarning) {
    summary.warnings.push(storageCoverageWarning);
  }

  printSection('Step 2: Discovery');
  console.log(`- Git remote: ${gitRemote || 'not configured'}`);
  console.log(`- GitHub repo: ${discoveredRepo ?? 'not detected'}`);
  console.log(`- Linked Netlify site: ${linkedNetlifySiteId ?? 'not linked'}`);
  console.log(`- Production storage mode: ${convexProdEnv?.FILE_STORAGE_BACKEND ?? 'convex (default or unknown)'}`);
  console.log(`- Default branch: ${defaultBranch}`);

  const backupStackOutputs =
    awsAuth && identity.region
      ? getStackOutputs(getDrBackupStackName(), identity.region)
      : null;
  const ecsStackOutputs =
    awsAuth && identity.region
      ? getStackOutputs(getDrEcsStackName(), identity.region)
      : null;

  if (backupStackOutputs?.DrBackupBucketName) {
    console.log(`- Existing DR backup bucket: ${backupStackOutputs.DrBackupBucketName}`);
  }
  if (ecsStackOutputs?.ConvexBackendUrl) {
    console.log(`- Existing DR backend: ${ecsStackOutputs.ConvexBackendUrl}`);
  }

  printSection('Step 3: Collect configuration');
  const defaultProjectSlug =
    flags.projectSlug ??
    discoveredRepo?.split('/')[1] ??
    'tanstack-start-template';
  const projectSlug = flags.yes
    ? defaultProjectSlug
    : await askWithDefault('Project slug for DR resources', defaultProjectSlug);
  const defaultDomain = flags.domain ?? process.env.AWS_DR_DOMAIN ?? '';
  const domain =
    flags.skipEcs && flags.skipNetlify
      ? undefined
      : await requireInputOrPrompt('Primary domain for DR failover (example.com)', defaultDomain, flags.yes);
  const defaultBucketName =
    backupStackOutputs?.DrBackupBucketName ??
    buildDefaultBackupBucketName(projectSlug, identity.accountId, identity.region);
  const backupBucketName = flags.yes
    ? defaultBucketName
    : await askWithDefault('S3 bucket for Convex DR exports', defaultBucketName);
  const backendSubdomain = flags.yes
    ? 'dr-backend'
    : await askWithDefault('DR backend subdomain', 'dr-backend');
  const siteSubdomain = flags.yes ? 'dr-site' : await askWithDefault('DR Convex site subdomain', 'dr-site');
  const frontendSubdomain = flags.yes ? 'dr' : await askWithDefault('DR frontend subdomain', 'dr');
  const githubRepo = flags.skipGithub
    ? undefined
    : await requireInputOrPrompt('GitHub repository (owner/name)', discoveredRepo, flags.yes);
  const setupCloudflareNow = flags.skipCloudflare
    ? false
    : flags.yes
      ? false
      : await askYesNo('Configure Cloudflare DNS automation secrets now?', false);
  const setupNetlifyNow = flags.skipNetlify
    ? false
    : flags.yes
      ? true
      : await askYesNo('Create or validate a dedicated Netlify DR site now?', true);
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
    githubRepo,
    netlifySiteInput: flags.netlifySite,
    projectSlug,
    runWorkflowTest,
    setupCloudflareNow,
    setupNetlifyNow,
    siteSubdomain,
  };

  printSection('Step 4: Confirm external changes');
  console.log('- Backup stack preview/deploy');
  console.log(`- GitHub Actions secret updates${githubRepo ? ` for ${githubRepo}` : ''}`);
  console.log(`- Netlify DR site setup${setupNetlifyNow ? '' : ' (deferred)'}`);
  console.log(`- DR ECS stack deploy${flags.skipEcs ? ' (skipped)' : ''}`);
  console.log('- Secrets Manager secret sync/update');

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
    runInteractive('pnpm', ['run', 'infra:dr:backup:preview'], drEnv);
    const deployBackup = flags.yes ? true : await askYesNo('Deploy or update the DR backup stack now?', true);
    if (deployBackup) {
      runInteractive('pnpm', ['run', 'infra:dr:backup:deploy'], drEnv);
      summary.completed.push('Deployed the DR backup stack.');
      summary.backupLane = 'partial';
    } else {
      summary.needsAttention.push('DR backup stack deploy was skipped.');
    }
  }

  const freshBackupOutputs =
    awsAuth && identity.region
      ? getStackOutputs(getDrBackupStackName(), identity.region)
      : null;

  printSection('Step 6: Configure GitHub workflow readiness');
  if (flags.skipGithub) {
    summary.warnings.push('GitHub workflow setup was skipped with --skip-github.');
  } else if (!ghAuth || !githubRepo) {
    summary.needsAttention.push('GitHub auth or repository discovery is missing, so Actions secrets were not configured.');
  } else {
    const secretNamesInRepo = getGitHubSecretNames(githubRepo);

    if (!freshBackupOutputs?.DrBackupCiUserName) {
      summary.needsAttention.push('The DR backup stack did not expose the CI IAM user name needed for GitHub secrets.');
    } else if (awsAuth && identity.region) {
      const userName = freshBackupOutputs.DrBackupCiUserName;
      const listedKeys = runCommand(
        'aws',
        ['iam', 'list-access-keys', '--user-name', userName, '--query', 'AccessKeyMetadata[].AccessKeyId', '--output', 'json'],
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

            const refreshedKeys = parseJsonOutput<string[]>(
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
        setGitHubSecret(githubRepo, 'AWS_DR_BACKUP_S3_BUCKET', freshBackupOutputs?.DrBackupBucketName ?? backupBucketName);
        summary.completed.push('Configured AWS DR backup secrets in GitHub Actions.');
      } else if (
        !secretNamesInRepo.has('AWS_DR_BACKUP_ACCESS_KEY_ID') ||
        !secretNamesInRepo.has('AWS_DR_BACKUP_SECRET_ACCESS_KEY')
      ) {
        summary.needsAttention.push(
          'GitHub Actions still needs AWS DR backup credentials. Rerun setup:dr and provide the key pair, or add the secrets manually.',
        );
      }
    }

    if (!secretNamesInRepo.has('CONVEX_DEPLOY_KEY')) {
      if (flags.yes) {
        summary.needsAttention.push('CONVEX_DEPLOY_KEY is missing in GitHub Actions and cannot be auto-generated from this script.');
      } else {
        const deployKey = await ask('Convex production deploy key for GitHub Actions (leave empty to keep manual): ');
        if (deployKey) {
          if (!isLikelyConvexDeployKey(deployKey)) {
            summary.needsAttention.push('The provided CONVEX_DEPLOY_KEY does not look like a production deploy key.');
          }
          setGitHubSecret(githubRepo, 'CONVEX_DEPLOY_KEY', deployKey);
          context.convexDeployKey = deployKey;
          setGitHubSecret(githubRepo, 'DR_TEST_APP_NAME', `${convexProdEnv?.APP_NAME ?? 'TanStack Start Template'} DR Test`);
          setGitHubSecret(githubRepo, 'DR_TEST_APP_URL', 'http://127.0.0.1:3000');
          setGitHubSecret(githubRepo, 'DR_TEST_BETTER_AUTH_SECRET', randomBytes(32).toString('hex'));
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
      const workflowRun = runCommand('gh', ['workflow', 'run', 'dr-backup-convex-s3.yml', '--repo', githubRepo]);
      if (workflowRun.ok) {
        summary.completed.push('Triggered the weekly DR backup workflow once.');
        const latestRun = runCommand(
          'gh',
          ['run', 'list', '--repo', githubRepo, '--workflow', 'dr-backup-convex-s3.yml', '--event', 'workflow_dispatch', '--limit', '1', '--json', 'url,status'],
        );
        const latestParsed = parseJsonOutput<Array<{ status?: string; url?: string }>>(latestRun);
        if (latestParsed?.[0]?.url) {
          summary.completed.push(`Latest workflow run: ${latestParsed[0].url}`);
        }
        summary.workflowTested = true;
      } else {
        summary.needsAttention.push('The backup workflow trigger failed. Verify GitHub auth and workflow permissions.');
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
  if (flags.skipNetlify) {
    summary.frontendLane = 'partial';
    summary.warnings.push('Netlify DR setup was skipped with --skip-netlify.');
  } else if (!netlifyAuth) {
    summary.frontendLane = 'blocked';
    summary.needsAttention.push('Netlify auth is not ready, so the DR frontend was not configured.');
  } else if (!context.setupNetlifyNow) {
    summary.frontendLane = 'partial';
    summary.warnings.push('Dedicated Netlify DR site setup was deferred.');
  } else {
    if (context.netlifySiteInput) {
      drNetlifySite = resolveNetlifySite(context.netlifySiteInput);
    }

    if (!drNetlifySite && !flags.yes) {
      const existingInput = await ask(
        'Existing Netlify DR site id or name (leave empty to create a dedicated site automatically): ',
      );
      if (existingInput) {
        drNetlifySite = resolveNetlifySite(existingInput);
      }
    }

    if (!drNetlifySite) {
      const desiredSiteName = `${projectSlug}-dr`;
      drNetlifySite = createNetlifySite(desiredSiteName);
      if (drNetlifySite) {
        summary.completed.push(`Created or resolved Netlify DR site ${drNetlifySite.name}.`);
      }
    }

    if (!drNetlifySite) {
      summary.frontendLane = 'partial';
      summary.needsAttention.push(
        'Could not create or resolve the dedicated Netlify DR site automatically. Provide --netlify-site on the next run or configure it manually.',
      );
    } else {
      const frontendOrigin = domain ? `https://${frontendSubdomain}.${domain}` : undefined;
      const backendOrigin = domain ? `https://${backendSubdomain}.${domain}` : undefined;
      const siteOrigin = domain ? `https://${siteSubdomain}.${domain}` : undefined;

      if (frontendOrigin && backendOrigin && siteOrigin) {
        const envEntries = Object.entries(
          buildRequiredNetlifyDrEnvVars(convexProdEnv ?? {}, {
            backendOrigin,
            frontendOrigin,
            siteOrigin,
          }),
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

        let deployKeyForNetlify = context.convexDeployKey ?? '';
        if (!deployKeyForNetlify) {
          const existingNetlifyDeployKey = getNetlifySiteEnvValue(drNetlifySite.id, 'CONVEX_DEPLOY_KEY');
          if (existingNetlifyDeployKey && isLikelyConvexDeployKey(existingNetlifyDeployKey)) {
            netlifyConvexDeployKeyReady = true;
          } else if (!flags.yes) {
            deployKeyForNetlify = await ask(
              'Convex deploy key for the Netlify DR site (leave empty to keep frontend DR partial): ',
            );
          }
        }

        if (deployKeyForNetlify) {
          if (!isLikelyConvexDeployKey(deployKeyForNetlify)) {
            summary.needsAttention.push(
              'The provided Netlify CONVEX_DEPLOY_KEY does not look like a production deploy key.',
            );
          } else {
            try {
              setNetlifySiteEnvVar(drNetlifySite.id, 'CONVEX_DEPLOY_KEY', deployKeyForNetlify);
              netlifyConvexDeployKeyReady = true;
              context.convexDeployKey = deployKeyForNetlify;
            } catch (error) {
              summary.needsAttention.push(
                `Failed to set Netlify CONVEX_DEPLOY_KEY automatically: ${(error as Error).message}`,
              );
            }
          }
        }

        if (!netlifyConvexDeployKeyReady) {
          summary.needsAttention.push(
            'Netlify DR is still missing a validated CONVEX_DEPLOY_KEY, so the frontend build is not fully ready.',
          );
        }

        let buildHookUrl = listNetlifySiteHooks(drNetlifySite.id).find((hook) => hook.url)?.url ?? null;
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
          summary.completed.push('Configured the Netlify DR build hook secret in AWS Secrets Manager.');
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
            'Netlify DR frontend CNAME target used for Cloudflare cutover automation',
          );
          summary.completed.push(`Captured the Netlify DR frontend CNAME target (${frontendCnameTarget}).`);
        } else {
          summary.frontendLane = 'partial';
          summary.needsAttention.push(
            'Could not determine the Netlify DR frontend hostname automatically. Cloudflare frontend DNS automation may still need AWS_DR_FRONTEND_CNAME_TARGET.',
          );
        }

        if (drNetlifySite.sslUrl || drNetlifySite.url) {
          summary.completed.push(
            `Netlify DR site URL: ${drNetlifySite.sslUrl ?? drNetlifySite.url ?? drNetlifySite.name}`,
          );
        }
      }
    }
  }

  printSection('Step 8: Deploy the DR ECS stack');
  const ecsShouldRun = !flags.skipEcs;
  if (!ecsShouldRun) {
    summary.backendLane = 'partial';
    summary.warnings.push('DR ECS deployment was skipped with --skip-ecs.');
  } else if (!awsAuth || !identity.region || !context.domain) {
    summary.backendLane = 'blocked';
    summary.needsAttention.push('AWS auth or the DR domain is missing, so the DR ECS stack was not deployed.');
  } else {
    runInteractive('pnpm', ['run', 'infra:dr:ecs:preview'], drEnv);
    const deployEcs = flags.yes ? true : await askYesNo('Deploy or update the DR ECS stack now?', true);
    if (deployEcs) {
      runInteractive('pnpm', ['run', 'infra:dr:ecs:deploy'], drEnv);
      summary.completed.push('Deployed the DR ECS stack.');
      summary.backendLane = 'partial';
    } else {
      summary.needsAttention.push('DR ECS stack deploy was skipped.');
    }
  }

  printSection('Step 9: Sync the DR runtime secret');
  if (!awsAuth || !identity.region) {
    summary.needsAttention.push('AWS auth is not ready, so the DR runtime secret was not synchronized.');
  } else if (!convexProdEnv) {
    summary.needsAttention.push('Convex production env access is not ready, so the DR runtime secret could not be synchronized.');
  } else {
    const requiredRecoveryKeys = getRequiredRecoveryEnvKeys(convexProdEnv);
    const missingRecoveryKeys = requiredRecoveryKeys.filter((key) => !(convexProdEnv[key] ?? '').trim());
    if (missingRecoveryKeys.length > 0) {
      summary.needsAttention.push(
        `The Convex production env is missing recovery-critical keys: ${missingRecoveryKeys.join(', ')}.`,
      );
    }

    upsertAwsSecret(
      secretNames.convexEnv,
      JSON.stringify(convexProdEnv, null, 2),
      identity.region,
      'Convex production env vars replayed during DR recovery',
    );
    summary.completed.push(`Synchronized ${secretNames.convexEnv} from Convex production env.`);

    if (context.setupCloudflareNow) {
      if (flags.yes) {
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
          summary.completed.push('Configured the Cloudflare DNS automation secrets.');
        } else {
          summary.needsAttention.push('Cloudflare DNS automation was requested, but the token or zone id was left blank.');
        }
      }
    } else {
      summary.warnings.push(
        `Cloudflare automation is still optional. Add ${secretNames.cloudflareDnsToken} and ${secretNames.cloudflareZoneId} later if you want automated DNS cutover.`,
      );
    }
  }

  printSection('Step 10: Final readiness validation');
  const finalBackupOutputs =
    awsAuth && identity.region
      ? getStackOutputs(getDrBackupStackName(), identity.region)
      : null;
  const finalEcsOutputs =
    awsAuth && identity.region
      ? getStackOutputs(getDrEcsStackName(), identity.region)
      : null;
  const hasDrEnvSecret = awsAuth && identity.region ? secretExists(secretNames.convexEnv, identity.region) : false;
  const hasBuildHookSecret =
    awsAuth && identity.region ? secretExists(secretNames.netlifyBuildHook, identity.region) : false;
  const hasFrontendCnameTargetSecret =
    awsAuth && identity.region
      ? secretExists(secretNames.netlifyFrontendCnameTarget, identity.region)
      : false;

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

  if (!hasDrEnvSecret) {
    summary.needsAttention.push(`Secrets Manager secret ${secretNames.convexEnv} is still missing.`);
  }
  if (!hasBuildHookSecret && !flags.skipNetlify) {
    summary.needsAttention.push(`Secrets Manager secret ${secretNames.netlifyBuildHook} is still missing.`);
  }
  if (!hasFrontendCnameTargetSecret && !flags.skipNetlify) {
    summary.needsAttention.push(
      `Secrets Manager secret ${secretNames.netlifyFrontendCnameTarget} is still missing.`,
    );
  }

  summary.nextCommands.push(
    githubRepo
      ? `gh workflow run dr-backup-convex-s3.yml --repo ${githubRepo}`
      : 'gh workflow run dr-backup-convex-s3.yml --repo <owner/repo>',
  );
  const recoveryCommand =
    context.domain && (finalBackupOutputs?.DrBackupBucketName ?? backupBucketName)
      ? buildRecoveryCommand(
          context.domain,
          finalBackupOutputs?.DrBackupBucketName ?? backupBucketName,
        )
      : './infra/aws-cdk/scripts/dr-recover-ecs.sh';
  summary.nextCommands.push(recoveryCommand);

  if (
    !flags.json &&
    !flags.yes &&
    context.domain &&
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
    }
  }

  printSummary(summary, flags.json);
}

main().catch((error) => {
  console.error('\n❌ DR setup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
