import { createStartHandler, defaultRenderHandler } from '@tanstack/react-start/server';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { setSentryServerUser } from '~/lib/sentry';

// Database connection is now handled with lazy initialization via db proxy
// No need to initialize on server startup as the proxy handles this automatically

const DOCUMENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  'upgrade-insecure-requests',
].join('; ');

const DOCUMENT_PERMISSIONS_POLICY = [
  'camera=()',
  'geolocation=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'browsing-topics=()',
].join(', ');

const handler = createStartHandler(async ({ request, router, responseHeaders }) => {
  // Set Sentry user context for server-side events
  try {
    const authResult = await requireAuth();
    setSentryServerUser(authResult.user);
  } catch {
    // If user is not authenticated, clear the context
    setSentryServerUser(null);
  }

  // Set Document-Policy header to enable browser profiling
  responseHeaders.set('Document-Policy', 'js-profiling');
  responseHeaders.set('Content-Security-Policy', DOCUMENT_CONTENT_SECURITY_POLICY);
  responseHeaders.set('Permissions-Policy', DOCUMENT_PERMISSIONS_POLICY);
  responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('X-Frame-Options', 'DENY');
  responseHeaders.set('Cache-Control', 'no-store, max-age=0');

  return defaultRenderHandler({ request, router, responseHeaders });
});

export default {
  async fetch(req: Request): Promise<Response> {
    return await handler(req);
  },
};
