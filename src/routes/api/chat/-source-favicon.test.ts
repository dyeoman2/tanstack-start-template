import { beforeEach, describe, expect, it, vi } from 'vitest';

type RouteGetHandler = (input: { request: Request }) => Promise<Response>;

const { fetchAuthActionMock } = vi.hoisted(() => ({
  fetchAuthActionMock: vi.fn(),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    agentChat: {
      fetchSourceFavicon: 'fetchSourceFavicon',
    },
  },
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
  },
}));

function requireGetHandler(getHandler: RouteGetHandler | undefined): RouteGetHandler {
  if (!getHandler) {
    throw new Error('Expected GET handler to be defined');
  }

  return getHandler;
}

describe('source favicon api route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when hostname is missing', async () => {
    const { Route } = await import('./source-favicon');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/chat/source-favicon'),
    });

    expect(response.status).toBe(404);
  });

  it('returns proxied favicon bytes when the authenticated action succeeds', async () => {
    fetchAuthActionMock.mockResolvedValue({
      ok: true,
      bodyBase64: Buffer.from([1, 2, 3]).toString('base64'),
      cacheControl: 'private, max-age=60',
      contentType: 'image/png',
    });

    const { Route } = await import('./source-favicon');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/chat/source-favicon?hostname=example.com'),
    });

    expect(fetchAuthActionMock).toHaveBeenCalledWith('fetchSourceFavicon', {
      hostname: 'example.com',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
  });

  it('returns 404 when the authenticated action declines the favicon request', async () => {
    fetchAuthActionMock.mockResolvedValue({
      ok: false,
    });

    const { Route } = await import('./source-favicon');
    const serverHandlers = Route.options.server?.handlers as Record<string, RouteGetHandler>;
    const getHandler = requireGetHandler(serverHandlers.GET);

    const response = await getHandler({
      request: new Request('http://127.0.0.1:3000/api/chat/source-favicon?hostname=example.com'),
    });

    expect(response.status).toBe(404);
  });
});
