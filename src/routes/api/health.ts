import { createFileRoute } from '@tanstack/react-router';
import { deriveConvexSiteUrl, normalizeUrlOrigin } from '~/lib/convex-url';

/**
 * Convex HTTP actions (including `/health`) are served from the deployment's
 * `.convex.site` origin. `VITE_CONVEX_URL` points at `.convex.cloud` for the
 * query/mutation API and does not expose HTTP routes — probing it yields 404.
 */
function resolveConvexHttpOrigin(): string | undefined {
  const cloudUrl = process.env.VITE_CONVEX_URL?.trim().replace(/\/$/, '');
  if (!cloudUrl) {
    return undefined;
  }

  return cloudUrl.includes('://') ? deriveConvexSiteUrl(cloudUrl) : normalizeUrlOrigin(cloudUrl);
}

function createLivenessResponse(status: 'healthy' | 'unhealthy', responseStatus: 200 | 503) {
  return new Response(JSON.stringify({ status }), {
    status: responseStatus,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Health check endpoint - proxies to Convex HTTP endpoint
 * The actual health check logic is now in Convex (convex/health.ts)
 * This route forwards requests to the Convex HTTP endpoint
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const convexHttpOrigin = resolveConvexHttpOrigin();
        if (!convexHttpOrigin) {
          return createLivenessResponse('unhealthy', 503);
        }

        try {
          const response = await fetch(`${convexHttpOrigin}/health`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            return createLivenessResponse('unhealthy', 503);
          }

          try {
            const payload = (await response.json()) as { status?: string };
            return payload.status === 'healthy'
              ? createLivenessResponse('healthy', 200)
              : createLivenessResponse('unhealthy', 503);
          } catch {
            return createLivenessResponse('unhealthy', 503);
          }
        } catch (error) {
          console.error('Health check proxy failed', error);
          return createLivenessResponse('unhealthy', 503);
        }
      },
    },
  },
});
