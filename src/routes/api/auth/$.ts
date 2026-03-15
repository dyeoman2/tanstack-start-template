import { createFileRoute } from '@tanstack/react-router';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { handleScimOrganizationLifecycleRequest } from '~/features/auth/server/scim-route.server';

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => {
        return convexAuthReactStart.handler(request);
      },
      POST: async ({ request }) => {
        const scimResponse = await handleScimOrganizationLifecycleRequest(request.clone());
        if (scimResponse) {
          return scimResponse;
        }

        return convexAuthReactStart.handler(request);
      },
      PUT: async ({ request }) => {
        const scimResponse = await handleScimOrganizationLifecycleRequest(request.clone());
        if (scimResponse) {
          return scimResponse;
        }

        return convexAuthReactStart.handler(request);
      },
      PATCH: async ({ request }) => {
        const scimResponse = await handleScimOrganizationLifecycleRequest(request.clone());
        if (scimResponse) {
          return scimResponse;
        }

        return convexAuthReactStart.handler(request);
      },
      DELETE: async ({ request }) => {
        const scimResponse = await handleScimOrganizationLifecycleRequest(request.clone());
        if (scimResponse) {
          return scimResponse;
        }

        return convexAuthReactStart.handler(request);
      },
    },
  },
});
