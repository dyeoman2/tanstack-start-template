import { createFileRoute } from '@tanstack/react-router';
import { testGatewayConnectivity } from '~/features/ai/server/cloudflare-ai.server';

export const Route = createFileRoute('/api/test-gateway')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const result = await testGatewayConnectivity();
          return new Response(JSON.stringify(result), {
            headers: {
              'Content-Type': 'application/json',
            },
          });
        } catch (error) {
          return new Response(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
            {
              status: 500,
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
