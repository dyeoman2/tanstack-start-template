import { beforeEach, describe, expect, it, vi } from 'vitest';

const authHandlerMock = vi.fn();
const getRequestMock = vi.fn();

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    handler: (...args: unknown[]) => authHandlerMock(...args),
  },
}));

vi.mock('~/lib/server/better-auth/http', async () => {
  const actual = await vi.importActual<typeof import('~/lib/server/better-auth/http')>(
    '~/lib/server/better-auth/http',
  );

  return {
    ...actual,
    getBetterAuthRequest: () => getRequestMock(),
  };
});

import {
  createFreshSessionRequest,
  hasFreshBetterAuthSession,
  hasFreshBetterAuthSessionForCurrentRequest,
} from '~/lib/server/better-auth/fresh-session.server';

describe('fresh-session.server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestMock.mockReturnValue(
      new Request('http://127.0.0.1:3000/app', {
        headers: {
          cookie: 'session=abc',
        },
      }),
    );
  });

  it('builds a Better Auth freshness request with forwarded auth headers', () => {
    const request = new Request('http://127.0.0.1:3000/app/profile', {
      headers: {
        cookie: 'session=abc',
        'user-agent': 'Vitest',
        'x-forwarded-for': '203.0.113.9',
      },
    });

    const freshnessRequest = createFreshSessionRequest(request);

    expect(freshnessRequest.url).toBe('http://127.0.0.1:3000/api/auth/session/assert-fresh');
    expect(freshnessRequest.method).toBe('GET');
    expect(freshnessRequest.headers.get('cookie')).toBe('session=abc');
    expect(freshnessRequest.headers.get('referer')).toBe('http://127.0.0.1:3000/app/profile');
    expect(freshnessRequest.headers.get('origin')).toBe('http://127.0.0.1:3000');
  });

  it('returns whether the Better Auth freshness check succeeded', async () => {
    authHandlerMock.mockResolvedValue(new Response('{}', { status: 200 }));

    const result = await hasFreshBetterAuthSession(
      new Request('http://127.0.0.1:3000/app', {
        headers: {
          cookie: 'session=abc',
        },
      }),
    );

    expect(result).toBe(true);
    expect(authHandlerMock).toHaveBeenCalledTimes(1);
  });

  it('can evaluate freshness for the current server request', async () => {
    authHandlerMock.mockResolvedValue(new Response('{}', { status: 200 }));

    const result = await hasFreshBetterAuthSessionForCurrentRequest();

    expect(result).toBe(true);
    expect(authHandlerMock).toHaveBeenCalledTimes(1);
  });
});
