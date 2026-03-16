import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { buildBetterAuthForwardHeaders, getBetterAuthRequest } from '~/lib/server/better-auth/http';

export function createFreshSessionRequest(request: Request): Request {
  const authUrl = new URL('/api/auth/session/assert-fresh', request.url);
  const headers = buildBetterAuthForwardHeaders(request);

  headers.set('origin', authUrl.origin);
  headers.set('referer', request.url);

  return new Request(authUrl, {
    headers,
    method: 'GET',
  });
}

export async function hasFreshBetterAuthSession(request: Request): Promise<boolean> {
  const response = await convexAuthReactStart.handler(createFreshSessionRequest(request));
  return response.ok;
}

export async function hasFreshBetterAuthSessionForCurrentRequest(): Promise<boolean> {
  return await hasFreshBetterAuthSession(getBetterAuthRequest());
}
