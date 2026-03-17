import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { resend } from './emails';
import { resolveServeRedirect, verifyFileServeSignature } from './fileServing';
import { healthCheck } from './health';
import {
  applyGuardDutyFinding,
  parseGuardDutyWebhookPayload,
  verifyWebhookSignature,
} from './storageWebhook';

const http = httpRouter();

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
    const result = await applyGuardDutyFinding(ctx, payload);

    return Response.json(result, { status: 200 });
  }),
});

http.route({
  path: '/api/files/serve',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const storageId = url.searchParams.get('id');
    const signature = url.searchParams.get('sig');

    if (!storageId || !signature) {
      return new Response('Missing required file serve parameters.', { status: 400 });
    }

    await verifyFileServeSignature(storageId, signature);
    const redirect = await resolveServeRedirect(ctx, storageId);
    return Response.redirect(redirect.url, 302);
  }),
});

export default http;
