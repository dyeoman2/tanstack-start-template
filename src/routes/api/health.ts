import { createFileRoute } from '@tanstack/react-router';

/**
 * Health check endpoint - proxies to Convex HTTP endpoint
 * The actual health check logic is now in Convex (convex/health.ts)
 * This route forwards requests to the Convex HTTP endpoint
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        // Read the Convex deployment URL from the server runtime environment.
        const convexUrl = process.env.VITE_CONVEX_URL?.trim();
        if (!convexUrl) {
          return new Response(
            JSON.stringify({
              status: 'unhealthy',
              error: 'VITE_CONVEX_URL not configured',
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
          const response = await fetch(`${convexUrl}/health`, {
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
