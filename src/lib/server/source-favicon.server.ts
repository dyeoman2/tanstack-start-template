export const SOURCE_FAVICON_CACHE_CONTROL = 'private, max-age=86400, stale-while-revalidate=86400';
export const SOURCE_FAVICON_MAX_BYTES = 32 * 1024;
export const SOURCE_FAVICON_TIMEOUT_MS = 3_000;

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Base64 without Node `Buffer` so this module stays safe for Convex bundling. */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export type SourceFaviconFetchResult =
  | {
      bodyBase64: string;
      cacheControl: string;
      contentType: string;
      ok: true;
    }
  | {
      ok: false;
      reason:
        | 'empty'
        | 'invalid_content_type'
        | 'network_error'
        | 'timeout'
        | 'too_large'
        | 'upstream_status';
      upstreamStatus?: number;
    };

async function readResponseBodyWithLimit(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error('too_large');
    }
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error('too_large');
    }
    chunks.push(value);
  }

  return concatUint8Arrays(chunks);
}

export async function fetchSourceFaviconAsset(args: {
  fetchImpl?: typeof fetch;
  hostname: string;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<SourceFaviconFetchResult> {
  const controller = new AbortController();
  const fetchImpl = args.fetchImpl ?? fetch;
  const maxBytes = args.maxBytes ?? SOURCE_FAVICON_MAX_BYTES;
  const timeoutMs = args.timeoutMs ?? SOURCE_FAVICON_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(args.hostname)}&sz=64`,
      {
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        reason: 'upstream_status',
        upstreamStatus: response.status,
      };
    }

    const contentType = response.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/')) {
      return {
        ok: false,
        reason: 'invalid_content_type',
      };
    }

    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return {
        ok: false,
        reason: 'too_large',
      };
    }

    const buffer = await readResponseBodyWithLimit(response, maxBytes).catch((error) => {
      if (error instanceof Error && error.message === 'too_large') {
        return null;
      }
      throw error;
    });
    if (!buffer) {
      return {
        ok: false,
        reason: 'too_large',
      };
    }
    if (buffer.length === 0) {
      return {
        ok: false,
        reason: 'empty',
      };
    }

    return {
      ok: true,
      bodyBase64: uint8ArrayToBase64(buffer),
      cacheControl: SOURCE_FAVICON_CACHE_CONTROL,
      contentType,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        ok: false,
        reason: 'timeout',
      };
    }

    return {
      ok: false,
      reason: 'network_error',
    };
  } finally {
    clearTimeout(timeout);
  }
}
