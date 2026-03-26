import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { buildTrustedConvexAuthRequest } from '../src/lib/shared/better-auth-http';
import { createAuth } from './auth';
import { resend } from './emails';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { parseDocumentResultWebhookPayload } from '../src/lib/shared/storage-webhook-payload';
import { verifyStorageWebhookSignatureWithSecrets } from '../src/lib/server/storage-webhook-signature';
import { recordFileAccessRedeemFailure, redeemFileAccessTicketOrThrow } from './fileServing';
import { healthCheck } from './health';
import {
  applyStorageInspectionRequest,
  applyStorageInspectionResult,
  parseStorageInspectionWebhookPayload,
} from './storageDecision';
import {
  applyGuardDutyPromotionResult,
  applyGuardDutyFinding,
  parseGuardDutyWebhookPayload,
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

http.route({
  path: '/.well-known/openid-configuration',
  method: 'GET',
  handler: httpAction(async () => {
    return Response.redirect(
      `${process.env.CONVEX_SITE_URL}/api/auth/convex/.well-known/openid-configuration`,
    );
  }),
});

http.route({
  pathPrefix: '/api/auth/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const auth = createAuth(ctx);
    const trustedRequest = await buildTrustedConvexAuthRequest(request);
    return await auth.handler(trustedRequest);
  }),
});

http.route({
  pathPrefix: '/api/auth/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const auth = createAuth(ctx);
    const trustedRequest = await buildTrustedConvexAuthRequest(request);
    return await auth.handler(trustedRequest);
  }),
});

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

async function ensureSignedStorageCallback(
  request: Request,
  sharedSecrets: Array<string | null | undefined>,
) {
  const payload = await request.text();
  await verifyStorageWebhookSignatureWithSecrets({
    payload,
    sharedSecrets,
    signature: request.headers.get('x-scriptflow-signature'),
    timestamp: request.headers.get('x-scriptflow-timestamp'),
  });
  return payload;
}

function getStorageCallbackSecrets(kind: 'decision' | 'document' | 'inspection') {
  const runtimeConfig = getStorageRuntimeConfig();
  const config = runtimeConfig.services.callbacks[kind];
  return [config.currentSecret, config.previousSecret];
}

http.route({
  path: '/internal/storage/guardduty',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    let payload: string;
    try {
      payload = await ensureSignedStorageCallback(request, getStorageCallbackSecrets('decision'));
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : 'Storage callback signature verification failed.',
        { status: 401 },
      );
    }

    const parsedPayload = parseGuardDutyWebhookPayload(payload);
    const result =
      parsedPayload.type === 'promotion_result'
        ? await applyGuardDutyPromotionResult(ctx, parsedPayload)
        : await applyGuardDutyFinding(ctx, parsedPayload);

    return Response.json(result, { status: 200 });
  }),
});

http.route({
  path: '/internal/storage/inspection',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    let payload: string;
    try {
      payload = await ensureSignedStorageCallback(request, getStorageCallbackSecrets('inspection'));
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : 'Storage callback signature verification failed.',
        { status: 401 },
      );
    }

    const result = await applyStorageInspectionRequest(
      ctx,
      parseStorageInspectionWebhookPayload(payload),
    );

    return Response.json(result, { status: 200 });
  }),
});

http.route({
  path: '/internal/storage/inspection-result',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    let payload: string;
    try {
      payload = await ensureSignedStorageCallback(request, getStorageCallbackSecrets('inspection'));
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : 'Storage callback signature verification failed.',
        { status: 401 },
      );
    }

    const parsedPayload = JSON.parse(payload) as Parameters<typeof applyStorageInspectionResult>[1];
    const result = await applyStorageInspectionResult(ctx, parsedPayload);

    return Response.json(result, { status: 200 });
  }),
});

http.route({
  path: '/internal/storage/document-result',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    let payload: string;
    try {
      payload = await ensureSignedStorageCallback(request, getStorageCallbackSecrets('document'));
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : 'Storage callback signature verification failed.',
        { status: 401 },
      );
    }

    let parsedPayload: ReturnType<typeof parseDocumentResultWebhookPayload>;
    try {
      parsedPayload = parseDocumentResultWebhookPayload(payload);
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : 'Document parse callback payload is malformed.',
        { status: 400 },
      );
    }
    const result =
      parsedPayload.parseKind === 'pdf_parse'
        ? await ctx.runAction(
            internal.pdfParseActions.applyPdfParseDocumentResultInternal,
            parsedPayload,
          )
        : await ctx.runAction(
            internal.agentChatActions.applyChatDocumentParseResultInternal,
            parsedPayload,
          );

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
        requestIpAddress: null,
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
        requestIpAddress: null,
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
        requestIpAddress: null,
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
