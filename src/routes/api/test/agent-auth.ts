import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import {
  assertE2EAuthRequestAuthorized,
  copySetCookieHeaders,
  establishE2EAuthSession,
  resolveAgentAuthRedirect,
} from '~/lib/server/e2e-auth.server';

const agentAuthSchema = z.object({
  principal: z.enum(['user', 'admin']),
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute('/api/test/agent-auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        assertE2EAuthRequestAuthorized(request);

        const body = agentAuthSchema.safeParse(await request.json());
        if (!body.success) {
          return new Response(body.error.message, { status: 400 });
        }

        const session = await establishE2EAuthSession(request, body.data.principal);
        const headers = new Headers({
          Location: resolveAgentAuthRedirect(request, body.data.redirectTo),
        });
        copySetCookieHeaders(session.authResponse, headers);

        if (!headers.get('set-cookie')) {
          throw new Response('No auth cookies were issued for e2e principal', { status: 500 });
        }

        return new Response(null, {
          status: 302,
          headers,
        });
      },
    },
  },
});
