import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { auth } = await import('~/features/auth/server/auth');
        return auth.handler(request);
      },
      POST: async ({ request }) => {
        const { auth } = await import('~/features/auth/server/auth');
        return auth.handler(request);
      },
    },
  },
});
