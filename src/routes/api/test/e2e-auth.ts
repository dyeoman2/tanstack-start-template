import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import {
  assertE2EAuthRequestAuthorized,
  establishE2EAuthSession,
  getPlaywrightCookiesFromResponse,
} from '~/lib/server/e2e-auth.server';

const principalSchema = z.object({
  principal: z.enum(['user', 'admin']),
});

async function buildPlaywrightAuthPayload(request: Request, principal: 'user' | 'admin') {
  const session = await establishE2EAuthSession(request, principal);
  const cookies = getPlaywrightCookiesFromResponse(
    session.authResponse,
    new URL(request.url).origin,
  );

  if (cookies.length === 0) {
    throw new Response('No auth cookies were issued for e2e principal', { status: 500 });
  }

  return {
    cookies,
    email: session.email,
    principal: session.principal,
    userId: session.userId,
  };
}

export const Route = createFileRoute('/api/test/e2e-auth' as never)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        assertE2EAuthRequestAuthorized(request);

        const body = principalSchema.safeParse(await request.json());
        if (!body.success) {
          return new Response(body.error.message, { status: 400 });
        }

        const response = await buildPlaywrightAuthPayload(request, body.data.principal);
        return Response.json(response);
      },
    },
  },
});
