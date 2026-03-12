import { assertUserId } from '../../src/lib/shared/user-id';
import {
  deriveIsSiteAdmin,
  normalizeUserRole,
} from '../../src/features/auth/lib/user-role';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import {
  type BetterAuthMember,
  fetchBetterAuthMembersByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
} from '../lib/betterAuth';
import { throwConvexError } from './errors';

type AuthzCtx = QueryCtx | MutationCtx | ActionCtx;

type BetterAuthUserWithRole = {
  _id?: string;
  id?: string;
  email?: string;
  name?: string | null;
  phoneNumber?: string | null;
  emailVerified?: boolean;
  role?: string | string[];
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
};

export interface ACCESS {
  admin: boolean;
  delete: boolean;
  edit: boolean;
  view: boolean;
  siteAdmin: boolean;
}

export const SITE_ADMIN_ACCESS: ACCESS = {
  admin: true,
  delete: true,
  edit: true,
  view: true,
  siteAdmin: true,
};

export const ADMIN_ACCESS: ACCESS = {
  admin: true,
  delete: true,
  edit: true,
  view: true,
  siteAdmin: false,
};

export const EDIT_ACCESS: ACCESS = {
  admin: false,
  delete: false,
  edit: true,
  view: true,
  siteAdmin: false,
};

export const VIEW_ACCESS: ACCESS = {
  admin: false,
  delete: false,
  edit: false,
  view: true,
  siteAdmin: false,
};

export const NO_ACCESS: ACCESS = {
  admin: false,
  delete: false,
  edit: false,
  view: false,
  siteAdmin: false,
};

export type CurrentUser = Doc<'users'> & {
  authUserId: string;
  authUser: BetterAuthUserWithRole;
  isSiteAdmin: boolean;
};

function toMillis(value: string | number | Date | undefined): number {
  if (!value) {
    return Date.now();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function mapOrganizationRoleToAccess(role: string): ACCESS {
  switch (role) {
    case 'owner':
    case 'admin':
      return ADMIN_ACCESS;
    case 'member':
      return EDIT_ACCESS;
    default:
      return NO_ACCESS;
  }
}

export async function getCurrentAuthUserOrThrow(ctx: AuthzCtx): Promise<BetterAuthUserWithRole> {
  const authUser = (await authComponent.getAuthUser(ctx)) as BetterAuthUserWithRole | null;
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  return authUser;
}

export async function getCurrentAuthUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthUserWithRole | null> {
  return (await authComponent.safeGetAuthUser(ctx)) as BetterAuthUserWithRole | null;
}

async function findAppUserByAuthUserId(ctx: QueryCtx | MutationCtx, authUserId: string) {
  return await ctx.db
    .query('users')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
    .first();
}

export async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<CurrentUser | null> {
  const authUser = await getCurrentAuthUserOrNull(ctx);
  if (!authUser) {
    return null;
  }

  const authUserId = assertUserId(authUser, 'User ID not found in auth user');
  const user = await findAppUserByAuthUserId(ctx, authUserId);
  if (!user) {
    return null;
  }

  return {
    ...user,
    authUserId,
    authUser,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role)),
  };
}

export async function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx): Promise<CurrentUser> {
  const authUser = await getCurrentAuthUserOrThrow(ctx);
  const authUserId = assertUserId(authUser, 'User ID not found in auth user');
  const user = await findAppUserByAuthUserId(ctx, authUserId);
  if (!user) {
    throwConvexError('UNAUTHENTICATED', 'User context not initialized');
  }

  return {
    ...user,
    authUserId,
    authUser,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role)),
  };
}

export async function getCurrentOrganizationOrNull(
  ctx: QueryCtx | MutationCtx,
  user?: CurrentUser,
) {
  const resolvedUser = user ?? (await getCurrentUserOrNull(ctx));
  if (!resolvedUser) {
    return null;
  }

  return await findBetterAuthOrganizationById(ctx, resolvedUser.lastActiveOrganizationId);
}

type OrganizationAccessOptions = {
  bypassSiteAdmin?: boolean;
};

export async function checkOrganizationAccess(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userCtx?: { user: CurrentUser },
  options: OrganizationAccessOptions = {},
): Promise<ACCESS> {
  const user = userCtx?.user ?? (await getCurrentUserOrThrow(ctx));
  const bypassSiteAdmin = options.bypassSiteAdmin ?? true;

  if (bypassSiteAdmin && user.isSiteAdmin) {
    return SITE_ADMIN_ACCESS;
  }

  const membership = await findBetterAuthMember(ctx, organizationId, user.authUserId);
  if (!membership) {
    return NO_ACCESS;
  }

  return mapOrganizationRoleToAccess(membership.role);
}

export type CurrentUserProfile = {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  role: 'user' | 'admin';
  isSiteAdmin: boolean;
  emailVerified: boolean;
  createdAt: number;
  updatedAt: number;
  currentOrganization: {
    id: string;
    name: string;
    role: string;
  } | null;
  organizations: Array<{
    id: string;
    name: string;
    role: string;
  }>;
};

async function resolveOrganizationsForUser(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
): Promise<Array<{ id: string; name: string; role: string }>> {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships
      .map((membership) => membership.organizationId)
      .filter((organizationId, index, values) => values.indexOf(organizationId) === index),
  );
  const organizationsById = new Map(organizations.map((organization) => [organization._id ?? '', organization]));

  return memberships
    .map((membership) => {
      const organization = organizationsById.get(membership.organizationId);
      if (!organization) {
        return null;
      }

      return {
        id: organization._id ?? membership.organizationId,
        name: organization.name,
        role: membership.role,
      };
    })
    .filter((organization): organization is NonNullable<typeof organization> => organization !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function buildCurrentUserProfile(
  ctx: QueryCtx | MutationCtx,
  user: CurrentUser,
): Promise<CurrentUserProfile> {
  const role = normalizeUserRole(user.authUser.role);
  const organizations = await resolveOrganizationsForUser(ctx, user.authUserId);
  const currentOrganization =
    organizations.find((organization) => organization.id === user.lastActiveOrganizationId) ??
    organizations[0] ??
    null;

  return {
    id: user.authUserId,
    email: user.authUser.email ?? '',
    name: user.authUser.name ?? null,
    phoneNumber: user.authUser.phoneNumber ?? null,
    role,
    isSiteAdmin: deriveIsSiteAdmin(role),
    emailVerified: user.authUser.emailVerified ?? false,
    createdAt: toMillis(user.authUser.createdAt),
    updatedAt: toMillis(user.authUser.updatedAt),
    currentOrganization,
    organizations,
  };
}

export async function listOrganizationMembers(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<BetterAuthMember[]> {
  return await fetchBetterAuthMembersByOrganizationId(ctx, organizationId);
}
