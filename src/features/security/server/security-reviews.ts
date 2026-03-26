import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { handleServerError } from '~/lib/server/error-utils.server';
import { resolveRequestAuditContext } from '~/lib/server/request-audit-context';

const reviewRunIdSchema = z.object({
  reviewRunId: z.string().min(1),
});

export const finalizeReviewRunServerFn = createServerFn({ method: 'POST' })
  .inputValidator(reviewRunIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(api.securityReviews.finalizeReviewRun, {
        reviewRunId: data.reviewRunId as Id<'reviewRuns'>,
        requestContext,
      });
    } catch (error) {
      throw handleServerError(error, 'Finalize review run');
    }
  });
