import { getAuthProxySharedSecret } from '../server/env.server';

export const AUTH_PROXY_IP_HEADER = 'x-app-client-ip';
export const AUTH_PROXY_IP_SIGNATURE_HEADER = 'x-app-client-ip-sig';
export const AUTH_PROXY_IP_TIMESTAMP_HEADER = 'x-app-client-ip-ts';

const AUTH_PROXY_MAX_SKEW_MS = 60_000;
const AUTH_PROXY_HEADER_NAMES = [
  'accept',
  'accept-language',
  'authorization',
  'better-auth-cookie',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-request-id',
] as const;
const FORWARDED_IP_HEADER_NAMES = [
  AUTH_PROXY_IP_HEADER,
  AUTH_PROXY_IP_SIGNATURE_HEADER,
  AUTH_PROXY_IP_TIMESTAMP_HEADER,
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
] as const;

type HeaderSource = Headers | Request | { headers?: Headers; request?: Request };

type NetlifyRuntime = {
  context?: {
    ip?: string | null;
  } | null;
};

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveHeaders(source: HeaderSource): Headers | null {
  if (source instanceof Headers) {
    return source;
  }

  if (source instanceof Request) {
    return source.headers;
  }

  return source.request?.headers ?? source.headers ?? null;
}

function resolveNetlifyClientIp() {
  const runtime = (globalThis as typeof globalThis & { Netlify?: NetlifyRuntime }).Netlify;
  return normalizeOptionalString(runtime?.context?.ip ?? null);
}

function getRequestTarget(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function hasBody(method: string) {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
}

function copyAllowedAuthHeaders(source: Headers) {
  const headers = new Headers();

  for (const headerName of AUTH_PROXY_HEADER_NAMES) {
    const value = source.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

// Both inputs are HMAC-SHA256 hex strings (always 64 chars), so the early
// return on length mismatch does not leak exploitable timing information.
function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) {
      return false;
    }
    mismatch |= leftByte ^ rightByte;
  }

  return mismatch === 0;
}

async function signAuthProxyPayload(payload: string) {
  const secret = getAuthProxySharedSecret();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function createSignedIpHeaders(request: Request, ipAddress: string, targetPath?: string) {
  const timestamp = Date.now().toString();
  const payload = `${timestamp}.${request.method.toUpperCase()}.${targetPath ?? getRequestTarget(request)}.${ipAddress}`;
  const signature = await signAuthProxyPayload(payload);

  return {
    ipAddress,
    signature,
    timestamp,
  };
}

async function resolveVerifiedProxyIp(request: Request) {
  const ipAddress = normalizeOptionalString(request.headers.get(AUTH_PROXY_IP_HEADER));
  const timestamp = normalizeOptionalString(request.headers.get(AUTH_PROXY_IP_TIMESTAMP_HEADER));
  const signature = normalizeOptionalString(request.headers.get(AUTH_PROXY_IP_SIGNATURE_HEADER));

  if (!ipAddress || !timestamp || !signature) {
    return null;
  }

  const timestampMs = Number.parseInt(timestamp, 10);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > AUTH_PROXY_MAX_SKEW_MS
  ) {
    return null;
  }

  const payload = `${timestamp}.${request.method.toUpperCase()}.${getRequestTarget(request)}.${ipAddress}`;
  const expectedSignature = await signAuthProxyPayload(payload);

  return timingSafeEqual(expectedSignature, signature) ? ipAddress : null;
}

function createRequestWithHeaders(request: Request, headers: Headers) {
  return new Request(request.url, {
    body: hasBody(request.method) ? request.body : undefined,
    // @ts-expect-error duplex is required when piping a streaming body through fetch-compatible Request
    duplex: hasBody(request.method) ? 'half' : undefined,
    headers,
    method: request.method,
  });
}

export async function buildBetterAuthProxyHeaders(
  request: Request,
  options?: {
    targetPath?: string;
  },
): Promise<Headers> {
  const headers = copyAllowedAuthHeaders(request.headers);
  const clientIp = resolveNetlifyClientIp();

  if (!clientIp) {
    return headers;
  }

  const signedHeaders = await createSignedIpHeaders(request, clientIp, options?.targetPath);
  headers.set(AUTH_PROXY_IP_HEADER, signedHeaders.ipAddress);
  headers.set(AUTH_PROXY_IP_TIMESTAMP_HEADER, signedHeaders.timestamp);
  headers.set(AUTH_PROXY_IP_SIGNATURE_HEADER, signedHeaders.signature);

  return headers;
}

export async function buildTrustedConvexAuthRequest(request: Request): Promise<Request> {
  const headers = copyAllowedAuthHeaders(request.headers);
  const verifiedProxyIp = await resolveVerifiedProxyIp(request);

  if (verifiedProxyIp) {
    headers.set(AUTH_PROXY_IP_HEADER, verifiedProxyIp);
  }

  for (const headerName of FORWARDED_IP_HEADER_NAMES) {
    if (headerName !== AUTH_PROXY_IP_HEADER || !verifiedProxyIp) {
      headers.delete(headerName);
    }
  }

  return createRequestWithHeaders(request, headers);
}

export function getTrustedClientIp(source: HeaderSource) {
  const headers = resolveHeaders(source);
  return normalizeOptionalString(headers?.get(AUTH_PROXY_IP_HEADER) ?? null) ?? undefined;
}

export function getTrustedUserAgent(source: HeaderSource) {
  const headers = resolveHeaders(source);
  return normalizeOptionalString(headers?.get('user-agent') ?? null) ?? undefined;
}
