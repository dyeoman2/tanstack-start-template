import { createFileRoute } from '@tanstack/react-router';
import { healthCheckServerFn } from '~/lib/server/utility.server';

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        // Call the health check server function
        const result = await healthCheckServerFn();

        // Return JSON response
        return new Response(JSON.stringify(result), {
          headers: {
            'Content-Type': 'application/json',
          },
        });
      },
    },
  },
});
