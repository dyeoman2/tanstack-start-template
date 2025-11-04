import { createStartHandler, defaultRenderHandler } from '@tanstack/react-start/server';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { setSentryServerUser } from '~/lib/sentry';

// Database connection is now handled with lazy initialization via db proxy
// No need to initialize on server startup as the proxy handles this automatically

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

  return defaultRenderHandler({ request, router, responseHeaders });
});

export default {
  async fetch(req: Request): Promise<Response> {
    return await handler(req);
  },
};
