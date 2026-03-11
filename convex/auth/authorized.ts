import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation, query } from '../_generated/server';
import { ADMIN_ACCESS, type CurrentUser, type ACCESS, checkTeamAccess, getCurrentUserOrThrow } from './access';
import { throwConvexError } from './errors';

type AuthorizedQueryCtx = QueryCtx & {
  user: CurrentUser;
  access: ACCESS;
  teamId: Id<'teams'>;
};

type AuthorizedMutationCtx = MutationCtx & {
  user: CurrentUser;
  access: ACCESS;
  teamId: Id<'teams'>;
};

export const teamIdArgs = {
  teamId: v.id('teams'),
} as const;

export function teamQuery<Result>(
  handler: (ctx: AuthorizedQueryCtx, args: { teamId: Id<'teams'> }) => Promise<Result>,
) {
  return query({
    args: teamIdArgs,
    handler: async (ctx, args) => {
      const user = await getCurrentUserOrThrow(ctx);
      const access = await checkTeamAccess(ctx, args.teamId, { user });
      if (!access.view) {
        throwConvexError('FORBIDDEN', 'Not authorized to view this team');
      }

      return await handler(Object.assign(ctx, { user, access, teamId: args.teamId }), args);
    },
  });
}

export function teamMutation<Result>(
  handler: (ctx: AuthorizedMutationCtx, args: { teamId: Id<'teams'> }) => Promise<Result>,
) {
  return mutation({
    args: teamIdArgs,
    handler: async (ctx, args) => {
      const user = await getCurrentUserOrThrow(ctx);
      const access = await checkTeamAccess(ctx, args.teamId, { user });
      if (!access.edit) {
        throwConvexError('FORBIDDEN', 'Not authorized to edit this team');
      }

      return await handler(Object.assign(ctx, { user, access, teamId: args.teamId }), args);
    },
  });
}

export function teamAdminMutation<Result>(
  handler: (ctx: AuthorizedMutationCtx, args: { teamId: Id<'teams'> }) => Promise<Result>,
) {
  return mutation({
    args: teamIdArgs,
    handler: async (ctx, args) => {
      const user = await getCurrentUserOrThrow(ctx);
      const access = user.isSiteAdmin
        ? ADMIN_ACCESS
        : await checkTeamAccess(ctx, args.teamId, { user }, { bypassSiteAdmin: false });

      if (!access.admin) {
        throwConvexError('ADMIN_REQUIRED', 'Admin access required for this team');
      }

      return await handler(Object.assign(ctx, { user, access, teamId: args.teamId }), args);
    },
  });
}
