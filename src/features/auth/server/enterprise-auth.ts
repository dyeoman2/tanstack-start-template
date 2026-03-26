import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { createConvexPublicClient } from '~/lib/server/convex-admin.server';
import { handleServerError } from '~/lib/server/error-utils.server';

const resolveEnterpriseAuthDiscoverySchema = z.object({
  email: z.string().trim().email(),
});

export const resolveEnterpriseAuthDiscoveryServerFn = createServerFn({ method: 'POST' })
  .inputValidator(resolveEnterpriseAuthDiscoverySchema)
  .handler(async ({ data }) => {
    try {
      return await createConvexPublicClient().action(
        api.organizationManagement.resolveOrganizationEnterpriseAuthByEmail,
        data,
      );
    } catch (error) {
      throw handleServerError(error, 'Resolve enterprise auth discovery');
    }
  });
