import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { buildBetterAuthForwardHeaders, getBetterAuthRequest } from '~/lib/server/better-auth/http';

const INTERNAL_FRESH_SESSION_PATH = '/api/auth/session/assert-fresh';

export function createFreshSessionRequest(request: Request): Request {
  const authUrl = new URL(INTERNAL_FRESH_SESSION_PATH, request.url);
  const headers = buildBetterAuthForwardHeaders(request);

  headers.set('origin', authUrl.origin);
  headers.set('referer', request.url);

  return new Request(authUrl, {
    headers,
    method: 'GET',
  });
}

export async function hasFreshBetterAuthSession(request: Request): Promise<boolean> {
  // Better Auth exposes freshness checks at the auth-endpoint layer. This bridge
  // keeps TanStack/Convex server code on a Better Auth-backed decision without
  // duplicating session freshness logic outside the auth boundary.
  const response = await convexAuthReactStart.handler(createFreshSessionRequest(request));
  return response.ok;
}

export async function hasFreshBetterAuthSessionForCurrentRequest(): Promise<boolean> {
  return await hasFreshBetterAuthSession(getBetterAuthRequest());
}
