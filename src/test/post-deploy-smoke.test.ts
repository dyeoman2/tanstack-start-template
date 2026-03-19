import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('runPostDeploySmokeChecks', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('retries transient failures until the site becomes healthy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('bad gateway', {
          status: 502,
          headers: {
            'content-type': 'text/plain',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<html></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { runPostDeploySmokeChecks } = await import('../../scripts/post-deploy-smoke.mjs');
    await runPostDeploySmokeChecks({
      baseUrl: 'https://app.example.com',
      timeoutMs: 50,
      pollIntervalMs: 1,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://app.example.com/', {
      method: 'GET',
      headers: {
        Accept: 'text/html',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://app.example.com/api/auth/ok', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'https://app.example.com/api/health', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  });

  it('fails if validation never succeeds before the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'unexpected' }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }),
      ),
    );

    const { runPostDeploySmokeChecks } = await import('../../scripts/post-deploy-smoke.mjs');

    await expect(
      runPostDeploySmokeChecks({
        baseUrl: 'https://app.example.com',
        timeoutMs: 20,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow('GET / did not become ready within 20ms. Last error: / did not return HTML');
  });

  it('includes the last JSON payload when validation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html></html>', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        }),
      )
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ status: 'warming', detail: 'adapter not ready' }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { runPostDeploySmokeChecks } = await import('../../scripts/post-deploy-smoke.mjs');

    await expect(
      runPostDeploySmokeChecks({
        baseUrl: 'https://app.example.com',
        timeoutMs: 20,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(
      'GET /api/auth/ok did not become ready within 20ms. Last error: /api/auth/ok failed validation: expected { status: "ok" } or { ok: true }. Received: {"status":"warming","detail":"adapter not ready"}',
    );
  });
});
