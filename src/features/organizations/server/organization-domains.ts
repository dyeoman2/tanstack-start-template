import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { handleServerError } from '~/lib/server/error-utils.server';
import { resolveRequestAuditContext } from '~/lib/server/request-audit-context';

const verifyOrganizationDomainSchema = z.object({
  organizationId: z.string().min(1),
  domainId: z.string().min(1),
});

export const verifyOrganizationDomainServerFn = createServerFn({ method: 'POST' })
  .inputValidator(verifyOrganizationDomainSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(
        api.organizationDomains.verifyOrganizationDomain,
        {
          organizationId: data.organizationId,
          domainId: data.domainId as Id<'organizationDomains'>,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Verify organization domain');
    }
  });
