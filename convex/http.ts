import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './auth';
import { resend } from './emails';
import { healthCheck } from './health';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth as Parameters<typeof authComponent.registerRoutes>[1]);

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

export default http;
