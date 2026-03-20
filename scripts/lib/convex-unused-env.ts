/**
 * Convex env names that are not referenced anywhere in this application.
 * Used by `pnpm run convex:env:hygiene` to suggest removals. Extend if you add integrations.
 */
export const UNUSED_CONVEX_ENV_EXACT = new Set([
  'AUTUMN_SECRET_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_GATEWAY_ID',
  'FIRECRAWL_API_KEY',
]);

const UNUSED_PREFIXES = ['AUTUMN_', 'CLOUDFLARE_', 'FIRECRAWL_'] as const;

export function isLikelyUnusedConvexEnvName(name: string): boolean {
  if (UNUSED_CONVEX_ENV_EXACT.has(name)) {
    return true;
  }
  return UNUSED_PREFIXES.some((prefix) => name.startsWith(prefix));
}
