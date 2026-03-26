import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';
import { buildTrustedConvexAuthRequest } from '../src/lib/shared/better-auth-http';
import { createAuth } from './auth';
import { resend } from './emails';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { parseDocumentResultWebhookPayload } from '../src/lib/shared/storage-webhook-payload';
import { verifyStorageWebhookSignatureWithSecrets } from '../src/lib/server/storage-webhook-signature';
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
import { handleFileServeRequest } from './fileServeHttp';

const http = httpRouter();

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
  handler: httpAction(async (ctx, request) => await handleFileServeRequest(ctx, request)),
});

export default http;
