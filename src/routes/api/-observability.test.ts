import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RouteGetHandler = (input: { request: Request }) => Promise<Response>;

const ORIGINAL_ENV = { ...process.env };

function requireGetHandler(getHandler: RouteGetHandler | undefined): RouteGetHandler {
  if (!getHandler) {
    throw new Error('Expected GET handler to be defined');
  }

  return getHandler;
}

describe('observability routes', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('hides /api/metrics without internal authorization', async () => {
    const { Route } = await import('./metrics');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/metrics'),
    });

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not Found');
  });

  it('returns metrics when internal authorization succeeds', async () => {
    process.env.INTERNAL_OBSERVABILITY_SHARED_SECRET = 'observability-secret';
    const { Route } = await import('./metrics');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/metrics', {
        headers: {
          authorization: 'Bearer observability-secret',
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        service: 'tanstack-start-template',
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
      }),
    );
  });

  it('hides /api/readiness without internal authorization', async () => {
    process.env.INTERNAL_OBSERVABILITY_SHARED_SECRET = 'observability-secret';
    const { Route } = await import('./readiness');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/readiness'),
    });

    expect(response.status).toBe(404);
  });

  it('surfaces readiness warnings for missing internal DNS resolver configuration', async () => {
    process.env.INTERNAL_OBSERVABILITY_SHARED_SECRET = 'observability-secret';
    delete process.env.DOMAIN_DNS_RESOLVER_URL;
    const { Route } = await import('./readiness');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/readiness', {
        headers: {
          authorization: 'Bearer observability-secret',
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ready: false,
        warnings: [
          expect.objectContaining({
            code: 'domain_dns_resolver_missing',
            surface: 'organization_domains',
          }),
        ],
      }),
    );
  });

  it('reports readiness as healthy when the internal DNS resolver is configured', async () => {
    process.env.INTERNAL_OBSERVABILITY_SHARED_SECRET = 'observability-secret';
    process.env.DOMAIN_DNS_RESOLVER_URL = 'https://dns.internal.example/resolve';
    const { Route } = await import('./readiness');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/readiness', {
        headers: {
          authorization: 'Bearer observability-secret',
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ready: true,
        warnings: [],
      }),
    );
  });

  it('sanitizes public health responses to status only', async () => {
    process.env.VITE_CONVEX_URL = 'https://demo.convex.site';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'healthy',
          timestamp: '2026-03-25T00:00:00.000Z',
          service: { version: '1.0.0' },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const { Route } = await import('./health');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/health'),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'healthy' });
  });

  it('does not leak upstream health details on failure', async () => {
    process.env.VITE_CONVEX_URL = 'https://demo.convex.site';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'unhealthy',
          error: 'database timeout',
          responseTime: '2500ms',
        }),
        {
          status: 503,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const { Route } = await import('./health');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/health'),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'unhealthy' });
  });
});
