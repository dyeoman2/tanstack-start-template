import { describe, expect, it } from 'vitest';
import { getAuthTokenCacheKey, normalizeAuthProxyResponse } from './convex-better-auth-react-start';

describe('normalizeAuthProxyResponse', () => {
  it('strips proxy-unsafe encoding headers while preserving auth response metadata', async () => {
    const response = normalizeAuthProxyResponse(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-encoding': 'gzip',
          'content-length': '999',
          'content-type': 'application/json',
          'set-cookie': 'session=abc; Path=/; HttpOnly',
          'transfer-encoding': 'chunked',
          vary: 'Origin',
        },
        status: 200,
        statusText: 'OK',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('set-cookie')).toContain('session=abc');
    expect(response.headers.get('vary')).toBe('Origin');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

describe('getAuthTokenCacheKey', () => {
  it('changes when auth cookies change', () => {
    const anonymousRequest = new Request('http://127.0.0.1:3000/_server', {
      headers: {
        cookie: '',
      },
    });
    const authenticatedRequest = new Request('http://127.0.0.1:3000/_server', {
      headers: {
        cookie: 'better-auth.session_token=abc123',
      },
    });

    expect(getAuthTokenCacheKey(anonymousRequest)).not.toBe(
      getAuthTokenCacheKey(authenticatedRequest),
    );
  });
});
