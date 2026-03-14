import { internal } from '@convex/_generated/api';
import { buildBetterAuthForwardHeaders } from '~/lib/server/better-auth/http';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';
import {
  type E2EPrincipalType,
  getE2EPrincipalConfig,
  getE2ETestSecret,
  isE2ETestAuthEnabled,
} from '~/lib/server/env.server';

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

type AuthRouteResponse = {
  code?: string;
  message?: string;
};

export type EstablishedE2EAuthSession = {
  authResponse: Response;
  email: string;
  principal: E2EPrincipalType;
  userId: string;
};

async function readAuthError(response: Response): Promise<AuthRouteResponse> {
  try {
    return (await response.json()) as AuthRouteResponse;
  } catch {
    const message = await response.text();
    return { message };
  }
}

export function buildAuthEndpointHeaders(request: Request): Headers {
  const origin = new URL(request.url).origin;
  const headers = buildBetterAuthForwardHeaders(request);

  headers.set('content-type', 'application/json');
  headers.set('origin', request.headers.get('origin') || origin);
  headers.set('referer', request.headers.get('referer') || `${origin}/`);

  return headers;
}

async function postToAuthEndpoint(
  request: Request,
  path: '/api/auth/sign-in/email' | '/api/auth/sign-up/email',
  principal: ReturnType<typeof getE2EPrincipalConfig>,
) {
  const url = new URL(path, request.url);
  const headers = buildAuthEndpointHeaders(request);
  const body =
    path === '/api/auth/sign-up/email'
      ? {
          email: principal.email,
          password: principal.password,
          name: principal.name,
          rememberMe: true,
        }
      : {
          email: principal.email,
          password: principal.password,
          rememberMe: true,
        };

  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function establishE2EAuthSession(
  request: Request,
  principalType: E2EPrincipalType,
): Promise<EstablishedE2EAuthSession> {
  const principal = getE2EPrincipalConfig(principalType);
  const adminClient = createConvexAdminClient();

  let authResponse = await postToAuthEndpoint(request, '/api/auth/sign-in/email', principal);

  if (!authResponse.ok) {
    await adminClient.mutation(internal.e2e.resetPrincipalByEmail, {
      email: principal.email,
    });

    authResponse = await postToAuthEndpoint(request, '/api/auth/sign-up/email', principal);

    if (!authResponse.ok) {
      const authError = await readAuthError(authResponse);
      throw new Response(authError.message || 'Failed to provision e2e principal', {
        status: authResponse.status,
      });
    }
  }

  const roleResult = await adminClient.mutation(internal.e2e.ensurePrincipalRole, {
    email: principal.email,
    role: principal.role,
  });

  if (!roleResult.found) {
    throw new Response('Failed to reconcile e2e principal role', { status: 500 });
  }

  return {
    authResponse,
    email: principal.email,
    principal: principal.role,
    userId: roleResult.userId,
  };
}

export function getSetCookieHeaders(response: Response): string[] {
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie')
      ? [response.headers.get('set-cookie') as string]
      : [];
}

export function appendSetCookieHeaders(headers: Headers, setCookies: string[]) {
  for (const setCookie of setCookies) {
    headers.append('set-cookie', setCookie);
  }
}

export function copySetCookieHeaders(source: Response, target: Headers) {
  appendSetCookieHeaders(target, getSetCookieHeaders(source));
}

export function resolveAgentAuthRedirect(request: Request, redirectTo?: string): string {
  const fallback = '/app';
  const candidate = redirectTo?.trim() || fallback;

  if (!candidate.startsWith('/')) {
    throw new Response('redirectTo must be a same-origin relative path', { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const resolved = new URL(candidate, requestUrl.origin);

  if (resolved.origin !== requestUrl.origin) {
    throw new Response('redirectTo must be a same-origin relative path', { status: 400 });
  }

  return resolved.toString();
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

function parseSetCookieHeader(
  rawCookie: string,
  requestUrl: string,
): PlaywrightCookiePayload | null {
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
  return getSetCookieHeaders(response)
    .map((setCookie) => parseSetCookieHeader(setCookie, requestUrl))
    .filter((cookie): cookie is PlaywrightCookiePayload => cookie !== null);
}
