import { getE2ETestSecret, isE2ETestAuthEnabled } from '~/lib/server/env.server';

const E2E_AUTH_SECRET_HEADER = 'x-e2e-test-secret';

export type PlaywrightCookiePayload = {
  expires?: number;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: 'Lax' | 'None' | 'Strict';
  secure?: boolean;
  url: string;
  value: string;
};

export function assertE2EAuthRequestAuthorized(request: Request) {
  if (!isE2ETestAuthEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const providedSecret = request.headers.get(E2E_AUTH_SECRET_HEADER);
  if (!providedSecret || providedSecret !== getE2ETestSecret()) {
    throw new Response('Unauthorized', { status: 401 });
  }
}

function parseExpires(value: string): number | undefined {
  const expiresAt = Date.parse(value);
  if (Number.isNaN(expiresAt)) {
    return undefined;
  }

  return Math.floor(expiresAt / 1000);
}

function normalizeSameSite(value: string): PlaywrightCookiePayload['sameSite'] | undefined {
  const normalized = value.toLowerCase();

  if (normalized === 'lax') {
    return 'Lax';
  }

  if (normalized === 'strict') {
    return 'Strict';
  }

  if (normalized === 'none') {
    return 'None';
  }

  return undefined;
}

function parseSetCookieHeader(rawCookie: string, requestUrl: string): PlaywrightCookiePayload | null {
  const segments = rawCookie
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const [nameValue, ...attributes] = segments;
  if (!nameValue) {
    return null;
  }

  const separatorIndex = nameValue.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }

  const cookie: PlaywrightCookiePayload = {
    name: nameValue.slice(0, separatorIndex),
    value: nameValue.slice(separatorIndex + 1),
    url: requestUrl,
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValueParts] = attribute.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValueParts.join('=').trim();

    if (!key) {
      continue;
    }

    if (key === 'httponly') {
      cookie.httpOnly = true;
      continue;
    }

    if (key === 'secure') {
      cookie.secure = true;
      continue;
    }

    if (key === 'path' && value) {
      cookie.path = value;
      continue;
    }

    if (key === 'expires' && value) {
      cookie.expires = parseExpires(value);
      continue;
    }

    if (key === 'max-age' && value) {
      const seconds = Number.parseInt(value, 10);
      if (!Number.isNaN(seconds)) {
        cookie.expires = Math.floor(Date.now() / 1000) + seconds;
      }
      continue;
    }

    if (key === 'samesite' && value) {
      cookie.sameSite = normalizeSameSite(value);
    }
  }

  return cookie;
}

export function getPlaywrightCookiesFromResponse(
  response: Response,
  requestUrl: string,
): PlaywrightCookiePayload[] {
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie') as string]
        : [];

  return setCookies
    .map((setCookie) => parseSetCookieHeader(setCookie, requestUrl))
    .filter((cookie): cookie is PlaywrightCookiePayload => cookie !== null);
}
