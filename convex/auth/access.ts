import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';
import {
  ADMIN_ORGANIZATION_ACCESS,
  EDIT_ORGANIZATION_ACCESS,
  getOrganizationAccess,
  NO_ORGANIZATION_ACCESS,
  SITE_ADMIN_ORGANIZATION_ACCESS,
  type OrganizationAccess,
  VIEW_ORGANIZATION_ACCESS,
} from '../../src/features/organizations/lib/organization-permissions';
import { isEmailVerificationRequiredForUser } from '../../src/lib/shared/email-verification';
import { getEmailVerificationEnforcedAt } from '../../src/lib/server/env.server';
import { assertUserId } from '../../src/lib/shared/user-id';
import { components } from '../_generated/api';
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

type BetterAuthSession = {
  _id?: string;
  id?: string;
  userId?: string;
  activeOrganizationId?: string | null;
  expiresAt?: string | number | Date;
};

export type ACCESS = OrganizationAccess;

export const SITE_ADMIN_ACCESS: ACCESS = {
  ...SITE_ADMIN_ORGANIZATION_ACCESS,
};

export const ADMIN_ACCESS: ACCESS = {
  ...ADMIN_ORGANIZATION_ACCESS,
};

export const EDIT_ACCESS: ACCESS = {
  ...EDIT_ORGANIZATION_ACCESS,
};

export const VIEW_ACCESS: ACCESS = {
  ...VIEW_ORGANIZATION_ACCESS,
};

export const NO_ACCESS: ACCESS = {
  ...NO_ORGANIZATION_ACCESS,
};

export type CurrentUser = Doc<'users'> & {
  activeOrganizationId: string | null;
  authUserId: string;
  authUser: BetterAuthUserWithRole;
  isSiteAdmin: boolean;
};

function requiresVerifiedEmail(authUser: BetterAuthUserWithRole): boolean {
  return isEmailVerificationRequiredForUser({
    createdAt: authUser.createdAt,
    emailVerified: authUser.emailVerified,
    enforcedAt: getEmailVerificationEnforcedAt(),
  });
}

function toMillis(value: string | number | Date | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getCurrentAuthSessionOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthSession | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.sessionId) {
    return null;
  }

  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'session',
    where: [
      {
        field: '_id',
        operator: 'eq',
        value: String(identity.sessionId),
      },
      {
        field: 'expiresAt',
        operator: 'gt',
        value: Date.now(),
      },
    ],
  })) as BetterAuthSession | null;
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

export async function getVerifiedCurrentAuthUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthUserWithRole | null> {
  const authUser = await getCurrentAuthUserOrNull(ctx);
  if (!authUser) {
    return null;
  }

  return requiresVerifiedEmail(authUser) ? null : authUser;
}

async function findAppUserByAuthUserId(ctx: QueryCtx | MutationCtx, authUserId: string) {
  return await ctx.db
    .query('users')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
    .first();
}

async function resolveActiveOrganizationIdForUser(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
  session?: BetterAuthSession | null,
): Promise<string | null> {
  if (typeof session?.activeOrganizationId === 'string' && session.activeOrganizationId.length > 0) {
    return session.activeOrganizationId;
  }

  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  if (memberships.length === 0) {
    return null;
  }

  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const organizationsById = new Set(
    organizations.map((organization) => organization._id ?? organization.id).filter(Boolean),
  );

  for (const membership of memberships) {
    if (organizationsById.has(membership.organizationId)) {
      return membership.organizationId;
    }
  }

  return null;
}

export async function getCurrentUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<CurrentUser | null> {
  const authUser = await getCurrentAuthUserOrNull(ctx);
  if (!authUser) {
    return null;
  }

  const authUserId = assertUserId(authUser, 'User ID not found in auth user');
  const [session, user] = await Promise.all([
    getCurrentAuthSessionOrNull(ctx),
    findAppUserByAuthUserId(ctx, authUserId),
  ]);
  if (!user) {
    return null;
  }

  const activeOrganizationId = await resolveActiveOrganizationIdForUser(ctx, authUserId, session);

  return {
    ...user,
    activeOrganizationId,
    authUserId,
    authUser,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role)),
  };
}

export async function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx): Promise<CurrentUser> {
  const authUser = await getCurrentAuthUserOrThrow(ctx);
  const authUserId = assertUserId(authUser, 'User ID not found in auth user');
  const [session, user] = await Promise.all([
    getCurrentAuthSessionOrNull(ctx),
    findAppUserByAuthUserId(ctx, authUserId),
  ]);
  if (!user) {
    throwConvexError('UNAUTHENTICATED', 'User context not initialized');
  }

  const activeOrganizationId = await resolveActiveOrganizationIdForUser(ctx, authUserId, session);

  return {
    ...user,
    activeOrganizationId,
    authUserId,
    authUser,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role)),
  };
}

export async function getVerifiedCurrentUserOrThrow(
  ctx: QueryCtx | MutationCtx,
): Promise<CurrentUser> {
  const user = await getCurrentUserOrThrow(ctx);
  if (requiresVerifiedEmail(user.authUser)) {
    throwConvexError('FORBIDDEN', 'Email verification required');
  }

  return user;
}

export async function getCurrentOrganizationOrNull(
  ctx: QueryCtx | MutationCtx,
  user?: CurrentUser,
) {
  const resolvedUser = user ?? (await getCurrentUserOrNull(ctx));
  if (!resolvedUser) {
    return null;
  }

  if (!resolvedUser.activeOrganizationId) {
    return null;
  }

  return await findBetterAuthOrganizationById(ctx, resolvedUser.activeOrganizationId);
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

  return getOrganizationAccess(
    membership.role === 'owner' || membership.role === 'admin' || membership.role === 'member'
      ? membership.role
      : null,
  );
}

export type CurrentUserProfile = {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  role: 'user' | 'admin';
  isSiteAdmin: boolean;
  emailVerified: boolean;
  requiresEmailVerification: boolean;
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
  const organizationsById = new Map(
    organizations.map((organization) => [organization._id ?? '', organization]),
  );

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
    .filter(
      (organization): organization is NonNullable<typeof organization> => organization !== null,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function buildCurrentUserProfile(
  ctx: QueryCtx | MutationCtx,
  user: CurrentUser,
): Promise<CurrentUserProfile> {
  const role = normalizeUserRole(user.authUser.role);
  const createdAt = toMillis(user.authUser.createdAt);
  const emailVerified = user.authUser.emailVerified ?? false;
  const organizations = await resolveOrganizationsForUser(ctx, user.authUserId);
  const currentOrganization = user.activeOrganizationId
    ? organizations.find((organization) => organization.id === user.activeOrganizationId) ?? null
    : null;

  return {
    id: user.authUserId,
    email: user.authUser.email ?? '',
    name: user.authUser.name ?? null,
    phoneNumber: user.authUser.phoneNumber ?? null,
    role,
    isSiteAdmin: deriveIsSiteAdmin(role),
    emailVerified,
    requiresEmailVerification: isEmailVerificationRequiredForUser({
      createdAt,
      emailVerified,
      enforcedAt: getEmailVerificationEnforcedAt(),
    }),
    createdAt,
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
