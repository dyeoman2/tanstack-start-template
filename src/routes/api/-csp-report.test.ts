import { beforeEach, describe, expect, it, vi } from 'vitest';

type RoutePostHandler = (input: { request: Request }) => Promise<Response>;

const { logSecurityEventMock } = vi.hoisted(() => ({
  logSecurityEventMock: vi.fn(),
}));

vi.mock('~/lib/server/observability.server', () => ({
  logSecurityEvent: logSecurityEventMock,
}));

describe('/api/csp-report route', () => {
  function requirePostHandler(postHandler: RoutePostHandler | undefined): RoutePostHandler {
    if (!postHandler) {
      throw new Error('Expected POST handler to be defined');
    }

    return postHandler;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs sanitized CSP violation data and returns 204', async () => {
    const { Route } = await import('./csp-report');
    const serverHandlers = Route.options.server?.handlers as
      | Record<string, RoutePostHandler>
      | undefined;
    const postHandler = requirePostHandler(serverHandlers?.POST);

    const response = await postHandler({
      request: new Request('http://127.0.0.1:3000/api/csp-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/csp-report',
        },
        body: JSON.stringify({
          'csp-report': {
            'blocked-uri': 'inline',
            disposition: 'report',
            'document-uri': 'https://app.example.com/app',
            'effective-directive': 'script-src-elem',
            'original-policy': "script-src 'self'",
            referrer: 'https://app.example.com/login',
            'status-code': 200,
            'violated-directive': 'script-src-elem',
          },
        }),
      }),
    });

    expect(response.status).toBe(204);
    expect(logSecurityEventMock).toHaveBeenCalledWith({
      data: {
        blockedURL: 'inline',
        disposition: 'report',
        documentURL: 'https://app.example.com/app',
        effectiveDirective: 'script-src-elem',
        isStyleSrcAttrViolation: false,
        originalPolicy: "script-src 'self'",
        referrer: 'https://app.example.com/login',
        statusCode: 200,
        violatedDirective: 'script-src-elem',
      },
      event: 'csp_violation',
      scope: 'telemetry',
      status: 'warning',
    });
  });

  it('accepts invalid bodies without logging', async () => {
    const { Route } = await import('./csp-report');
    const serverHandlers = Route.options.server?.handlers as
      | Record<string, RoutePostHandler>
      | undefined;
    const postHandler = requirePostHandler(serverHandlers?.POST);

    const response = await postHandler({
      request: new Request('http://127.0.0.1:3000/api/csp-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{invalid',
      }),
    });

    expect(response.status).toBe(204);
    expect(logSecurityEventMock).not.toHaveBeenCalled();
  });
});
