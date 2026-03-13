export type OpenRouterConfig = {
  apiKey: string;
  headers?: Record<string, string>;
  compatibility: 'strict';
};

export function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim();
  const siteName = process.env.OPENROUTER_SITE_NAME?.trim();
  const headers =
    siteUrl || siteName
      ? {
          ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
          ...(siteName ? { 'X-Title': siteName } : {}),
        }
      : undefined;

  return {
    apiKey,
    headers,
    compatibility: 'strict',
  };
}

export function getOpenRouterAttributionHeaders() {
  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim();
  const siteName = process.env.OPENROUTER_SITE_NAME?.trim();

  return siteUrl || siteName
    ? {
        ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
        ...(siteName ? { 'X-Title': siteName } : {}),
      }
    : undefined;
}
