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
          return new Response(
            JSON.stringify({
              status: 'unhealthy',
              error: 'Convex HTTP origin not configured (set VITE_CONVEX_URL)',
            }),
            {
              status: 503,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        }

        try {
          // Call Convex HTTP endpoint
          const response = await fetch(`${convexHttpOrigin}/health`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          const rawBody = await response.text();
          const trimmedBody = rawBody.trim();

          if (trimmedBody.length === 0) {
            return new Response(
              JSON.stringify({
                status: response.ok ? 'healthy' : 'unhealthy',
                upstreamStatus: response.status,
              }),
              {
                status: response.ok ? 200 : 503,
                headers: {
                  'Content-Type': 'application/json',
                },
              },
            );
          }

          try {
            const data = JSON.parse(trimmedBody);
            return new Response(JSON.stringify(data), {
              status: response.status,
              headers: {
                'Content-Type': 'application/json',
              },
            });
          } catch {
            return new Response(
              JSON.stringify({
                status: response.ok ? 'healthy' : 'unhealthy',
                raw: trimmedBody.slice(0, 500),
                upstreamStatus: response.status,
              }),
              {
                status: response.ok ? 200 : 503,
                headers: {
                  'Content-Type': 'application/json',
                },
              },
            );
          }
        } catch (error) {
          return new Response(
            JSON.stringify({
              status: 'unhealthy',
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
            {
              status: 503,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        }
      },
    },
  },
});
