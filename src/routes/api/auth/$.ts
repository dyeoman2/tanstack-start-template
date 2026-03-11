import { createFileRoute } from '@tanstack/react-router';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => {
        return convexAuthReactStart.handler(request);
      },
      POST: ({ request }) => {
        return convexAuthReactStart.handler(request);
      },
    },
  },
});
