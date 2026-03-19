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

          const data = await response.json();
          return new Response(JSON.stringify(data), {
            status: response.status,
            headers: {
              'Content-Type': 'application/json',
            },
          });
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
