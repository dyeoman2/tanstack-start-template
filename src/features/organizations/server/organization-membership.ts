import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { leaveBetterAuthOrganization } from '~/lib/server/better-auth/api';
import { handleServerError } from '~/lib/server/error-utils.server';

const organizationIdSchema = z.object({
  organizationId: z.string().min(1),
});

export const leaveOrganizationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await leaveBetterAuthOrganization(data.organizationId);

      await convexAuthReactStart.fetchAuthAction(api.users.ensureCurrentUserContext, {});
      const profile = await convexAuthReactStart.fetchAuthQuery(
        api.users.getCurrentUserProfile,
        {},
      );
      return {
        success: true,
        nextOrganizationId: profile?.currentOrganization?.id ?? null,
      };
    } catch (error) {
      throw handleServerError(error, 'Leave organization');
    }
  });
