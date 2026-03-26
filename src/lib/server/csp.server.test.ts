import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDocumentContentSecurityPolicy,
  generateCspNonce,
  getDocumentCspHeaderName,
  getDocumentCspMode,
} from './csp.server';

describe('csp.server', () => {
  const originalCspMode = process.env.CSP_MODE;

  afterEach(() => {
    if (originalCspMode === undefined) {
      delete process.env.CSP_MODE;
      return;
    }

    process.env.CSP_MODE = originalCspMode;
  });

  it('builds a nonce-based policy with exact connect origins', () => {
    const policy = buildDocumentContentSecurityPolicy({
      convexOrigin: 'https://happy-animal-123.convex.cloud',
      nonce: 'nonce-value',
      sentryOrigin: 'https://o123.ingest.sentry.io',
    });

    expect(policy).toContain("script-src 'self' 'nonce-nonce-value'");
    expect(policy).toContain(
      "connect-src 'self' https://happy-animal-123.convex.cloud wss://happy-animal-123.convex.cloud https://o123.ingest.sentry.io",
    );
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain('https: wss:');
  });

  it("adds 'unsafe-eval' for Vite dev when allowUnsafeEval is true", () => {
    const policy = buildDocumentContentSecurityPolicy({
      allowUnsafeEval: true,
      nonce: 'nonce-value',
    });

    expect(policy).toContain("script-src 'self' 'nonce-nonce-value' 'unsafe-eval'");
  });

  it('includes report-uri in report-only mode', () => {
    const policy = buildDocumentContentSecurityPolicy({
      mode: 'report-only',
      nonce: 'nonce-value',
    });

    expect(policy).toContain('report-uri /api/csp-report');
    expect(getDocumentCspHeaderName('report-only')).toBe('Content-Security-Policy-Report-Only');
  });

  it('includes report-uri in enforce mode', () => {
    const policy = buildDocumentContentSecurityPolicy({
      mode: 'enforce',
      nonce: 'nonce-value',
    });

    expect(policy).toContain('report-uri /api/csp-report');
  });

  it('defaults invalid CSP_MODE values to enforce', () => {
    process.env.CSP_MODE = 'invalid';

    expect(getDocumentCspMode()).toBe('enforce');
    expect(getDocumentCspHeaderName('enforce')).toBe('Content-Security-Policy');
  });

  it('generates a base64url nonce', () => {
    expect(generateCspNonce()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
