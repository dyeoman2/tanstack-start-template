import { createStartHandler, defaultRenderHandler } from '@tanstack/react-start/server';
import { requireAuth } from '~/features/auth/server/auth-guards';
import {
  buildDocumentContentSecurityPolicy,
  generateCspNonce,
  getConfiguredConvexOrigin,
  getConfiguredSentryOrigin,
  getDocumentCspHeaderName,
  getDocumentCspMode,
  shouldSetStrictTransportSecurity,
} from '~/lib/server/csp.server';
import { setSentryServerUser } from '~/lib/sentry';

// Database connection is now handled with lazy initialization via db proxy
// No need to initialize on server startup as the proxy handles this automatically

const convexOrigin = getConfiguredConvexOrigin();
const sentryOrigin = getConfiguredSentryOrigin();
const documentCspMode = getDocumentCspMode();

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
  const nonce = router.options.ssr?.nonce ?? generateCspNonce();
  const documentContentSecurityPolicy = buildDocumentContentSecurityPolicy({
    convexOrigin,
    mode: documentCspMode,
    nonce,
    sentryOrigin,
  });

  responseHeaders.set('Document-Policy', 'js-profiling');
  responseHeaders.set(getDocumentCspHeaderName(documentCspMode), documentContentSecurityPolicy);
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');
  responseHeaders.set('Permissions-Policy', DOCUMENT_PERMISSIONS_POLICY);
  responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('X-Frame-Options', 'DENY');
  responseHeaders.set('X-Permitted-Cross-Domain-Policies', 'none');
  if (shouldSetStrictTransportSecurity(request)) {
    responseHeaders.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }
  responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Expires', '0');

  return defaultRenderHandler({ request, router, responseHeaders });
});

export default {
  async fetch(req: Request): Promise<Response> {
    return await handler(req, {
      context: {
        nonce: generateCspNonce(),
      },
    });
  },
};
