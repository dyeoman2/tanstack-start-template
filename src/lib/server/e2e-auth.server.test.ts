import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendSetCookieHeaders,
  assertE2EAuthRequestAuthorized,
  buildAuthEndpointHeaders,
  getSetCookieHeaders,
  resolveAgentAuthRedirect,
} from '~/lib/server/e2e-auth.server';

const ORIGINAL_ENV = { ...process.env };

describe('e2e-auth.server', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.ENABLE_E2E_TEST_AUTH = 'true';
    process.env.E2E_TEST_SECRET = 'test-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('authorizes requests with the configured secret', () => {
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth', {
      headers: {
        'x-e2e-test-secret': 'test-secret',
      },
    });

    expect(() => assertE2EAuthRequestAuthorized(request)).not.toThrow();
  });

  it('rejects requests when auth is disabled', () => {
    process.env.ENABLE_E2E_TEST_AUTH = 'false';
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth', {
      headers: {
        'x-e2e-test-secret': 'test-secret',
      },
    });

    expect(() => assertE2EAuthRequestAuthorized(request)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('rejects requests with a missing or invalid secret', () => {
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth');

    expect(() => assertE2EAuthRequestAuthorized(request)).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('defaults agent auth redirects to /app', () => {
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth');

    expect(resolveAgentAuthRedirect(request)).toBe('http://127.0.0.1:3000/app');
  });

  it('allows same-origin relative redirect targets', () => {
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth');

    expect(resolveAgentAuthRedirect(request, '/app/admin?tab=users')).toBe(
      'http://127.0.0.1:3000/app/admin?tab=users',
    );
  });

  it('rejects external redirect targets', () => {
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth');

    expect(() => resolveAgentAuthRedirect(request, 'https://example.com')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => resolveAgentAuthRedirect(request, '//example.com')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('preserves multiple set-cookie headers when forwarding them', () => {
    const headers = new Headers();
    appendSetCookieHeaders(headers, [
      'session=abc; Path=/; HttpOnly',
      'csrf=def; Path=/; SameSite=Lax',
    ]);

    expect(getSetCookieHeaders(new Response(null, { headers }))).toEqual([
      'session=abc; Path=/; HttpOnly',
      'csrf=def; Path=/; SameSite=Lax',
    ]);
  });

  it('normalizes forwarded auth headers without duplicating origin metadata', () => {
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth', {
      headers: {
        cookie: 'session=abc',
        origin: 'http://127.0.0.1:3000',
        referer: 'http://127.0.0.1:3000/app',
      },
    });

    const headers = buildAuthEndpointHeaders(request);

    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('origin')).toBe('http://127.0.0.1:3000');
    expect(headers.get('referer')).toBe('http://127.0.0.1:3000/app');
    expect([...headers.entries()].filter(([name]) => name === 'origin')).toHaveLength(1);
    expect([...headers.entries()].filter(([name]) => name === 'referer')).toHaveLength(1);
  });
});
