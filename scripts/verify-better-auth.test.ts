import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('verifyAuthOk', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('checks GET /api/auth/ok against the configured Better Auth verification url', async () => {
    process.env.BETTER_AUTH_VERIFY_URL = 'https://app.example.com';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { verifyAuthOk } = await import('./verify-better-auth.mjs');
    await verifyAuthOk();

    expect(fetchMock).toHaveBeenCalledWith('https://app.example.com/api/auth/ok', {
      method: 'GET',
      signal: expect.any(AbortSignal),
    });
  });

  it('fails when /api/auth/ok does not return the expected payload', async () => {
    process.env.BETTER_AUTH_VERIFY_URL = 'https://app.example.com';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ status: 'unexpected' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      ),
    );

    const { verifyAuthOk } = await import('./verify-better-auth.mjs');

    await expect(verifyAuthOk()).rejects.toThrow(
      'GET /api/auth/ok did not return { status: "ok" }',
    );
  });
});
