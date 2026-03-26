import {
  buildTrustedConvexAuthRequest,
  getTrustedClientIp,
  getTrustedUserAgent,
} from '../src/lib/shared/better-auth-http';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { createAuth } from './auth';

type BetterAuthHttpSession = {
  session?: {
    id?: string | null;
    userId?: string | null;
  } | null;
  user?: {
    id?: string | null;
  } | null;
} | null;

type FileServeCtx = Pick<ActionCtx, 'runAction' | 'runMutation' | 'runQuery'>;

export async function handleFileServeRequest(
  ctx: FileServeCtx,
  request: Request,
): Promise<Response> {
  const trustedRequest = await buildTrustedConvexAuthRequest(request);
  const url = new URL(trustedRequest.url);
  const ticketId = url.searchParams.get('ticket');
  const expiresAtParam = url.searchParams.get('exp');
  const signature = url.searchParams.get('sig');
  const userAgent = getTrustedUserAgent(trustedRequest) ?? null;
  const requestIpAddress = getTrustedClientIp(trustedRequest) ?? null;

  if (!expiresAtParam || !signature || !ticketId) {
    return new Response('Missing required file serve parameters.', {
      status: 400,
      headers: { 'Referrer-Policy': 'no-referrer' },
    });
  }

  const expiresAt = Number.parseInt(expiresAtParam, 10);
  const auth = createAuth(ctx as ActionCtx);
  const sessionResult = (await auth.api.getSession({
    headers: trustedRequest.headers,
    query: {
      disableCookieCache: true,
    },
  })) as BetterAuthHttpSession;
  const authenticatedSessionId =
    typeof sessionResult?.session?.id === 'string' ? sessionResult.session.id : null;
  const authenticatedUserId =
    typeof sessionResult?.session?.userId === 'string'
      ? sessionResult.session.userId
      : typeof sessionResult?.user?.id === 'string'
        ? sessionResult.user.id
        : null;

  if (!authenticatedSessionId || !authenticatedUserId) {
    await ctx
      .runAction(internal.fileServing.recordFileAccessRedeemFailureInternal, {
        authenticatedSessionId,
        authenticatedUserId,
        errorMessage: 'Authentication required to redeem a file access ticket.',
        expiresAt,
        requestIpAddress,
        requestUserAgent: userAgent,
        ticketId,
      })
      .catch(() => undefined);

    return new Response('Authentication required to redeem a file access ticket.', {
      status: 401,
      headers: { 'Referrer-Policy': 'no-referrer' },
    });
  }

  try {
    const redirect = await ctx.runAction(internal.fileServing.redeemFileAccessTicketInternal, {
      authenticatedSessionId,
      authenticatedUserId,
      expiresAt,
      requestIpAddress,
      requestUserAgent: userAgent,
      signature,
      ticketId,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirect.url,
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    await ctx
      .runAction(internal.fileServing.recordFileAccessRedeemFailureInternal, {
        authenticatedSessionId,
        authenticatedUserId,
        errorMessage:
          error instanceof Error ? error.message : 'Failed to redeem file access ticket.',
        expiresAt,
        requestIpAddress,
        requestUserAgent: userAgent,
        ticketId,
      })
      .catch(() => undefined);

    return new Response(
      error instanceof Error ? error.message : 'Failed to redeem file access ticket.',
      { status: 403, headers: { 'Referrer-Policy': 'no-referrer' } },
    );
  }
}
