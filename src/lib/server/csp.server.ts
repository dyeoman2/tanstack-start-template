import { randomBytes } from 'node:crypto';

export const CSP_MODE_ENV_NAME = 'CSP_MODE';
export const CSP_REPORT_URI = '/api/csp-report';

export type DocumentCspMode = 'enforce' | 'report-only';

type BuildDocumentContentSecurityPolicyOptions = {
  convexOrigin?: string | null;
  mode?: DocumentCspMode;
  nonce: string;
  sentryOrigin?: string | null;
};

function getOrigin(input: string | undefined): string | null {
  if (!input) {
    return null;
  }

  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

function unique(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))];
}

export function generateCspNonce() {
  return randomBytes(16).toString('base64url');
}

export function getConfiguredConvexOrigin() {
  return getOrigin(process.env.VITE_CONVEX_URL);
}

export function getConfiguredSentryOrigin() {
  return getOrigin(process.env.VITE_SENTRY_DSN);
}

export function getDocumentCspMode(env = process.env): DocumentCspMode {
  const configured = env[CSP_MODE_ENV_NAME]?.trim().toLowerCase();
  if (configured === 'report-only') {
    return 'report-only';
  }

  return 'enforce';
}

export function getDocumentCspHeaderName(mode: DocumentCspMode) {
  return mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

export function buildDocumentContentSecurityPolicy({
  convexOrigin,
  mode: _mode = 'enforce',
  nonce,
  sentryOrigin,
}: BuildDocumentContentSecurityPolicyOptions) {
  const connectSrc = unique([
    "'self'",
    convexOrigin,
    convexOrigin ? toWebSocketOrigin(convexOrigin) : null,
    sentryOrigin,
  ]);

  const imgSrc = unique(["'self'", 'data:', 'blob:', 'https://www.google.com']);
  const fontSrc = unique(["'self'", 'data:']);
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    `font-src ${fontSrc.join(' ')}`,
    `connect-src ${connectSrc.join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ];

  directives.push(`report-uri ${CSP_REPORT_URI}`);

  return directives.join('; ');
}

export function shouldSetStrictTransportSecurity(request: Request) {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}
