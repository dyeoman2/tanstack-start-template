#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import {
  CLI_INSTALL_HINT,
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { convexEnvList } from './lib/convex-cli';
import {
  configureNetlifySiteRepository,
  createNetlifyBuildHook,
  createRepoBackedNetlifySite,
  formatNetlifySiteSummary,
  getNetlifySiteDetails,
  getNetlifySiteEnvValue,
  listNetlifySiteHooks,
  readNetlifyLinkedSiteIdFromDisk,
  resolveNetlifySite,
  setNetlifySiteEnvVar,
  triggerNetlifySiteBuild,
  type NetlifySite,
  type NetlifySiteDetails,
} from './lib/netlify-cli';
import {
  buildDrSecretNames,
  buildRequiredNetlifyDrEnvVars,
  extractHostnameFromUrl,
  isLikelyConvexAdminAuthToken,
  parseConvexEnvList,
} from './lib/setup-dr';
import {
  emitStructuredOutput,
  hasFlag,
  hasHelpFlag,
  printFinalChangeSummary,
  printScriptIntro,
  printTargetSummary,
  routeLogsToStderrWhenJson,
} from './lib/script-ux';

type CommandResult = {
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  stdout: string;
};

type StackOutputs = Record<string, string>;

type DrHostnameStrategy = 'custom-domain' | 'provider-hostnames';
const DR_ENV_FILE_NAME = '.dr.env.local';

function printUsage() {
  console.log('Usage: pnpm run dr:netlify:setup [--json]');
  console.log('');
  console.log(
    'What this does: create or reconcile the DR Netlify frontend site, write required env vars, store recovery secrets in AWS, and trigger an initial build.',
  );
  console.log('Use this instead of dr:setup when you only need the DR frontend/Netlify path.');
  console.log('Docs: docs/DISASTER_RECOVERY_CONFIG.md');
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run dr:netlify:setup');
  console.log('- pnpm run dr:netlify:setup -- --json');
  console.log('');
  console.log('Safe to rerun: yes; it refreshes the DR frontend configuration.');
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

function readEnvFile(envPath: string) {
  return existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
}

function readEnvValue(envContent: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = Array.from(envContent.matchAll(new RegExp(`^${escapedName}=(.*)$`, 'gm')));
  const match = matches.at(-1);
  return match?.[1]?.trim()?.replace(/^"(.*)"$/, '$1') || null;
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): CommandResult {
  const spawned = spawnSync(command, args, {
    cwd: options?.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options?.env,
    },
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

function extractJsonText(raw: string) {
  const lines = raw.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trimStart() ?? '';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return lines.slice(index).join('\n').trim();
    }
  }
  return null;
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

function getConvexProdEnv() {
  try {
    return parseConvexEnvList(convexEnvList(true));
  } catch {
    return null;
  }
}

function upsertAwsSecret(
  secretId: string,
  secretValue: string,
  region: string,
  description?: string,
) {
  const exists = runCommand(
    'aws',
    ['secretsmanager', 'describe-secret', '--secret-id', secretId, '--output', 'json'],
    { env: { AWS_REGION: region } },
  ).ok;

  if (exists) {
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
        { env: { AWS_REGION: region } },
      ),
      `Failed to update Secrets Manager secret ${secretId}`,
    );
    return;
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
    runCommand('aws', args, { env: { AWS_REGION: region } }),
    `Failed to create Secrets Manager secret ${secretId}`,
  );
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
    { env: { AWS_REGION: region } },
  );
  if (!result.ok) {
    return null;
  }

  const value = result.stdout.trim();
  return !value || value === 'None' ? null : value;
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
    { env: { AWS_REGION: region } },
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

function getDefaultBranch() {
  const remoteHead = runCommand('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead.ok) {
    const branch = remoteHead.stdout.trim().replace(/^origin\//u, '');
    if (branch) {
      return branch;
    }
  }
  return 'main';
}

async function main() {
  if (hasHelpFlag()) {
    printUsage();
    return;
  }
  const json = hasFlag('--json');
  routeLogsToStderrWhenJson(json);
  const changedLocally: string[] = [];
  const changedRemotely: string[] = [];
  const nextCommands: string[] = [];

  printScriptIntro({
    title: '🌐 DR Netlify frontend setup',
    what: 'create or reconcile the DR Netlify site, write its env, update related AWS recovery secrets, and trigger a first build.',
    prereqs: 'pnpm, aws, netlify, and Convex access; Netlify and AWS auth must already be ready.',
    modifies:
      'Netlify site settings/env, AWS Secrets Manager entries, and an initial Netlify build trigger.',
    safeToRerun: 'yes',
  });

  printSection('Preflight');
  const requiredMissing = findMissingCommands([
    { cmd: 'pnpm' },
    { cmd: 'aws' },
    { cmd: 'netlify' },
  ]);
  if (requiredMissing.length > 0) {
    printMissingCliSummary('Missing required CLIs', requiredMissing);
    process.exit(1);
  }
  requireCommands([{ cmd: 'pnpm' }, { cmd: 'aws' }, { cmd: 'netlify' }]);
  requirePnpmAndConvexCli();
  console.log('Required CLIs: pnpm, aws, netlify, convex (pnpm exec) — OK\n');
  console.log('Provider auth:');
  console.log('- AWS: run `aws sts get-caller-identity` or `aws configure` if auth is not ready');
  if (commandOnPath('netlify')) {
    console.log('- Netlify: run `netlify login` if auth is not ready');
  } else {
    console.log(`- Netlify: ${CLI_INSTALL_HINT.netlify}`);
  }
  console.log('');

  const envPath = path.join(process.cwd(), '.env.local');
  const drEnvPath = path.join(process.cwd(), DR_ENV_FILE_NAME);
  const envContent = readEnvFile(envPath);
  const drEnvContent = readEnvFile(drEnvPath);
  const projectSlug =
    readEnvValue(drEnvContent, 'AWS_DR_PROJECT_SLUG') ?? 'tanstack-start-template';
  const hostnameStrategy =
    (readEnvValue(drEnvContent, 'AWS_DR_HOSTNAME_STRATEGY') as DrHostnameStrategy | null) ??
    'provider-hostnames';
  const awsRegion =
    readEnvValue(envContent, 'AWS_REGION') ??
    readEnvValue(drEnvContent, 'AWS_REGION') ??
    getAwsRegion();
  const ecsStackName =
    readEnvValue(drEnvContent, 'AWS_DR_STACK_NAME') ?? `${projectSlug}-dr-ecs-stack`;
  const domain = readEnvValue(drEnvContent, 'AWS_DR_DOMAIN') ?? '';
  const backendSubdomain = readEnvValue(drEnvContent, 'AWS_DR_BACKEND_SUBDOMAIN') ?? 'dr-backend';
  const siteSubdomain = readEnvValue(drEnvContent, 'AWS_DR_SITE_SUBDOMAIN') ?? 'dr-site';
  const frontendSubdomain = readEnvValue(drEnvContent, 'AWS_DR_FRONTEND_SUBDOMAIN') ?? 'dr';

  process.env.AWS_REGION = awsRegion;
  process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION?.trim() || awsRegion;

  ensureOk(
    runCommand('aws', ['sts', 'get-caller-identity', '--output', 'json'], {
      env: { AWS_REGION: awsRegion },
    }),
    'AWS auth is not ready',
  );
  ensureOk(runCommand('netlify', ['status', '--json']), 'Netlify auth is not ready');

  const convexProdEnv = getConvexProdEnv();
  if (!convexProdEnv) {
    throw new Error('Convex prod access is not ready.');
  }

  const linkedNetlifySiteId = readNetlifyLinkedSiteIdFromDisk();
  const linkedNetlifySite = linkedNetlifySiteId ? resolveNetlifySite(linkedNetlifySiteId) : null;
  const linkedNetlifySiteDetails = linkedNetlifySiteId
    ? getNetlifySiteDetails(linkedNetlifySiteId)
    : null;
  const ecsOutputs = getStackOutputs(ecsStackName, awsRegion);
  if (!ecsOutputs?.ConvexBackendUrl || !ecsOutputs.ConvexSiteUrl) {
    throw new Error(`Missing DR ECS outputs for ${ecsStackName}. Deploy the DR ECS stack first.`);
  }

  console.log(`- Project slug: ${projectSlug}`);
  console.log(`- Hostname strategy: ${hostnameStrategy}`);
  console.log(
    `- Linked app Netlify site: ${formatNetlifySiteSummary(linkedNetlifySite) ?? 'not linked'}`,
  );
  console.log(`- DR ECS stack: ${ecsStackName}`);
  console.log(`- DR backend URL: ${ecsOutputs.ConvexBackendUrl}`);
  console.log(`- DR site URL: ${ecsOutputs.ConvexSiteUrl}`);
  console.log('- Safe to rerun: yes; this updates the existing DR frontend state when present');
  printTargetSummary('Provider target summary', [
    `AWS region: ${awsRegion}`,
    `DR ECS stack: ${ecsStackName}`,
    `Linked app site: ${formatNetlifySiteSummary(linkedNetlifySite) ?? 'not linked'}`,
    `Desired DR site name: ${projectSlug}-dr`,
  ]);

  printSection('Netlify site');
  const desiredSiteName = `${projectSlug}-dr`;
  let drNetlifySite: NetlifySite | NetlifySiteDetails | null = resolveNetlifySite(desiredSiteName);
  if (!drNetlifySite) {
    const provided = await ask(
      'Existing Netlify DR site id or name (leave empty to create a dedicated DR site automatically): ',
    );
    if (provided) {
      drNetlifySite = resolveNetlifySite(provided);
    }
  }
  if (!drNetlifySite) {
    if (linkedNetlifySiteDetails?.buildSettings?.repo_url) {
      drNetlifySite = createRepoBackedNetlifySite({
        desiredName: desiredSiteName,
        primarySite: linkedNetlifySiteDetails,
      });
    }
  }
  if (!drNetlifySite) {
    throw new Error(
      `Could not create or resolve the dedicated Netlify DR site automatically. Create ${desiredSiteName} in Netlify and rerun this command.`,
    );
  }
  console.log(`- DR Netlify site: ${formatNetlifySiteSummary(drNetlifySite)}`);
  changedRemotely.push(`Reconciled DR Netlify site ${formatNetlifySiteSummary(drNetlifySite)}`);

  if (linkedNetlifySiteDetails?.buildSettings?.repo_url) {
    const repoConfigResult = configureNetlifySiteRepository({
      siteId: drNetlifySite.id,
      desiredName: drNetlifySite.name,
      primarySite: linkedNetlifySiteDetails,
    });
    if (repoConfigResult.ok) {
      console.log('- Mirrored primary site repo/build settings onto the DR site');
    } else {
      console.log('- Could not mirror primary site repo/build settings automatically');
      if (repoConfigResult.error) {
        console.log(repoConfigResult.error);
      }
    }
  }

  const secretNames = buildDrSecretNames(projectSlug);
  const awsSecretDeployKey = getAwsSecretValue(secretNames.convexAdminKey, awsRegion)?.trim() ?? '';
  let deployKey = awsSecretDeployKey;
  if (!deployKey) {
    deployKey = getNetlifySiteEnvValue(drNetlifySite.id, 'CONVEX_DEPLOY_KEY')?.trim() ?? '';
  }
  if (!deployKey) {
    deployKey = await ask(
      'Convex admin/deploy auth token for the DR Netlify site (required if not already set): ',
      deployKey,
    );
  }
  if (!isLikelyConvexAdminAuthToken(deployKey)) {
    if (awsSecretDeployKey) {
      throw new Error(
        `Secrets Manager secret ${secretNames.convexAdminKey} does not contain a valid Convex admin/deploy auth token. Rerun ./infra/aws-cdk/scripts/dr-recover-ecs.sh after fixing admin-key generation.`,
      );
    }
    throw new Error('A valid Convex admin/deploy auth token is required for the DR Netlify site.');
  }
  setNetlifySiteEnvVar(drNetlifySite.id, 'CONVEX_DEPLOY_KEY', deployKey);
  changedRemotely.push('Updated DR Netlify env CONVEX_DEPLOY_KEY');

  const frontendOrigin =
    hostnameStrategy === 'custom-domain' && domain
      ? `https://${frontendSubdomain}.${domain}`
      : (drNetlifySite.sslUrl ?? drNetlifySite.url);
  if (!frontendOrigin) {
    throw new Error('Could not determine the DR Netlify frontend URL.');
  }

  const envEntries = Object.entries(
    buildRequiredNetlifyDrEnvVars(convexProdEnv, {
      backendOrigin:
        hostnameStrategy === 'custom-domain' && domain
          ? `https://${backendSubdomain}.${domain}`
          : ecsOutputs.ConvexBackendUrl,
      frontendOrigin,
      siteOrigin:
        hostnameStrategy === 'custom-domain' && domain
          ? `https://${siteSubdomain}.${domain}`
          : ecsOutputs.ConvexSiteUrl,
    }),
  );

  printSection('Netlify env');
  for (const [key, value] of envEntries) {
    setNetlifySiteEnvVar(drNetlifySite.id, key, value);
    console.log(`- Set ${key}`);
  }
  changedRemotely.push(
    `Updated DR Netlify env vars (${envEntries.map(([key]) => key).join(', ')})`,
  );

  printSection('AWS secrets');
  const hooks = listNetlifySiteHooks(drNetlifySite.id);
  const buildHookUrl =
    hooks.find((hook) => hook.url)?.url ??
    createNetlifyBuildHook(drNetlifySite.id, 'DR Recovery', getDefaultBranch());
  if (!buildHookUrl) {
    throw new Error('Could not create or discover a Netlify build hook for the DR site.');
  }

  upsertAwsSecret(
    secretNames.netlifyBuildHook,
    buildHookUrl,
    awsRegion,
    'Netlify DR build hook used by dr-recover-ecs.sh',
  );
  console.log(`- Updated ${secretNames.netlifyBuildHook}`);
  changedRemotely.push(`Updated AWS secret ${secretNames.netlifyBuildHook}`);

  const frontendHostname = extractHostnameFromUrl(
    drNetlifySite.sslUrl ?? drNetlifySite.url ?? frontendOrigin,
  );
  if (!frontendHostname) {
    throw new Error(`Could not extract a frontend hostname from ${frontendOrigin}`);
  }
  upsertAwsSecret(
    secretNames.netlifyFrontendCnameTarget,
    frontendHostname,
    awsRegion,
    'Netlify DR frontend hostname used during recovery',
  );
  console.log(`- Updated ${secretNames.netlifyFrontendCnameTarget}`);
  changedRemotely.push(`Updated AWS secret ${secretNames.netlifyFrontendCnameTarget}`);

  const initialBuildResult = triggerNetlifySiteBuild(drNetlifySite.id, buildHookUrl);
  if (initialBuildResult.ok) {
    const detail = initialBuildResult.triggeredVia === 'build-hook' ? ' via build hook' : '';
    console.log(`- Triggered initial Netlify DR site build${detail}`);
    changedRemotely.push(`Triggered DR Netlify build${detail}`);
  } else {
    console.log('- Could not trigger the initial Netlify DR site build automatically');
    if (initialBuildResult.error) {
      console.log(initialBuildResult.error);
    }
  }

  printSection('Done');
  console.log(`- DR Netlify site: ${frontendOrigin}`);
  console.log(`- Build hook secret: ${secretNames.netlifyBuildHook}`);
  console.log(`- Frontend hostname secret: ${secretNames.netlifyFrontendCnameTarget}`);
  console.log('- You can now run the DR recovery script.');
  nextCommands.push('pnpm run dr:setup');
  nextCommands.push('pnpm run dr:destroy');
  const finalSummary = { changedLocally, changedRemotely, nextCommands };
  if (json) {
    emitStructuredOutput(finalSummary);
  } else {
    printFinalChangeSummary(finalSummary);
  }
}

main().catch((error) => {
  console.error('\n❌ DR Netlify setup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
