import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLocalBaseUrl } from './local-base-url';

describe('resolveLocalBaseUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers an explicit base URL override', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(resolveLocalBaseUrl('http://127.0.0.1:3999')).resolves.toBe(
      'http://127.0.0.1:3999',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses port 3000 when it is reachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
      }),
    );

    await expect(resolveLocalBaseUrl()).resolves.toBe('http://127.0.0.1:3000');
  });

  it('falls back to a nearby dev port when 3000 is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
        }),
      );

    await expect(resolveLocalBaseUrl()).resolves.toBe('http://127.0.0.1:3001');
  });
});
