import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSourceFaviconAsset, SOURCE_FAVICON_MAX_BYTES } from './source-favicon.server';

describe('source-favicon.server', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a base64-encoded favicon when the upstream response is valid', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const fetchImpl = vi.fn(async () => {
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'image/png',
        },
      });
    });

    await expect(
      fetchSourceFaviconAsset({
        hostname: 'example.com',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      bodyBase64: btoa(String.fromCharCode(...bytes)),
      cacheControl: 'private, max-age=86400, stale-while-revalidate=86400',
      contentType: 'image/png',
      ok: true,
    });
  });

  it('rejects favicon responses that advertise a body larger than the limit', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: {
          'content-length': String(SOURCE_FAVICON_MAX_BYTES + 1),
          'content-type': 'image/png',
        },
      });
    });

    await expect(
      fetchSourceFaviconAsset({
        hostname: 'example.com',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('times out hanging upstream favicon fetches', async () => {
    vi.useFakeTimers();

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const pending = fetchSourceFaviconAsset({
      hostname: 'example.com',
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'timeout',
    });
  });
});
