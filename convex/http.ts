import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { resend } from './emails';
import { recordFileAccessRedeemFailure, redeemFileAccessTicketOrThrow } from './fileServing';
import { healthCheck } from './health';
import {
  applyStorageInspectionRequest,
  parseStorageInspectionWebhookPayload,
} from './storageDecision';
import {
  applyGuardDutyPromotionResult,
  applyGuardDutyFinding,
  parseGuardDutyWebhookPayload,
  verifyWebhookSignature,
} from './storageWebhook';

const http = httpRouter();

type BetterAuthHttpSession = {
  session?: {
    id?: string | null;
    userId?: string | null;
  } | null;
  user?: {
    id?: string | null;
  } | null;
} | null;

authComponent.registerRoutes(
  http,
  createAuth as Parameters<typeof authComponent.registerRoutes>[1],
);

// Health check endpoint
http.route({
  path: '/health',
  method: 'GET',
  handler: healthCheck,
});

http.route({
  path: '/webhooks/resend',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    return await resend.handleResendEventWebhook(ctx, req);
  }),
});

http.route({
  path: '/aws/guardduty-malware',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    await verifyWebhookSignature({
      payload: rawBody,
      signature: request.headers.get('X-Scriptflow-Signature'),
      timestamp: request.headers.get('X-Scriptflow-Timestamp'),
    });

    const payload = parseGuardDutyWebhookPayload(rawBody);
    const result =
      payload.type === 'promotion_result'
        ? await applyGuardDutyPromotionResult(ctx, payload)
        : await applyGuardDutyFinding(ctx, payload);

    return Response.json(result, { status: 200 });
  }),
});

http.route({
  path: '/aws/storage-inspection',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    await verifyWebhookSignature({
      payload: rawBody,
      signature: request.headers.get('X-Scriptflow-Signature'),
      timestamp: request.headers.get('X-Scriptflow-Timestamp'),
    });

    const payload = parseStorageInspectionWebhookPayload(rawBody);
    const result = await applyStorageInspectionRequest(ctx, payload);

    return Response.json(result, { status: 200 });
  }),
});

http.route({
  path: '/api/files/serve',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const ticketId = url.searchParams.get('ticket');
    const expiresAtParam = url.searchParams.get('exp');
    const signature = url.searchParams.get('sig');
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = request.headers.get('user-agent');

    if (!expiresAtParam || !signature || !ticketId) {
      return new Response('Missing required file serve parameters.', { status: 400 });
    }

    const expiresAt = Number.parseInt(expiresAtParam, 10);
    const auth = createAuth(ctx);
    const sessionResult = (await auth.api.getSession({
      headers: request.headers,
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
      await recordFileAccessRedeemFailure(ctx, {
        authenticatedSessionId,
        authenticatedUserId,
        errorMessage: 'Authentication required to redeem a file access ticket.',
        expiresAt,
        requestIpAddress: ipAddress,
        requestUserAgent: userAgent,
        ticketId,
      }).catch(() => undefined);

      return new Response('Authentication required to redeem a file access ticket.', {
        status: 401,
      });
    }

    try {
      const redirect = await redeemFileAccessTicketOrThrow(ctx, {
        authenticatedSessionId,
        authenticatedUserId,
        expiresAt,
        requestIpAddress: ipAddress,
        requestUserAgent: userAgent,
        signature,
        ticketId,
      });
      return Response.redirect(redirect.url, 302);
    } catch (error) {
      await recordFileAccessRedeemFailure(ctx, {
        authenticatedSessionId,
        authenticatedUserId,
        errorMessage:
          error instanceof Error ? error.message : 'Failed to redeem file access ticket.',
        expiresAt,
        requestIpAddress: ipAddress,
        requestUserAgent: userAgent,
        ticketId,
      }).catch(() => undefined);

      return new Response(
        error instanceof Error ? error.message : 'Failed to redeem file access ticket.',
        { status: 403 },
      );
    }
  }),
});

export default http;
