import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PROXY_IP_HEADER } from '~/lib/server/better-auth/http';

type RouteGetHandler = (input: { request: Request }) => Promise<Response>;

const ORIGINAL_ENV = { ...process.env };

function requireGetHandler(getHandler: RouteGetHandler | undefined): RouteGetHandler {
  if (!getHandler) {
    throw new Error('Expected GET handler to be defined');
  }

  return getHandler;
}

describe('/api/files/serve route', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_DEPLOYMENT_ENV: 'development',
      AUTH_PROXY_SHARED_SECRET: 'test-auth-proxy-shared-secret-abcdefghijklmnopqrstuvwxyz',
      VITE_CONVEX_URL: 'https://demo.convex.cloud',
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete (globalThis as typeof globalThis & { Netlify?: unknown }).Netlify;
  });

  it('proxies file redemption through Convex with signed canonical client IP headers', async () => {
    (globalThis as typeof globalThis & { Netlify?: { context: { ip: string } } }).Netlify = {
      context: {
        ip: '198.51.100.7',
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        headers: {
          location: 'https://download.example.test/file',
        },
        status: 302,
      }),
    );

    const { Route } = await import('./serve');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request(
        'http://127.0.0.1:3000/api/files/serve?ticket=ticket_123&exp=1710000000000&sig=test-signature',
        {
          headers: {
            cookie: 'session=abc',
            'user-agent': 'Vitest Browser',
            'x-forwarded-for': '203.0.113.9',
            'x-request-id': 'req-123',
          },
        },
      ),
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      new URL(
        '/api/files/serve?ticket=ticket_123&exp=1710000000000&sig=test-signature',
        'https://demo.convex.site',
      ),
      expect.objectContaining({
        headers: expect.any(Headers),
        method: 'GET',
        redirect: 'manual',
      }),
    );

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const init = fetchCall?.[1];
    expect(init?.headers).toBeInstanceOf(Headers);
    const headers = init?.headers as Headers;
    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-request-id')).toBe('req-123');
    expect(headers.get(AUTH_PROXY_IP_HEADER)).toBe('198.51.100.7');
    expect(headers.get('x-forwarded-for')).toBeNull();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://download.example.test/file');
  });

  it('returns 503 when the Convex HTTP origin is unavailable', async () => {
    delete process.env.VITE_CONVEX_URL;

    const { Route } = await import('./serve');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/files/serve?ticket=t&exp=1&sig=s'),
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe('File redemption is unavailable.');
  });
});
