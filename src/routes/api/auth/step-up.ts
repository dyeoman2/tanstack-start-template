import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { createPendingStepUpCookie } from '~/lib/server/step-up-cookie.server';

const stepUpPrepareSchema = z.object({
  challengeId: z.string().uuid(),
});

export const Route = createFileRoute('/api/auth/step-up')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = stepUpPrepareSchema.safeParse(await request.json());
        if (!body.success) {
          return new Response(body.error.message, { status: 400 });
        }

        try {
          await convexAuthReactStart.fetchAuthMutation(api.stepUp.prepareCurrentChallenge, {
            challengeId: body.data.challengeId,
          });
        } catch {
          return new Response('Unable to prepare the verification challenge.', { status: 403 });
        }

        return new Response(null, {
          status: 204,
          headers: {
            'set-cookie': createPendingStepUpCookie({ challengeId: body.data.challengeId }),
          },
        });
      },
    },
  },
});
