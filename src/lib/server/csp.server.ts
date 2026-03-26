import { randomBytes } from 'node:crypto';

export const CSP_MODE_ENV_NAME = 'CSP_MODE';
export const CSP_REPORT_URI = '/api/csp-report';

export type DocumentCspMode = 'enforce' | 'report-only';

type BuildDocumentContentSecurityPolicyOptions = {
  convexOrigin?: string | null;
  /**
   * When true, allows `'unsafe-eval'` in `script-src`. Vite’s dev server relies on `eval()` for HMR
   * and module transforms; production builds do not need this.
   */
  allowUnsafeEval?: boolean;
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

function resolveAllowUnsafeEval(
  explicit: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }

  return env.NODE_ENV === 'development';
}

export function buildDocumentContentSecurityPolicy({
  convexOrigin,
  allowUnsafeEval: allowUnsafeEvalOption,
  mode: _mode = 'enforce',
  nonce,
  sentryOrigin,
}: BuildDocumentContentSecurityPolicyOptions) {
  const allowUnsafeEval = resolveAllowUnsafeEval(allowUnsafeEvalOption);
  const connectSrc = unique([
    "'self'",
    convexOrigin,
    convexOrigin ? toWebSocketOrigin(convexOrigin) : null,
    sentryOrigin,
  ]);

  const imgSrc = unique(["'self'", 'data:', 'blob:', 'https://www.google.com']);
  const fontSrc = unique(["'self'", 'data:']);
  const scriptSrcParts = ["'self'", `'nonce-${nonce}'`];
  if (allowUnsafeEval) {
    scriptSrcParts.push("'unsafe-eval'");
  }

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSrcParts.join(' ')}`,
    "style-src 'self'",
    // Accepted residual risk: 'unsafe-inline' is required for style-src-attr because Tailwind CSS
    // and shadcn/ui apply inline style attributes (e.g., style="--radix-*") that cannot be nonce-gated.
    // CSS injection via style attributes is lower severity than script injection — it cannot execute
    // JavaScript, but could theoretically enable data exfiltration via CSS selectors in a targeted
    // attack. This is acceptable given the nonce-gated script-src and the framework dependency.
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
