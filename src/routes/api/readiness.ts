import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/readiness')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ready: true,
          service: 'tanstack-start-template',
          timestamp: new Date().toISOString(),
        }),
    },
  },
});

