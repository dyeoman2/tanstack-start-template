import { ensureNetlifyOk, runNetlify } from './netlify-cli';

export type NetlifyEnvSyncInput = {
  authToken: string;
  /** Defaults to production only. Pass `contexts` to fan out explicitly. */
  contexts?: Array<'production' | 'deploy-preview' | 'branch-deploy' | 'dev'>;
  siteId: string;
};

/**
 * Sets a Netlify site env var. Uses `NETLIFY_SITE_ID` + `NETLIFY_AUTH_TOKEN`.
 */
export function netlifyEnvSet(
  input: NetlifyEnvSyncInput & {
    context: 'production' | 'deploy-preview' | 'branch-deploy' | 'dev';
    force?: boolean;
    key: string;
    secret?: boolean;
    value: string;
  },
) {
  const args = ['env:set', input.key, input.value, '--context', input.context];
  if (input.secret) {
    args.push('--secret');
  }
  if (input.force !== false) {
    args.push('--force');
  }

  const result = runNetlify(args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NETLIFY_AUTH_TOKEN: input.authToken,
      NETLIFY_SITE_ID: input.siteId,
    },
  });
  ensureNetlifyOk(result, 'Netlify env:set failed');
}

const DEFAULT_CONTEXTS: Array<'production'> = ['production'];

export function syncNetlifyProductionRuntimeAndBuildVars(
  input: NetlifyEnvSyncInput & {
    includeDeployPreview?: boolean;
    viteConvexUrl: string;
  },
) {
  const contexts =
    input.includeDeployPreview === false
      ? (['production'] as const)
      : (input.contexts ?? DEFAULT_CONTEXTS);

  for (const context of contexts) {
    netlifyEnvSet({
      ...input,
      context,
      key: 'VITE_CONVEX_URL',
      value: input.viteConvexUrl,
    });
  }
}
