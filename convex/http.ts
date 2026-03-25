import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { resend } from './emails';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { verifyStorageWebhookSignatureWithSecrets } from '../src/lib/server/storage-webhook-signature';
import { recordFileAccessRedeemFailure, redeemFileAccessTicketOrThrow } from './fileServing';
import { healthCheck } from './health';
import {
  applyStorageInspectionRequest,
  applyStorageInspectionResult,
  parseStorageInspectionWebhookPayload,
} from './storageDecision';
import { applyChatDocumentParseResult } from './agentChatActions';
import { applyPdfParseDocumentResult } from './pdfParseActions';
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

    const parsedPayload = JSON.parse(payload) as {
      errorMessage?: string;
      imageCount?: number;
      pageCount?: number;
      parseKind: 'chat_document_extract' | 'pdf_parse';
      parserVersion?: string;
      resultContentType?: string;
      resultKey?: string;
      status: 'FAILED' | 'SUCCEEDED';
      storageId: string;
    };
    const result =
      parsedPayload.parseKind === 'pdf_parse'
        ? await applyPdfParseDocumentResult(ctx, parsedPayload)
        : await applyChatDocumentParseResult(ctx, parsedPayload);

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
