import { createStartHandler, defaultRenderHandler } from '@tanstack/react-start/server';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { setSentryServerUser } from '~/lib/sentry';

// Database connection is now handled with lazy initialization via db proxy
// No need to initialize on server startup as the proxy handles this automatically

function getOrigin(input: string | undefined): string | null {
  if (!input) {
    return null;
  }

  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

const convexOrigin = getOrigin(import.meta.env.VITE_CONVEX_URL);
const sentryOrigin = getOrigin(import.meta.env.VITE_SENTRY_DSN);

const connectSrc = ["'self'"];
if (convexOrigin) {
  connectSrc.push(convexOrigin);
  connectSrc.push(convexOrigin.replace(/^http/, 'ws'));
}
if (sentryOrigin) {
  connectSrc.push(sentryOrigin);
}

const DOCUMENT_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google.com",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(' ')}`,
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
  responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Expires', '0');

  return defaultRenderHandler({ request, router, responseHeaders });
});

export default {
  async fetch(req: Request): Promise<Response> {
    return await handler(req);
  },
};
