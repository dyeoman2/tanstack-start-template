import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/chat/stream' as never)({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          {
            errorMessage: 'Chat streaming has moved to the Convex HTTP endpoint.',
          },
          { status: 410 },
        ),
    },
  },
});
