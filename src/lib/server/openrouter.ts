const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_SITE_NAME = 'TanStack Start Template';

export type OpenRouterConfig = {
  apiKey: string;
  baseURL: string;
  headers: Record<string, string>;
};

export function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim() || process.env.PUBLIC_SITE_URL?.trim();
  const siteName = process.env.OPENROUTER_SITE_NAME?.trim() || OPENROUTER_SITE_NAME;

  const headers: Record<string, string> = {
    'HTTP-Referer': siteUrl || 'http://localhost:3000',
    'X-Title': siteName,
  };

  return {
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers,
  };
}
