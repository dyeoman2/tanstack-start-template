export type DrSetupFlags = {
  domain?: string;
  githubRepo?: string;
  help: boolean;
  json: boolean;
  netlifySite?: string;
  projectSlug?: string;
  skipCloudflare: boolean;
  skipEcs: boolean;
  skipGithub: boolean;
  skipNetlify: boolean;
  yes: boolean;
};

function readFlagValue(argv: readonly string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

export function parseSetupDrArgs(argv: readonly string[]): DrSetupFlags {
  const flags: DrSetupFlags = {
    help: false,
    json: false,
    skipCloudflare: false,
    skipEcs: false,
    skipGithub: false,
    skipNetlify: false,
    yes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--yes':
        flags.yes = true;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--skip-netlify':
        flags.skipNetlify = true;
        break;
      case '--skip-github':
        flags.skipGithub = true;
        break;
      case '--skip-ecs':
        flags.skipEcs = true;
        break;
      case '--skip-cloudflare':
        flags.skipCloudflare = true;
        break;
      case '--domain':
        flags.domain = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--project-slug':
        flags.projectSlug = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--github-repo':
        flags.githubRepo = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case '--netlify-site':
        flags.netlifySite = readFlagValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return flags;
}

export function parseGitHubRepoFromRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return httpsMatch[1] ?? null;
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/.]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return sshMatch[1] ?? null;
  }

  const sshProtocolMatch = trimmed.match(
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/i,
  );
  if (sshProtocolMatch) {
    return sshProtocolMatch[1] ?? null;
  }

  return null;
}

export function parseConvexEnvList(output: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('=')) {
      continue;
    }

    const firstEquals = trimmed.indexOf('=');
    if (firstEquals <= 0) {
      continue;
    }

    const key = trimmed.slice(0, firstEquals).trim();
    const value = trimmed.slice(firstEquals + 1);
    if (!key) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function extractJsonText(raw: string): string | null {
  const lines = raw.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trimStart() ?? '';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return lines.slice(index).join('\n').trim();
    }
  }

  return null;
}

export function getStorageCoverageWarning(envVars: Record<string, string>): string | null {
  const backend = (envVars.FILE_STORAGE_BACKEND ?? 'convex').trim();

  if (backend === 'convex') {
    return 'Production uses FILE_STORAGE_BACKEND=convex, so convex export covers database restore only and not uploaded Convex file blobs.';
  }

  if (backend === 's3-primary' || backend === 's3-mirror') {
    return null;
  }

  return `Production uses FILE_STORAGE_BACKEND=${backend}. Review file-storage DR coverage before relying on the exported backup flow.`;
}

export function getRequiredStorageDrEnvKeys(envVars: Record<string, string>): string[] {
  const backend = (envVars.FILE_STORAGE_BACKEND ?? 'convex').trim();
  if (backend === 's3-primary' || backend === 's3-mirror') {
    return [
      'FILE_STORAGE_BACKEND',
      'AWS_REGION',
      'AWS_S3_FILES_BUCKET',
      'CONVEX_SITE_URL',
      'AWS_FILE_SERVE_SIGNING_SECRET',
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET',
    ];
  }

  return [];
}

export function getRequiredRecoveryEnvKeys(envVars: Record<string, string>): string[] {
  return ['BETTER_AUTH_SECRET', 'JWKS', ...getRequiredStorageDrEnvKeys(envVars)];
}

export function extractHostnameFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).hostname;
  } catch {
    return null;
  }
}

export function buildRequiredNetlifyDrEnvVars(
  envVars: Record<string, string>,
  origins: {
    backendOrigin: string;
    frontendOrigin: string;
    siteOrigin: string;
  },
): Record<string, string> {
  const result: Record<string, string> = {
    APP_NAME: envVars.APP_NAME?.trim() || 'TanStack Start Template DR',
    APP_URL: origins.frontendOrigin,
    BETTER_AUTH_SECRET: envVars.BETTER_AUTH_SECRET?.trim() || '',
    BETTER_AUTH_URL: origins.frontendOrigin,
    CONVEX_SITE_URL: origins.siteOrigin,
    VITE_CONVEX_SITE_URL: origins.siteOrigin,
    VITE_CONVEX_URL: origins.backendOrigin,
  };

  const storageKeys = getRequiredStorageDrEnvKeys(envVars);
  for (const key of storageKeys) {
    const value = envVars[key]?.trim();
    if (value) {
      result[key] = key === 'CONVEX_SITE_URL' ? origins.siteOrigin : value;
    }
  }

  return result;
}

export function isLikelyConvexDeployKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('prod:') && trimmed.length > 'prod:'.length;
}

export function buildDrSecretNames(projectSlug: string) {
  return {
    cloudflareDnsToken: `${projectSlug}-dr-cloudflare-dns-token-secret`,
    cloudflareZoneId: `${projectSlug}-dr-cloudflare-zone-id-secret`,
    convexEnv: `${projectSlug}-dr-convex-env-secret`,
    netlifyBuildHook: `${projectSlug}-dr-netlify-build-hook-secret`,
    netlifyFrontendCnameTarget: `${projectSlug}-dr-netlify-frontend-cname-target-secret`,
  };
}

export function buildDefaultBackupBucketName(projectSlug: string, accountId?: string, region?: string) {
  const suffix = [accountId, region].filter(Boolean).join('-');
  return suffix
    ? `${projectSlug}-dr-backup-bucket-${suffix}`
    : `${projectSlug}-dr-backup-bucket`;
}
