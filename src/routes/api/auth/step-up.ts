import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { createPendingStepUpCookie } from '~/lib/server/step-up-cookie.server';
import { STEP_UP_REQUIREMENTS } from '~/lib/shared/auth-policy';

const stepUpStartSchema = z.object({
  redirectTo: z.string().optional(),
  requirement: z.enum([
    STEP_UP_REQUIREMENTS.accountEmailChange,
    STEP_UP_REQUIREMENTS.auditExport,
    STEP_UP_REQUIREMENTS.attachmentAccess,
    STEP_UP_REQUIREMENTS.documentExport,
    STEP_UP_REQUIREMENTS.documentDeletion,
    STEP_UP_REQUIREMENTS.organizationAdmin,
    STEP_UP_REQUIREMENTS.sessionAdministration,
    STEP_UP_REQUIREMENTS.userAdministration,
  ]),
});

export const Route = createFileRoute('/api/auth/step-up')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = stepUpStartSchema.safeParse(await request.json());
        if (!body.success) {
          return new Response(body.error.message, { status: 400 });
        }

        return new Response(null, {
          status: 204,
          headers: {
            'set-cookie': createPendingStepUpCookie(body.data),
          },
        });
      },
    },
  },
});
