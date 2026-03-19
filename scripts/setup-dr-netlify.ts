#!/usr/bin/env tsx

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import {
  buildDrSecretNames,
  buildRequiredNetlifyDrEnvVars,
  extractHostnameFromUrl,
  isLikelyConvexAdminAuthToken,
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
  buildSettings?: NetlifySiteBuildSettings | null;
  id: string;
  name: string;
  sslUrl?: string;
  url?: string;
};

type NetlifySiteBuildSettings = {
  allowed_branches?: string[] | null;
  base?: string | null;
  cmd?: string | null;
  dir?: string | null;
  functions_dir?: string | null;
  installation_id?: number | null;
  private_logs?: boolean | null;
  provider?: string | null;
  public_repo?: boolean | null;
  repo_branch?: string | null;
  repo_path?: string | null;
  repo_url?: string | null;
  stop_builds?: boolean | null;
};

type NetlifySiteDetails = NetlifySite & {
  buildImage?: string | null;
  deployId?: string | null;
  functionsRegion?: string | null;
  processingSettings?: {
    html?: {
      pretty_urls?: boolean;
    };
    ignore_html_forms?: boolean;
  } | null;
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
      Array<{
        account_slug?: string;
        id?: string;
        name?: string;
        ssl_url?: string;
        url?: string;
      }>
    >(result) ?? [];

  return parsed.flatMap((site) =>
    site.id && site.name
      ? [
          {
            accountSlug: site.account_slug,
            buildSettings: null,
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

function getNetlifySiteDetails(siteId: string) {
  const result = runCommand('netlify', [
    'api',
    'getSite',
    '--data',
    JSON.stringify({ site_id: siteId }),
  ]);
  const parsed =
    parseJsonOutput<{
      account_slug?: string;
      build_image?: string;
      build_settings?: NetlifySiteBuildSettings;
      deploy_id?: string;
      functions_region?: string;
      id?: string;
      name?: string;
      processing_settings?: NetlifySiteDetails['processingSettings'];
      ssl_url?: string;
      url?: string;
    }>(result) ?? null;
  if (!parsed?.id || !parsed.name) {
    return null;
  }

  return {
    accountSlug: parsed.account_slug,
    buildImage: parsed.build_image ?? null,
    buildSettings: parsed.build_settings ?? null,
    deployId: parsed.deploy_id ?? null,
    functionsRegion: parsed.functions_region ?? null,
    id: parsed.id,
    name: parsed.name,
    processingSettings: parsed.processing_settings ?? null,
    sslUrl: parsed.ssl_url,
    url: parsed.url,
  } satisfies NetlifySiteDetails;
}

function buildRepoBackedNetlifySitePayload(input: {
  desiredName: string;
  primarySite: NetlifySiteDetails;
}) {
  const buildSettings = input.primarySite.buildSettings ?? {};
  const mirroredRepoInfo = {
    allowed_branches: buildSettings.allowed_branches ?? undefined,
    base: buildSettings.base ?? undefined,
    cmd: buildSettings.cmd ?? undefined,
    dir: buildSettings.dir ?? undefined,
    functions_dir: buildSettings.functions_dir ?? undefined,
    installation_id: buildSettings.installation_id ?? undefined,
    private_logs: buildSettings.private_logs ?? undefined,
    provider: buildSettings.provider ?? undefined,
    public_repo: buildSettings.public_repo ?? undefined,
    repo_branch: buildSettings.repo_branch ?? undefined,
    repo_path: buildSettings.repo_path ?? undefined,
    repo_url: buildSettings.repo_url ?? undefined,
    stop_builds: buildSettings.stop_builds ?? undefined,
  };

  return {
    build_image: input.primarySite.buildImage ?? undefined,
    build_settings: mirroredRepoInfo,
    functions_region: input.primarySite.functionsRegion ?? undefined,
    name: input.desiredName,
    processing_settings: input.primarySite.processingSettings ?? undefined,
    repo: mirroredRepoInfo,
  };
}

function createRepoBackedNetlifySite(input: {
  desiredName: string;
  primarySite: NetlifySiteDetails;
}) {
  const accountSlug = input.primarySite.accountSlug?.trim();
  const apiMethod = accountSlug ? 'createSiteInTeam' : 'createSite';
  const payload = buildRepoBackedNetlifySitePayload(input);
  const args = ['api', apiMethod, '--data'];
  if (apiMethod === 'createSiteInTeam' && accountSlug) {
    args.push(JSON.stringify({ account_slug: accountSlug, ...payload }));
  } else {
    args.push(JSON.stringify(payload));
  }

  const result = runCommand('netlify', args);
  const created = parseJsonOutput<{ id?: string; name?: string }>(result) ?? null;
  if (!created?.id) {
    return null;
  }

  return getNetlifySiteDetails(created.id) ?? resolveNetlifySite(input.desiredName);
}

function configureNetlifySiteRepository(input: {
  siteId: string;
  desiredName: string;
  primarySite: NetlifySiteDetails;
}) {
  const payload = buildRepoBackedNetlifySitePayload({
    desiredName: input.desiredName,
    primarySite: input.primarySite,
  });
  const result = runCommand('netlify', [
    'api',
    'updateSite',
    '--data',
    JSON.stringify({
      site_id: input.siteId,
      ...payload,
    }),
  ]);
  return {
    error: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    ok: result.ok,
  };
}

function triggerNetlifySiteBuild(siteId: string, buildHookUrl?: string | null) {
  const apiResult = runCommand('netlify', [
    'api',
    'createSiteBuild',
    '--data',
    JSON.stringify({ site_id: siteId }),
  ]);
  if (apiResult.ok) {
    return {
      error: '',
      ok: true,
      triggeredVia: 'api' as const,
    };
  }

  if (buildHookUrl?.trim()) {
    const hookResult = runCommand('curl', ['-sf', '-X', 'POST', buildHookUrl.trim()]);
    if (hookResult.ok) {
      return {
        error: '',
        ok: true,
        triggeredVia: 'build-hook' as const,
      };
    }

    return {
      error: [apiResult.stdout, apiResult.stderr, hookResult.stdout, hookResult.stderr]
        .filter(Boolean)
        .join('\n')
        .trim(),
      ok: false,
      triggeredVia: 'build-hook' as const,
    };
  }

  return {
    error: [apiResult.stdout, apiResult.stderr].filter(Boolean).join('\n').trim(),
    ok: false,
    triggeredVia: 'api' as const,
  };
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
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
      siteId?: string;
    };
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

  const initialBuildResult = triggerNetlifySiteBuild(drNetlifySite.id, buildHookUrl);
  if (initialBuildResult.ok) {
    const detail = initialBuildResult.triggeredVia === 'build-hook' ? ' via build hook' : '';
    console.log(`- Triggered initial Netlify DR site build${detail}`);
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
}

main().catch((error) => {
  console.error('\n❌ DR Netlify setup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
