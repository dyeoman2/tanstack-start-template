#!/usr/bin/env tsx

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import {
  isLikelyConvexAdminAuthToken,
  buildDrSecretNames,
  buildRequiredNetlifyDrEnvVars,
  extractHostnameFromUrl,
  parseConvexEnvList,
} from './lib/setup-dr';

type CommandResult = {
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  stdout: string;
};

type NetlifySite = {
  accountSlug?: string;
  id: string;
  name: string;
  sslUrl?: string;
  url?: string;
};

type StackOutputs = Record<string, string>;

type DrHostnameStrategy = 'custom-domain' | 'provider-hostnames';
const DR_ENV_FILE_NAME = '.dr.env.local';

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

function commandExists(command: string) {
  return runCommand('sh', ['-lc', `command -v ${command}`]).ok;
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

function getAwsRegion() {
  return (
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    runCommand('aws', ['configure', 'get', 'region']).stdout.trim() ||
    'us-west-1'
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
    parseJsonOutput<
      Array<{ account_slug?: string; id?: string; name?: string; ssl_url?: string; url?: string }>
    >(result) ?? [];

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
      runCommand('netlify', ['env:set', key, value, '--context', 'production', '--force'], {
        cwd: tempDir,
      }),
      `Failed to set Netlify env var ${key}`,
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
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
    if (
      !value ||
      /^No value set in the production context for environment variable\b/u.test(value)
    ) {
      return null;
    }

    return value;
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function listNetlifySiteHooks(siteId: string) {
  const result = runCommand('netlify', [
    'api',
    'listSiteBuildHooks',
    '--data',
    JSON.stringify({ site_id: siteId }),
  ]);
  return parseJsonOutput<Array<{ title?: string; url?: string }>>(result) ?? [];
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

function formatNetlifySiteSummary(site: NetlifySite | null) {
  if (!site) {
    return null;
  }
  const primaryUrl = site.sslUrl || site.url;
  return `${site.name} (id: ${site.id}${primaryUrl ? `, url: ${primaryUrl}` : ''})`;
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
  console.log('🌐 DR Netlify frontend setup');

  printSection('Preflight');
  for (const [binary, ok] of [
    ['aws', commandExists('aws')],
    ['netlify', commandExists('netlify')],
    ['npx', commandExists('npx')],
  ] as const) {
    console.log(`- ${binary}: ${ok ? 'found' : 'missing'}`);
  }

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

  const linkedNetlifySiteId = readNetlifyLinkedSiteId();
  const linkedNetlifySite = linkedNetlifySiteId ? resolveNetlifySite(linkedNetlifySiteId) : null;
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

  printSection('Netlify site');
  const desiredSiteName = `${projectSlug}-dr`;
  let drNetlifySite = resolveNetlifySite(desiredSiteName);
  if (!drNetlifySite) {
    const provided = await ask(
      'Existing Netlify DR site id or name (leave empty to create a dedicated DR site automatically): ',
    );
    if (provided) {
      drNetlifySite = resolveNetlifySite(provided);
    }
  }
  if (!drNetlifySite) {
    drNetlifySite = createNetlifySite(desiredSiteName, linkedNetlifySite?.accountSlug);
  }
  if (!drNetlifySite) {
    throw new Error(
      `Could not create or resolve the dedicated Netlify DR site automatically. Create ${desiredSiteName} in Netlify and rerun this command.`,
    );
  }
  console.log(`- DR Netlify site: ${formatNetlifySiteSummary(drNetlifySite)}`);

  const secretNames = buildDrSecretNames(projectSlug);
  let deployKey = getAwsSecretValue(secretNames.convexAdminKey, awsRegion) ?? '';
  if (!isLikelyConvexAdminAuthToken(deployKey)) {
    deployKey = getNetlifySiteEnvValue(drNetlifySite.id, 'CONVEX_DEPLOY_KEY') ?? '';
  }
  if (!isLikelyConvexAdminAuthToken(deployKey)) {
    deployKey = await ask(
      'Convex admin/deploy auth token for the DR Netlify site (required if not already set): ',
      deployKey,
    );
  }
  if (!isLikelyConvexAdminAuthToken(deployKey)) {
    throw new Error('A valid Convex admin/deploy auth token is required for the DR Netlify site.');
  }
  setNetlifySiteEnvVar(drNetlifySite.id, 'CONVEX_DEPLOY_KEY', deployKey);

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

  printSection('Done');
  console.log(`- DR Netlify site: ${frontendOrigin}`);
  console.log(`- Build hook secret: ${secretNames.netlifyBuildHook}`);
  console.log(`- Frontend hostname secret: ${secretNames.netlifyFrontendCnameTarget}`);
  console.log('- You can now run the DR recovery script.');
}

main().catch((error) => {
  console.error('\n❌ DR Netlify setup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
