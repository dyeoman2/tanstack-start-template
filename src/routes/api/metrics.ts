import { createFileRoute } from '@tanstack/react-router';
import {
  createHiddenObservabilityResponse,
  isPrivateObservabilityRequestAuthorized,
} from '~/lib/server/private-observability.server';

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isPrivateObservabilityRequestAuthorized(request)) {
          return createHiddenObservabilityResponse();
        }

        return Response.json({
          service: 'tanstack-start-template',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
        });
      },
    },
  },
});
