import { v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation, query } from '../_generated/server';
import {
  ADMIN_ACCESS,
  type ACCESS,
  checkOrganizationAccess,
  type CurrentUser,
  getVerifiedCurrentUserOrThrow,
} from './access';
import { throwConvexError } from './errors';

type AuthorizedQueryCtx = QueryCtx & {
  user: CurrentUser;
  access: ACCESS;
  organizationId: string;
};

type AuthorizedMutationCtx = MutationCtx & {
  user: CurrentUser;
  access: ACCESS;
  organizationId: string;
};

export const organizationIdArgs = {
  organizationId: v.string(),
} as const;

export function organizationQuery<Result>(
  handler: (
    ctx: AuthorizedQueryCtx,
    args: { organizationId: string },
  ) => Promise<Result>,
) {
  return query({
    args: organizationIdArgs,
    handler: async (ctx, args) => {
      const user = await getVerifiedCurrentUserOrThrow(ctx);
      const access = await checkOrganizationAccess(ctx, args.organizationId, { user });
      if (!access.view) {
        throwConvexError('FORBIDDEN', 'Not authorized to view this organization');
      }

      return await handler(
        Object.assign(ctx, { user, access, organizationId: args.organizationId }),
        args,
      );
    },
  });
}

export function organizationMutation<Result>(
  handler: (
    ctx: AuthorizedMutationCtx,
    args: { organizationId: string },
  ) => Promise<Result>,
) {
  return mutation({
    args: organizationIdArgs,
    handler: async (ctx, args) => {
      const user = await getVerifiedCurrentUserOrThrow(ctx);
      const access = await checkOrganizationAccess(ctx, args.organizationId, { user });
      if (!access.edit) {
        throwConvexError('FORBIDDEN', 'Not authorized to edit this organization');
      }

      return await handler(
        Object.assign(ctx, { user, access, organizationId: args.organizationId }),
        args,
      );
    },
  });
}

export function organizationAdminMutation<Result>(
  handler: (
    ctx: AuthorizedMutationCtx,
    args: { organizationId: string },
  ) => Promise<Result>,
) {
  return mutation({
    args: organizationIdArgs,
    handler: async (ctx, args) => {
      const user = await getVerifiedCurrentUserOrThrow(ctx);
      const access = user.isSiteAdmin
        ? ADMIN_ACCESS
        : await checkOrganizationAccess(
            ctx,
            args.organizationId,
            { user },
            { bypassSiteAdmin: false },
          );

      if (!access.admin) {
        throwConvexError('ADMIN_REQUIRED', 'Admin access required for this organization');
      }

      return await handler(
        Object.assign(ctx, { user, access, organizationId: args.organizationId }),
        args,
      );
    },
  });
}
