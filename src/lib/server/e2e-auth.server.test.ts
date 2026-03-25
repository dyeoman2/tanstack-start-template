import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendSetCookieHeaders,
  assertE2EAuthRequestAuthorized,
  buildAuthEndpointHeaders,
  establishE2EAuthSession,
  getSetCookieHeaders,
  resolveAgentAuthRedirect,
} from '~/lib/server/e2e-auth.server';

const ORIGINAL_ENV = { ...process.env };

describe('e2e-auth.server', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.APP_DEPLOYMENT_ENV = 'development';
    process.env.ENABLE_E2E_TEST_AUTH = 'true';
    process.env.E2E_TEST_SECRET = 'test-secret';
    process.env.E2E_USER_EMAIL = 'e2e-user@local.test';
    process.env.E2E_USER_PASSWORD = 'E2EUser!1234';
    process.env.E2E_ADMIN_EMAIL = 'e2e-admin@local.test';
    process.env.E2E_ADMIN_PASSWORD = 'E2EAdmin!1234';
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

  it('does not depend on a loopback request hostname', () => {
    const request = new Request('https://app.example.com/api/test/agent-auth', {
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

  it('rejects requests outside explicit development or test deployments', () => {
    process.env.APP_DEPLOYMENT_ENV = 'preview';
    const request = new Request('http://127.0.0.1:3000/api/test/agent-auth', {
      headers: {
        'x-e2e-test-secret': 'test-secret',
      },
    });

    expect(() => assertE2EAuthRequestAuthorized(request)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('rejects requests when APP_DEPLOYMENT_ENV is missing', () => {
    delete process.env.APP_DEPLOYMENT_ENV;
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

  it('establishes an existing e2e principal session via sign-in only', async () => {
    const authResponse = new Response(
      JSON.stringify({
        ok: true,
      }),
      {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=abc; Path=/; HttpOnly',
        },
        status: 200,
      },
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(authResponse);
    const request = new Request('http://127.0.0.1:3000/api/test/e2e-auth');

    const session = await establishE2EAuthSession(request, 'user');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url?.toString()).toBe('http://127.0.0.1:3000/api/auth/sign-in/email');
    expect(init?.method).toBe('POST');
    expect(session.authResponse).toBe(authResponse);
    expect(session.email).toBe('e2e-user@local.test');
    expect(session.principal).toBe('user');
    expect(session.userId).toBeNull();
  });

  it('returns a provisioning hint when the configured principal cannot sign in', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Invalid email or password',
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 401,
        },
      ),
    );
    const request = new Request('http://127.0.0.1:3000/api/test/e2e-auth');

    let thrown: Response | null = null;
    try {
      await establishE2EAuthSession(request, 'user');
    } catch (error) {
      thrown = error instanceof Response ? error : null;
    }

    expect(thrown).not.toBeNull();
    if (!thrown) {
      throw new Error('Expected establishE2EAuthSession to throw a Response');
    }

    expect(thrown.status).toBe(401);
    await expect(thrown.text()).resolves.toBe(
      'Invalid email or password. Run `pnpm run e2e:provision` and retry.',
    );
  });
});
