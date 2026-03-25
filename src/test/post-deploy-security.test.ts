import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const REQUIRED_HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy':
    'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
};

function buildHtmlResponse(cacheControl: string) {
  return new Response('<html></html>', {
    status: 200,
    headers: {
      ...REQUIRED_HTML_HEADERS,
      'cache-control': cacheControl,
    },
  });
}

describe('runPostDeploySecurityChecks', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('passes when live headers match on all privacy-sensitive surfaces', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'))
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'))
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'));

    vi.stubGlobal('fetch', fetchMock);

    const { runPostDeploySecurityChecks } = await import('../../scripts/post-deploy-security.mjs');
    await runPostDeploySecurityChecks({
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
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://app.example.com/register', {
      method: 'GET',
      headers: {
        Accept: 'text/html',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://app.example.com/app', {
      method: 'GET',
      headers: {
        Accept: 'text/html',
      },
    });
  });

  it('retries transient header drift until the live response matches policy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html></html>', {
          status: 200,
          headers: {
            ...REQUIRED_HTML_HEADERS,
            'cache-control': 'public, max-age=3600',
          },
        }),
      )
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'))
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'))
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'));

    vi.stubGlobal('fetch', fetchMock);

    const { runPostDeploySecurityChecks } = await import('../../scripts/post-deploy-security.mjs');
    await runPostDeploySecurityChecks({
      baseUrl: 'https://app.example.com',
      timeoutMs: 50,
      pollIntervalMs: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('fails when a required hardening header is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html></html>', {
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store, max-age=0',
            },
          }),
      ),
    );

    const { runPostDeploySecurityChecks } = await import('../../scripts/post-deploy-security.mjs');

    await expect(
      runPostDeploySecurityChecks({
        baseUrl: 'https://app.example.com',
        timeoutMs: 20,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(
      'GET / security headers did not become ready within 20ms. Last error: / header Cross-Origin-Opener-Policy mismatch. Expected "same-origin", received "<missing>"',
    );
  });

  it('fails when cache-control is wrong for a privacy-sensitive route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildHtmlResponse('no-store, max-age=0'))
      .mockImplementation(async () => buildHtmlResponse('public, max-age=600'));

    vi.stubGlobal('fetch', fetchMock);

    const { runPostDeploySecurityChecks } = await import('../../scripts/post-deploy-security.mjs');

    await expect(
      runPostDeploySecurityChecks({
        baseUrl: 'https://app.example.com',
        timeoutMs: 20,
        pollIntervalMs: 1,
      }),
    ).rejects.toThrow(
      'GET /register security headers did not become ready within 20ms. Last error: /register header Cache-Control mismatch. Expected "no-store, max-age=0", received "public, max-age=600"',
    );
  });
});
