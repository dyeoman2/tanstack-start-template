import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { buildBetterAuthForwardHeaders, getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { getRecentStepUpWindowMs } from '~/lib/server/security-config.server';
import { evaluateFreshSession } from '~/lib/shared/auth-policy';

const INTERNAL_GET_SESSION_PATH = '/api/auth/get-session';

type BetterAuthSessionPayload = {
  session?: {
    createdAt?: Date | number | string | null;
    updatedAt?: Date | number | string | null;
  } | null;
};

export function createGetSessionRequest(request: Request): Request {
  const authUrl = new URL(INTERNAL_GET_SESSION_PATH, request.url);
  authUrl.searchParams.set('disableCookieCache', 'true');
  const headers = buildBetterAuthForwardHeaders(request);

  headers.set('origin', authUrl.origin);
  headers.set('referer', request.url);

  return new Request(authUrl, {
    headers,
    method: 'GET',
  });
}

function isBetterAuthSessionPayload(value: unknown): value is BetterAuthSessionPayload {
  return typeof value === 'object' && value !== null;
}

async function getBetterAuthSessionForFreshness(
  request: Request,
): Promise<BetterAuthSessionPayload['session'] | null> {
  const response = await convexAuthReactStart.handler(createGetSessionRequest(request));
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!isBetterAuthSessionPayload(payload)) {
    return null;
  }

  return payload.session ?? null;
}

export async function hasFreshBetterAuthSession(request: Request): Promise<boolean> {
  const session = await getBetterAuthSessionForFreshness(request);
  if (!session) {
    return false;
  }

  return evaluateFreshSession({
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
  }).satisfied;
}

export async function hasFreshBetterAuthSessionForCurrentRequest(): Promise<boolean> {
  return await hasFreshBetterAuthSession(getBetterAuthRequest());
}
