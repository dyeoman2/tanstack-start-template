import { assertVendorBoundary } from './vendor-boundary.server';

export type OpenRouterConfig = {
  apiKey: string;
  headers?: Record<string, string>;
  compatibility: 'strict';
  privacyMode: 'standard' | 'strict';
};

function getOpenRouterPrivacyMode() {
  const privacyMode = process.env.OPENROUTER_PRIVACY_MODE?.trim();

  if (!privacyMode) {
    return 'standard' as const;
  }

  if (privacyMode === 'standard' || privacyMode === 'strict') {
    return privacyMode;
  }

  throw new Error('OPENROUTER_PRIVACY_MODE must be "standard" or "strict"');
}

export function getOpenRouterConfig(): OpenRouterConfig {
  assertVendorBoundary({
    vendor: 'openrouter',
    dataClasses: ['chat_metadata', 'chat_prompt'],
  });

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  const siteUrl = process.env.BETTER_AUTH_URL?.trim();
  const siteName = process.env.APP_NAME?.trim();
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
    privacyMode: getOpenRouterPrivacyMode(),
  };
}

export function hasOpenRouterConfig() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function getOpenRouterAttributionHeaders() {
  const siteUrl = process.env.BETTER_AUTH_URL?.trim();
  const siteName = process.env.APP_NAME?.trim();

  return siteUrl || siteName
    ? {
        ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
        ...(siteName ? { 'X-Title': siteName } : {}),
      }
    : undefined;
}
