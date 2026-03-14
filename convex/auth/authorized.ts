import type {
  DefaultArgsForOptionalValidator,
  ReturnValueForOptionalValidator,
} from 'convex/server';
import type { GenericValidator, PropertyValidators } from 'convex/values';
import { v } from 'convex/values';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { action, mutation, query } from '../_generated/server';
import {
  type ACCESS,
  ADMIN_ACCESS,
  type CurrentUser,
  checkOrganizationAccess,
  getCurrentSiteAdminAuthUserOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
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

type OptionalAuthorizedQueryCtx = QueryCtx & {
  user: CurrentUser;
  access: ACCESS | null;
  organizationId: string | null;
};

type SiteAdminQueryCtx = QueryCtx & {
  user: CurrentUser;
};

type SiteAdminMutationCtx = MutationCtx & {
  user: CurrentUser;
};

type SiteAdminActionCtx = ActionCtx & {
  authUser: Awaited<ReturnType<typeof getCurrentSiteAdminAuthUserOrThrow>>;
};

type AuthorizedConfig<
  TCtx,
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
> = {
  args: TArgs;
  returns: TReturns;
  handler: (
    ctx: TCtx,
    args: DefaultArgsForOptionalValidator<TArgs>[0],
  ) => Promise<ReturnValueForOptionalValidator<TReturns>>;
};

export const organizationIdArgs = {
  organizationId: v.string(),
} as const;

export const optionalOrganizationIdArgs = {
  organizationId: v.optional(v.string()),
} as const;

type OrganizationScopedArgs<TArgs extends PropertyValidators> = TArgs & typeof organizationIdArgs;
type OptionalOrganizationScopedArgs<TArgs extends PropertyValidators> = TArgs &
  typeof optionalOrganizationIdArgs;

export async function authorizeOrganizationView(
  ctx: QueryCtx,
  organizationId: string,
): Promise<AuthorizedQueryCtx> {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const access = await checkOrganizationAccess(ctx, organizationId, { user });
  if (!access.view) {
    throwConvexError('FORBIDDEN', 'Not authorized to view this organization');
  }

  return Object.assign(ctx, { user, access, organizationId });
}

export async function authorizeOrganizationEdit(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AuthorizedMutationCtx> {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const access = await checkOrganizationAccess(ctx, organizationId, { user });
  if (!access.edit) {
    throwConvexError('FORBIDDEN', 'Not authorized to edit this organization');
  }

  return Object.assign(ctx, { user, access, organizationId });
}

export async function authorizeOrganizationAdmin(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AuthorizedMutationCtx> {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const access = user.isSiteAdmin
    ? ADMIN_ACCESS
    : await checkOrganizationAccess(ctx, organizationId, { user }, { bypassSiteAdmin: false });

  if (!access.admin) {
    throwConvexError('ADMIN_REQUIRED', 'Admin access required for this organization');
  }

  return Object.assign(ctx, { user, access, organizationId });
}

export async function authorizeOptionalOrganizationView(
  ctx: QueryCtx,
  organizationId: string | null | undefined,
): Promise<OptionalAuthorizedQueryCtx> {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const resolvedOrganizationId = organizationId ?? null;
  const access = resolvedOrganizationId
    ? await checkOrganizationAccess(ctx, resolvedOrganizationId, { user })
    : null;

  return Object.assign(ctx, { user, access, organizationId: resolvedOrganizationId });
}

export async function authorizeSiteAdminQueryContext(ctx: QueryCtx): Promise<SiteAdminQueryCtx> {
  const user = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  return Object.assign(ctx, { user });
}

export async function authorizeSiteAdminMutationContext(
  ctx: MutationCtx,
): Promise<SiteAdminMutationCtx> {
  const user = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  return Object.assign(ctx, { user });
}

export async function authorizeSiteAdminActionContext(ctx: ActionCtx): Promise<SiteAdminActionCtx> {
  const authUser = await getCurrentSiteAdminAuthUserOrThrow(ctx);
  return Object.assign(ctx, { authUser });
}

export function organizationQuery<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(config: AuthorizedConfig<AuthorizedQueryCtx, OrganizationScopedArgs<TArgs>, TReturns>) {
  return query({
    args: {
      ...config.args,
      ...organizationIdArgs,
    },
    returns: config.returns,
    handler: (async (
      ctx: QueryCtx,
      args: DefaultArgsForOptionalValidator<OrganizationScopedArgs<TArgs>>[0],
    ) => {
      return await config.handler(await authorizeOrganizationView(ctx, args.organizationId), args);
    }) as never,
  });
}

export function organizationMutation<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(config: AuthorizedConfig<AuthorizedMutationCtx, OrganizationScopedArgs<TArgs>, TReturns>) {
  return mutation({
    args: {
      ...config.args,
      ...organizationIdArgs,
    },
    returns: config.returns,
    handler: (async (
      ctx: MutationCtx,
      args: DefaultArgsForOptionalValidator<OrganizationScopedArgs<TArgs>>[0],
    ) => {
      return await config.handler(await authorizeOrganizationEdit(ctx, args.organizationId), args);
    }) as never,
  });
}

export function organizationAdminMutation<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(config: AuthorizedConfig<AuthorizedMutationCtx, OrganizationScopedArgs<TArgs>, TReturns>) {
  return mutation({
    args: {
      ...config.args,
      ...organizationIdArgs,
    },
    returns: config.returns,
    handler: (async (
      ctx: MutationCtx,
      args: DefaultArgsForOptionalValidator<OrganizationScopedArgs<TArgs>>[0],
    ) => {
      return await config.handler(await authorizeOrganizationAdmin(ctx, args.organizationId), args);
    }) as never,
  });
}

export function optionalOrganizationQuery<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(
  config: AuthorizedConfig<
    OptionalAuthorizedQueryCtx,
    OptionalOrganizationScopedArgs<TArgs>,
    TReturns
  >,
) {
  return query({
    args: {
      ...config.args,
      ...optionalOrganizationIdArgs,
    },
    returns: config.returns,
    handler: (async (
      ctx: QueryCtx,
      args: DefaultArgsForOptionalValidator<OptionalOrganizationScopedArgs<TArgs>>[0],
    ) => {
      return await config.handler(
        await authorizeOptionalOrganizationView(ctx, args.organizationId),
        args,
      );
    }) as never,
  });
}

export function siteAdminQuery<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(config: AuthorizedConfig<SiteAdminQueryCtx, TArgs, TReturns>) {
  return query({
    args: config.args,
    returns: config.returns,
    handler: (async (ctx: QueryCtx, args: DefaultArgsForOptionalValidator<TArgs>[0]) => {
      return await config.handler(await authorizeSiteAdminQueryContext(ctx), args);
    }) as never,
  });
}

export function siteAdminMutation<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(config: AuthorizedConfig<SiteAdminMutationCtx, TArgs, TReturns>) {
  return mutation({
    args: config.args,
    returns: config.returns,
    handler: (async (ctx: MutationCtx, args: DefaultArgsForOptionalValidator<TArgs>[0]) => {
      return await config.handler(await authorizeSiteAdminMutationContext(ctx), args);
    }) as never,
  });
}

export function siteAdminAction<
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator | PropertyValidators,
>(config: AuthorizedConfig<SiteAdminActionCtx, TArgs, TReturns>) {
  return action({
    args: config.args,
    returns: config.returns,
    handler: (async (ctx: ActionCtx, args: DefaultArgsForOptionalValidator<TArgs>[0]) => {
      return await config.handler(await authorizeSiteAdminActionContext(ctx), args);
    }) as never,
  });
}
