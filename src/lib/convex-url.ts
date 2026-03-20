export function normalizeUrlOrigin(value: string) {
  return value.trim().replace(/\/$/, '');
}

export function deriveConvexSiteUrl(convexUrl: string) {
  const normalized = normalizeUrlOrigin(convexUrl);
  if (normalized.endsWith('.convex.cloud')) {
    return normalized.replace(/\.convex\.cloud$/, '.convex.site');
  }

  return normalized;
}
