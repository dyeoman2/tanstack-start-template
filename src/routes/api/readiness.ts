import { createFileRoute } from '@tanstack/react-router';
import {
  createHiddenObservabilityResponse,
  isPrivateObservabilityRequestAuthorized,
} from '~/lib/server/private-observability.server';
import { getInternalReadinessWarnings } from '~/lib/server/readiness.server';

export const Route = createFileRoute('/api/readiness')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isPrivateObservabilityRequestAuthorized(request)) {
          return createHiddenObservabilityResponse();
        }

        const warnings = getInternalReadinessWarnings();
        return Response.json({
          ready: warnings.length === 0,
          service: 'tanstack-start-template',
          timestamp: new Date().toISOString(),
          warnings,
        });
      },
    },
  },
});
