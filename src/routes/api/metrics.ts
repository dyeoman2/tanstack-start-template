import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          service: 'tanstack-start-template',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
        }),
    },
  },
});
