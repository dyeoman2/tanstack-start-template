import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type NetlifyCommandResult = {
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  stdout: string;
};

export type NetlifySite = {
  accountSlug?: string;
  buildSettings?: NetlifySiteBuildSettings | null;
  id: string;
  name: string;
  sslUrl?: string;
  url?: string;
};

export type NetlifySiteBuildSettings = {
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

export type NetlifySiteDetails = NetlifySite & {
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

export type NetlifyDeploy = {
  adminUrl?: string | null;
  createdAt?: string | null;
  errorMessage?: string | null;
  id: string;
  name?: string | null;
  sslUrl?: string | null;
  state?: string | null;
  url?: string | null;
};

export function isNetlifySiteRepoBacked(site: Pick<NetlifySiteDetails, 'buildSettings'> | null) {
  const buildSettings = site?.buildSettings;
  if (!buildSettings) {
    return false;
  }

  return Boolean(
    buildSettings.repo_url?.trim() ||
    buildSettings.installation_id ||
    buildSettings.provider?.trim(),
  );
}

export function runNetlify(
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): NetlifyCommandResult {
  const spawned = spawnSync('netlify', args, {
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

export function ensureNetlifyOk(result: NetlifyCommandResult, message: string) {
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

export function parseNetlifyJsonOutput<T>(result: NetlifyCommandResult): T | null {
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

export function buildNetlifySiteTempDir(siteId: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'netlify-site-'));
  mkdirSync(path.join(tempDir, '.netlify'), { recursive: true });
  writeFileSync(path.join(tempDir, '.netlify', 'state.json'), JSON.stringify({ siteId }, null, 2));
  return tempDir;
}

export function listNetlifySites(): NetlifySite[] {
  const result = runNetlify(['sites:list', '--json']);
  if (!result.ok) {
    return [];
  }

  const parsed =
    parseNetlifyJsonOutput<
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

export function resolveNetlifySite(siteInput: string) {
  const sites = listNetlifySites();
  return sites.find((site) => site.id === siteInput || site.name === siteInput) ?? null;
}

export function getNetlifySiteDetails(siteId: string): NetlifySiteDetails | null {
  const result = runNetlify(['api', 'getSite', '--data', JSON.stringify({ site_id: siteId })]);
  const parsed =
    parseNetlifyJsonOutput<{
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

export function buildRepoBackedNetlifySitePayload(input: {
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

export function createRepoBackedNetlifySite(input: {
  desiredName: string;
  primarySite: NetlifySiteDetails;
}): NetlifySiteDetails | NetlifySite | null {
  const accountSlug = input.primarySite.accountSlug?.trim();
  const apiMethod = accountSlug ? 'createSiteInTeam' : 'createSite';
  const payload = buildRepoBackedNetlifySitePayload(input);
  const args = ['api', apiMethod, '--data'];
  if (apiMethod === 'createSiteInTeam' && accountSlug) {
    args.push(JSON.stringify({ account_slug: accountSlug, ...payload }));
  } else {
    args.push(JSON.stringify(payload));
  }

  const result = runNetlify(args);
  const created = parseNetlifyJsonOutput<{ id?: string; name?: string }>(result) ?? null;
  if (!created?.id) {
    return null;
  }

  const siteDetails = getNetlifySiteDetails(created.id);
  if (siteDetails) {
    return siteDetails;
  }

  return resolveNetlifySite(input.desiredName);
}

export function configureNetlifySiteRepository(input: {
  siteId: string;
  desiredName: string;
  primarySite: NetlifySiteDetails;
}) {
  const payload = buildRepoBackedNetlifySitePayload({
    desiredName: input.desiredName,
    primarySite: input.primarySite,
  });
  const result = runNetlify([
    'api',
    'updateSite',
    '--data',
    JSON.stringify({
      site_id: input.siteId,
      ...payload,
    }),
  ]);
  const error = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (!result.ok) {
    return {
      error,
      ok: false,
      site: null as NetlifySiteDetails | null,
    };
  }

  const updatedSite = getNetlifySiteDetails(input.siteId);
  if (!isNetlifySiteRepoBacked(updatedSite)) {
    return {
      error:
        error ||
        'Netlify accepted the repository update request, but the site still has no repo/build metadata afterward.',
      ok: false,
      site: updatedSite,
    };
  }

  return {
    error,
    ok: true,
    site: updatedSite,
  };
}

export function reinitializeNetlifySiteContinuousDeployment(input: {
  authToken?: string;
  gitRemoteName?: string;
  siteId: string;
}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'netlify-init-'));
  const worktreeAdd = spawnSync('git', ['worktree', 'add', '--detach', tempDir, 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (worktreeAdd.status !== 0) {
    rmSync(tempDir, { force: true, recursive: true });
    return {
      error: [worktreeAdd.stdout, worktreeAdd.stderr].filter(Boolean).join('\n').trim(),
      ok: false,
      site: null as NetlifySiteDetails | null,
    };
  }

  try {
    const linkArgs = ['link', '--id', input.siteId];
    if (input.gitRemoteName?.trim()) {
      linkArgs.push('--git-remote-name', input.gitRemoteName.trim());
    }
    if (input.authToken?.trim()) {
      linkArgs.push('--auth', input.authToken.trim());
    }

    const linked = runNetlify(linkArgs, { cwd: tempDir });
    if (!linked.ok) {
      return {
        error: [linked.stdout, linked.stderr].filter(Boolean).join('\n').trim(),
        ok: false,
        site: null as NetlifySiteDetails | null,
      };
    }

    const initArgs = ['init', '--forceReinitialize'];
    if (input.gitRemoteName?.trim()) {
      initArgs.push('--git-remote-name', input.gitRemoteName.trim());
    }
    if (input.authToken?.trim()) {
      initArgs.push('--auth', input.authToken.trim());
    }

    const initialized = spawnSync('netlify', initArgs, {
      cwd: tempDir,
      encoding: 'utf8',
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(input.authToken?.trim() ? { NETLIFY_AUTH_TOKEN: input.authToken.trim() } : {}),
      },
    });

    if (initialized.status !== 0) {
      return {
        error: initialized.error?.message ?? 'netlify init --forceReinitialize failed',
        ok: false,
        site: null as NetlifySiteDetails | null,
      };
    }

    const updatedSite = getNetlifySiteDetails(input.siteId);
    if (!isNetlifySiteRepoBacked(updatedSite)) {
      return {
        error:
          'Netlify init completed, but the DR site still has no repo/build metadata afterward.',
        ok: false,
        site: updatedSite,
      };
    }

    return {
      error: '',
      ok: true,
      site: updatedSite,
    };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', tempDir], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    rmSync(tempDir, { force: true, recursive: true });
  }
}

export type NetlifyTriggerBuildResult = {
  deployId?: string | null;
  error: string;
  ok: boolean;
  triggeredVia?: 'api' | 'build-hook';
};

function normalizeNetlifyDeploy(input: {
  admin_url?: string;
  created_at?: string;
  error_message?: string;
  id?: string;
  name?: string;
  ssl_url?: string;
  state?: string;
  url?: string;
}): NetlifyDeploy | null {
  if (!input.id) {
    return null;
  }

  return {
    adminUrl: input.admin_url ?? null,
    createdAt: input.created_at ?? null,
    errorMessage: input.error_message ?? null,
    id: input.id,
    name: input.name ?? null,
    sslUrl: input.ssl_url ?? null,
    state: input.state ?? null,
    url: input.url ?? null,
  };
}

export function getNetlifyDeploy(deployId: string): NetlifyDeploy | null {
  const result = runNetlify([
    'api',
    'getDeploy',
    '--data',
    JSON.stringify({ deploy_id: deployId }),
  ]);
  const parsed =
    parseNetlifyJsonOutput<{
      admin_url?: string;
      created_at?: string;
      error_message?: string;
      id?: string;
      name?: string;
      ssl_url?: string;
      state?: string;
      url?: string;
    }>(result) ?? null;

  return parsed ? normalizeNetlifyDeploy(parsed) : null;
}

export function listNetlifySiteDeploys(siteId: string) {
  const result = runNetlify([
    'api',
    'listSiteDeploys',
    '--data',
    JSON.stringify({ site_id: siteId }),
  ]);
  const parsed =
    parseNetlifyJsonOutput<
      Array<{
        admin_url?: string;
        created_at?: string;
        error_message?: string;
        id?: string;
        name?: string;
        ssl_url?: string;
        state?: string;
        url?: string;
      }>
    >(result) ?? [];

  return parsed
    .map((deploy) => normalizeNetlifyDeploy(deploy))
    .filter((deploy): deploy is NetlifyDeploy => Boolean(deploy))
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTime - leftTime;
    });
}

export function waitForNetlifyDeployResult(input: {
  deployId?: string | null;
  pollIntervalMs?: number;
  siteId: string;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 5 * 60 * 1000;
  const pollIntervalMs = input.pollIntervalMs ?? 10 * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const deploy =
      (input.deployId ? getNetlifyDeploy(input.deployId) : null) ??
      listNetlifySiteDeploys(input.siteId)[0] ??
      null;

    if (deploy) {
      const normalizedState = deploy.state?.trim().toLowerCase() ?? '';
      if (['ready', 'current'].includes(normalizedState)) {
        return { deploy, ok: true, timedOut: false };
      }

      if (['error', 'failed'].includes(normalizedState)) {
        return { deploy, ok: false, timedOut: false };
      }
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollIntervalMs);
  }

  return {
    deploy:
      (input.deployId ? getNetlifyDeploy(input.deployId) : null) ??
      listNetlifySiteDeploys(input.siteId)[0] ??
      null,
    ok: false,
    timedOut: true,
  };
}

export function triggerNetlifySiteBuild(
  siteId: string,
  buildHookUrl?: string | null,
): NetlifyTriggerBuildResult {
  const apiResult = runNetlify([
    'api',
    'createSiteBuild',
    '--data',
    JSON.stringify({ site_id: siteId }),
  ]);
  const apiDeploy =
    parseNetlifyJsonOutput<{
      id?: string;
    }>(apiResult) ?? null;
  if (apiResult.ok) {
    return {
      deployId: apiDeploy?.id ?? null,
      error: '',
      ok: true,
      triggeredVia: 'api',
    };
  }

  if (buildHookUrl?.trim()) {
    const hookResult = spawnSync('curl', ['-sf', '-X', 'POST', buildHookUrl.trim()], {
      encoding: 'utf8',
    });
    if (hookResult.status === 0) {
      return {
        deployId: null,
        error: '',
        ok: true,
        triggeredVia: 'build-hook',
      };
    }

    return {
      error: [apiResult.stdout, apiResult.stderr, hookResult.stdout, hookResult.stderr]
        .filter(Boolean)
        .join('\n')
        .trim(),
      ok: false,
      triggeredVia: 'build-hook',
    };
  }

  return {
    deployId: null,
    error: [apiResult.stdout, apiResult.stderr].filter(Boolean).join('\n').trim(),
    ok: false,
    triggeredVia: 'api',
  };
}

export function setNetlifySiteEnvVar(
  siteId: string,
  key: string,
  value: string,
  context: 'production' | 'deploy-preview' | 'branch-deploy' | 'dev' = 'production',
) {
  const tempDir = buildNetlifySiteTempDir(siteId);
  try {
    ensureNetlifyOk(
      runNetlify(['env:set', key, value, '--context', context, '--force'], {
        cwd: tempDir,
      }),
      `Failed to set Netlify env var ${key} (${context})`,
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

export function getNetlifySiteEnvValue(siteId: string, key: string): string | null {
  const tempDir = buildNetlifySiteTempDir(siteId);
  try {
    const result = runNetlify(['env:get', key, '--context', 'production'], {
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

export function listNetlifySiteHooks(siteId: string) {
  const result = runNetlify([
    'api',
    'listSiteBuildHooks',
    '--data',
    JSON.stringify({ site_id: siteId }),
  ]);
  const parsed =
    parseNetlifyJsonOutput<Array<{ branch?: string; id?: string; title?: string; url?: string }>>(
      result,
    ) ?? [];
  if (parsed.length > 0) {
    return parsed;
  }

  const tempDir = buildNetlifySiteTempDir(siteId);
  try {
    const fallback = runNetlify(['status:hooks'], { cwd: tempDir });
    const urls = fallback.stdout.match(/https:\/\/[^\s]+/gu) ?? [];
    return urls.map((url, index) => ({
      id: `parsed-${index + 1}`,
      title: 'Existing build hook',
      url,
    }));
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

export function createNetlifyBuildHook(siteId: string, title: string, branch: string) {
  const result = runNetlify([
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

  return parseNetlifyJsonOutput<{ url?: string }>(result)?.url ?? null;
}

export function formatNetlifySiteSummary(site: NetlifySite | null) {
  if (!site) {
    return null;
  }
  const primaryUrl = site.sslUrl || site.url;
  return `${site.name} (id: ${site.id}${primaryUrl ? `, url: ${primaryUrl}` : ''})`;
}

export function readNetlifyLinkedSiteIdFromDisk() {
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
