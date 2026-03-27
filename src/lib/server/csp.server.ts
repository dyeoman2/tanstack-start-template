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

  const imgSrc = unique(["'self'", 'data:', 'blob:']);
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
    // react-remove-scroll (Radix Dialog / Sheet / AlertDialog) injects a fixed <style> for scroll lock;
    // allow that exact stylesheet via hash without opening all inline styles.
    "style-src 'self' 'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='",
    // ACCEPTED RESIDUAL RISK: style-src-attr 'unsafe-inline' is required because
    // Radix UI (Dialog, Select, Dropdown, Navigation Menu, Tooltip) injects runtime
    // CSS custom properties (--radix-*) as inline style attributes computed from DOM
    // measurements. These values change dynamically and cannot be hashed or nonce-gated
    // without forking the component library. Verified infeasible to remove 2026-03-26.
    // Compensating controls:
    //   1. script-src is nonce-locked — CSS cannot execute JavaScript
    //   2. CSP violation reports are monitored via /api/csp-report
    //   3. frame-ancestors 'none' prevents clickjacking-based CSS exfiltration
    // CSS injection via style attributes is lower severity than script injection and could
    // theoretically enable data exfiltration via CSS selectors in a targeted attack, but this
    // is mitigated by the controls above. This is a known limitation tracked in the security
    // control register.
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
