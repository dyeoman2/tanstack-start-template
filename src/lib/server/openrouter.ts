import { assertVendorBoundary } from './vendor-boundary.server';

export type OpenRouterConfig = {
  apiKey: string;
  headers?: Record<string, string>;
  compatibility: 'strict';
  /** Always 'strict' — ZDR is enforced on all requests. */
  privacyMode: 'strict';
};

/**
 * Privacy mode is always strict — ZDR (Zero Data Retention) and
 * data_collection: 'deny' are applied to every OpenRouter request.
 *
 * This is a non-negotiable baseline for PHI-sensitive deployments.
 * The OPENROUTER_PRIVACY_MODE env var is accepted for backwards
 * compatibility but only 'strict' is allowed in production; any
 * other value causes a hard startup error.
 */
function getOpenRouterPrivacyMode() {
  const privacyMode = process.env.OPENROUTER_PRIVACY_MODE?.trim();

  if (!privacyMode || privacyMode === 'strict') {
    return 'strict' as const;
  }

  throw new Error(
    'OPENROUTER_PRIVACY_MODE must be "strict" (or unset, which defaults to strict). ' +
      'ZDR is required for all deployments to satisfy PHI-sensitive data handling requirements.',
  );
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
