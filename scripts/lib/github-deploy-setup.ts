import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { readNetlifyLinkedSiteIdFromDisk } from './netlify-cli';
import { isLikelyConvexDeployKey, parseGitHubRepoFromRemote } from './setup-dr';

export type DeployEnvironmentName = 'staging' | 'production';

export type EnvironmentConfig = {
  convexDeployKey: string;
  deploySmokeBaseUrl: string;
  netlifyAuthToken: string;
  netlifyBuildHookUrl: string;
  netlifySiteId: string;
};

type NetlifySite = {
  custom_domain?: string | null;
  id: string;
  name: string;
  ssl_url?: string | null;
  url?: string | null;
};

type NetlifyBuildHook = {
  branch?: string | null;
  title?: string | null;
  url?: string | null;
};

export function run(command: string, args: string[]) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
}

function runCapture(command: string, args: string[]) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function ask(question: string, initialValue?: string) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    if (initialValue) {
      rl.write(initialValue);
    }
  });
}

export const askInput = ask;

export async function askRequired(question: string, initialValue?: string) {
  while (true) {
    const value = await ask(question, initialValue);
    if (value.length > 0) {
      return value;
    }
    console.log('A value is required.');
  }
}

export async function askYesNo(question: string, defaultValue = true) {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${question} (${suffix}): `)).toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  return answer.startsWith('y');
}

export async function chooseOrPromptSecret(
  label: string,
  discoveredValue?: string | null,
  discoveredSource?: string,
) {
  if (discoveredValue) {
    const useDetected = await askYesNo(
      `Use detected ${label}${discoveredSource ? ` from ${discoveredSource}` : ''}?`,
      true,
    );
    if (useDetected) {
      return discoveredValue;
    }
  }

  return await askRequired(`${label}: `);
}

export function normalizeUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(candidate);
  return parsed.origin;
}

function ensureEnvironment(repo: string, environment: DeployEnvironmentName) {
  run('gh', ['api', '--method', 'PUT', `repos/${repo}/environments/${environment}`]);
}

function setEnvironmentSecret(
  repo: string,
  environment: DeployEnvironmentName,
  name: string,
  value: string,
) {
  run('gh', ['secret', 'set', name, '--repo', repo, '--env', environment, '--body', value]);
}

export function setRepositorySecret(repo: string, name: string, value: string) {
  run('gh', ['secret', 'set', name, '--repo', repo, '--body', value]);
}

function setEnvironmentVariable(
  repo: string,
  environment: DeployEnvironmentName,
  name: string,
  value: string,
) {
  run('gh', ['variable', 'set', name, '--repo', repo, '--env', environment, '--body', value]);
}

export function setGitHubActionsArtifactRetentionDays(repo: string, days: number) {
  run('gh', [
    'api',
    '--method',
    'PUT',
    `repos/${repo}/actions/permissions/artifact-and-log-retention`,
    '-H',
    'Accept: application/vnd.github+json',
    '-F',
    `days=${days}`,
  ]);
}

export function discoverRepo() {
  try {
    const remote = runCapture('git', ['config', '--get', 'remote.origin.url']);
    return parseGitHubRepoFromRemote(remote);
  } catch {
    return null;
  }
}

export function discoverLinkedNetlifySiteId() {
  return readNetlifyLinkedSiteIdFromDisk();
}

function readNetlifyCliToken() {
  const configPath = path.join(homedir(), 'Library', 'Preferences', 'netlify', 'config.json');
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
      userId?: string;
      users?: Record<string, { auth?: { token?: string } }>;
    };
    const userId = parsed.userId?.trim();
    if (!userId) {
      return null;
    }
    return parsed.users?.[userId]?.auth?.token?.trim() || null;
  } catch {
    return null;
  }
}

async function netlifyRequest<T>(
  token: string,
  pathname: string,
  init?: RequestInit,
): Promise<T | null> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(`https://api.netlify.com/api/v1${pathname}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Netlify API ${init?.method ?? 'GET'} ${pathname} failed (${response.status}): ${detail}`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
}

async function listNetlifySites(token: string) {
  return (await netlifyRequest<NetlifySite[]>(token, '/sites')) ?? [];
}

async function getNetlifySite(token: string, siteId: string) {
  return await netlifyRequest<NetlifySite>(token, `/sites/${siteId}`);
}

async function resolveNetlifySite(token: string, siteInput: string) {
  const trimmed = siteInput.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const site = await getNetlifySite(token, trimmed);
    if (site?.id) {
      return site;
    }
  } catch {
    // Fall through to list-based resolution.
  }

  const sites = await listNetlifySites(token);
  return sites.find((site) => site.id === trimmed || site.name === trimmed) ?? null;
}

function getNetlifySiteOrigin(site: Pick<NetlifySite, 'custom_domain' | 'ssl_url' | 'url'>) {
  const candidate = site.ssl_url ?? site.custom_domain ?? site.url;
  return candidate ? normalizeUrl(candidate) : null;
}

async function listNetlifyBuildHooks(token: string, siteId: string) {
  return (await netlifyRequest<NetlifyBuildHook[]>(token, `/sites/${siteId}/build_hooks`)) ?? [];
}

async function createNetlifyBuildHook(
  token: string,
  siteId: string,
  title: string,
  branch: string,
) {
  const created = await netlifyRequest<NetlifyBuildHook>(token, `/sites/${siteId}/build_hooks`, {
    body: JSON.stringify({ branch, title }),
    method: 'POST',
  });
  return created?.url?.trim() || null;
}

async function ensureNetlifyBuildHook(
  token: string,
  siteId: string,
  environment: DeployEnvironmentName,
  branch: string,
) {
  const desiredTitle = `GitHub Deploy (${environment})`;
  const hooks = await listNetlifyBuildHooks(token, siteId);
  const existing =
    hooks.find((hook) => hook.title === desiredTitle && hook.url) ??
    hooks.find((hook) => hook.branch === branch && hook.url);
  if (existing?.url) {
    return existing.url;
  }

  return await createNetlifyBuildHook(token, siteId, desiredTitle, branch);
}

export function discoverConvexDeployKey() {
  const envValue = process.env.CONVEX_DEPLOY_KEY?.trim();
  if (envValue && isLikelyConvexDeployKey(envValue)) {
    return envValue;
  }

  return null;
}

export function validateProductionConvexDeployKey(value: string) {
  const trimmed = value.trim();
  return isLikelyConvexDeployKey(trimmed) && trimmed.startsWith('prod:');
}

export async function promptForProductionConvexDeployKey(initialValue?: string | null) {
  while (true) {
    const value = await chooseOrPromptSecret(
      'production CONVEX_DEPLOY_KEY',
      initialValue,
      initialValue ? 'CONVEX_DEPLOY_KEY' : undefined,
    );
    if (validateProductionConvexDeployKey(value)) {
      return value.trim();
    }

    console.log(
      'A production-scoped Convex deploy key is required. Generate one in Convex Dashboard -> Settings -> Deploy Keys.',
    );
    initialValue = undefined;
  }
}

export function discoverNetlifyAuthToken() {
  const envValue = process.env.NETLIFY_AUTH_TOKEN?.trim();
  if (envValue) {
    return envValue;
  }

  return readNetlifyCliToken();
}

export async function collectEnvironmentConfig(
  environment: DeployEnvironmentName,
  token: string,
  fallback?: Partial<EnvironmentConfig>,
) {
  const defaultBranch = environment === 'production' ? 'main' : 'staging';
  const linkedSiteId = discoverLinkedNetlifySiteId();
  const defaultSiteInput =
    fallback?.netlifySiteId ??
    (environment === 'production' ? (linkedSiteId ?? undefined) : undefined);

  console.log(`\nConfiguring ${environment} deploy environment`);

  const convexDeployKey = fallback?.convexDeployKey
    ? fallback.convexDeployKey
    : await promptForProductionConvexDeployKey(discoverConvexDeployKey());

  const siteInput = await askRequired(`${environment} Netlify site id or name: `, defaultSiteInput);
  const site = await resolveNetlifySite(token, siteInput);
  if (!site) {
    throw new Error(`Could not resolve Netlify site "${siteInput}" for ${environment}.`);
  }

  const inferredSmokeUrl = getNetlifySiteOrigin(site);
  const netlifyBuildHookUrl =
    (await ensureNetlifyBuildHook(token, site.id, environment, defaultBranch)) ??
    fallback?.netlifyBuildHookUrl ??
    '';
  if (!netlifyBuildHookUrl) {
    throw new Error(`Could not determine a Netlify build hook URL for ${environment}.`);
  }

  const deploySmokeBaseUrl = normalizeUrl(
    await askRequired(
      `${environment} DEPLOY_SMOKE_BASE_URL: `,
      fallback?.deploySmokeBaseUrl ?? inferredSmokeUrl ?? undefined,
    ),
  );

  console.log(`- Netlify site: ${site.name} (${site.id})`);
  console.log('- Build hook: ready');
  console.log(`- Smoke URL: ${deploySmokeBaseUrl}`);

  return {
    convexDeployKey,
    deploySmokeBaseUrl,
    netlifyAuthToken: token,
    netlifyBuildHookUrl,
    netlifySiteId: site.id,
  } satisfies EnvironmentConfig;
}

export async function applyEnvironmentConfig(
  repo: string,
  environment: DeployEnvironmentName,
  config: EnvironmentConfig,
) {
  ensureEnvironment(repo, environment);
  setEnvironmentSecret(repo, environment, 'CONVEX_DEPLOY_KEY', config.convexDeployKey);
  setEnvironmentSecret(repo, environment, 'NETLIFY_BUILD_HOOK_URL', config.netlifyBuildHookUrl);
  setEnvironmentSecret(repo, environment, 'NETLIFY_AUTH_TOKEN', config.netlifyAuthToken);
  setEnvironmentSecret(repo, environment, 'NETLIFY_SITE_ID', config.netlifySiteId);
  setEnvironmentVariable(repo, environment, 'DEPLOY_SMOKE_BASE_URL', config.deploySmokeBaseUrl);
}

export async function configureGitHubDeployEnvironments(input: {
  netlifyAuthToken?: string;
  productionConvexDeployKey?: string;
  productionDeploySmokeBaseUrl?: string;
  repo?: string;
}) {
  const repo =
    input.repo ?? (await askRequired('GitHub repo (owner/name): ', discoverRepo() ?? undefined));
  const discoveredNetlifyToken = input.netlifyAuthToken ?? discoverNetlifyAuthToken();
  const netlifyAuthToken = await chooseOrPromptSecret(
    'Netlify auth token',
    discoveredNetlifyToken,
    discoveredNetlifyToken === process.env.NETLIFY_AUTH_TOKEN?.trim()
      ? 'NETLIFY_AUTH_TOKEN'
      : discoveredNetlifyToken
        ? 'local Netlify CLI config'
        : undefined,
  );

  const production = await collectEnvironmentConfig('production', netlifyAuthToken, {
    convexDeployKey: input.productionConvexDeployKey ?? discoverConvexDeployKey() ?? undefined,
    deploySmokeBaseUrl: input.productionDeploySmokeBaseUrl,
  });

  const reuseDefaults = await askYesNo('Reuse production values as defaults for staging?', true);
  const staging = reuseDefaults
    ? await collectEnvironmentConfig('staging', netlifyAuthToken, production)
    : await collectEnvironmentConfig('staging', netlifyAuthToken, {
        convexDeployKey: production.convexDeployKey,
      });

  await applyEnvironmentConfig(repo, 'production', production);
  await applyEnvironmentConfig(repo, 'staging', staging);
  setRepositorySecret(repo, 'CONVEX_DEPLOY_KEY', production.convexDeployKey);
  setGitHubActionsArtifactRetentionDays(repo, 30);

  return { production, repo, staging };
}
