import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server';
import { ConvexHttpClient } from 'convex/browser';
import { deriveConvexSiteUrl } from '~/lib/convex-url';
import { buildBetterAuthProxyHeaders, getBetterAuthRequest } from '~/lib/server/better-auth/http';

type ConvexFunctionType = 'action' | 'mutation' | 'query';

function getRequiredClientEnv(name: 'VITE_CONVEX_URL'): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function hasBody(method: string) {
  const normalizedMethod = method.toUpperCase();
  return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
}

const PROXY_RESPONSE_HEADER_NAMES_TO_STRIP = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
] as const;

function setupClient(token?: string) {
  const client = new ConvexHttpClient(getRequiredClientEnv('VITE_CONVEX_URL'));
  if (token) {
    client.setAuth(token);
  }
  // @ts-expect-error internal Convex client hook
  client.setFetchOptions({ cache: 'no-store' });
  return client;
}

async function readTokenResponse(response: Response) {
  if (response.status === 401) {
    return undefined;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Better Auth token request failed.');
  }

  const payload = (await response.json()) as { token?: string | null };
  return typeof payload.token === 'string' && payload.token.length > 0 ? payload.token : undefined;
}

export function normalizeAuthProxyResponse(response: Response) {
  const headers = new Headers(response.headers);

  for (const headerName of PROXY_RESPONSE_HEADER_NAMES_TO_STRIP) {
    headers.delete(headerName);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function getAuthTokenCacheKey(request: Request) {
  return JSON.stringify({
    authorization: request.headers.get('authorization') ?? '',
    betterAuthCookie: request.headers.get('better-auth-cookie') ?? '',
    cookie: request.headers.get('cookie') ?? '',
  });
}

async function getAuthToken(convexSiteUrl: string, request: Request) {
  const headers = await buildBetterAuthProxyHeaders(request, {
    targetPath: '/api/auth/convex/token',
  });
  headers.set('accept-encoding', 'identity');
  const response = await fetch(new URL('/api/auth/convex/token', convexSiteUrl), {
    headers,
    method: 'GET',
    redirect: 'manual',
  });

  return await readTokenResponse(response);
}

async function callWithToken<
  FnType extends ConvexFunctionType,
  Fn extends FunctionReference<FnType>,
>(kind: FnType, fn: Fn, args: OptionalRestArgs<Fn>): Promise<FunctionReturnType<Fn>> {
  const request = getBetterAuthRequest();
  const token = await getAuthToken(
    deriveConvexSiteUrl(getRequiredClientEnv('VITE_CONVEX_URL')),
    request,
  );
  const client = setupClient(token);

  if (kind === 'query') {
    return await client.query(fn as FunctionReference<'query'>, ...(args as OptionalRestArgs<Fn>));
  }

  if (kind === 'mutation') {
    return await client.mutation(
      fn as FunctionReference<'mutation'>,
      ...(args as OptionalRestArgs<Fn>),
    );
  }

  return await client.action(fn as FunctionReference<'action'>, ...(args as OptionalRestArgs<Fn>));
}

async function proxyAuthRequest(request: Request) {
  const target = new URL(request.url);
  const convexSiteUrl = deriveConvexSiteUrl(getRequiredClientEnv('VITE_CONVEX_URL'));
  const headers = await buildBetterAuthProxyHeaders(request);
  headers.set('accept-encoding', 'identity');

  const response = await fetch(new URL(`${target.pathname}${target.search}`, convexSiteUrl), {
    body: hasBody(request.method) ? request.body : undefined,
    // @ts-expect-error duplex is required when streaming a request body through fetch
    duplex: hasBody(request.method) ? 'half' : undefined,
    headers,
    method: request.method,
    redirect: 'manual',
  });

  return normalizeAuthProxyResponse(response);
}

export const convexAuthReactStart = {
  fetchAuthAction<Action extends FunctionReference<'action'>>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>> {
    return callWithToken('action', action, args);
  },
  fetchAuthMutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    return callWithToken('mutation', mutation, args);
  },
  fetchAuthQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>> {
    return callWithToken('query', query, args);
  },
  handler(request: Request) {
    return proxyAuthRequest(request);
  },
} as const;
