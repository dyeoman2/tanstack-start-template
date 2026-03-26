import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { handleServerError } from '~/lib/server/error-utils.server';
import { resolveRequestAuditContext } from '~/lib/server/request-audit-context';

const storageIdSchema = z.object({
  storageId: z.string().min(1),
});

export const createSignedServeUrlServerFn = createServerFn({ method: 'POST' })
  .inputValidator(storageIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(api.fileServing.createSignedServeUrl, {
        ...data,
        requestContext,
      });
    } catch (error) {
      throw handleServerError(error, 'Create signed file URL');
    }
  });
