import { anyApi } from 'convex/server';
import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';
import {
  buildStepUpRedirectSearch,
  evaluateFreshSession,
  evaluateAuthPolicy,
  type AuthAssuranceState,
  STEP_UP_REQUIREMENTS,
  type StepUpRequirement,
} from '../../src/lib/shared/auth-policy';
import {
  ADMIN_ORGANIZATION_ACCESS,
  getOrganizationAccess,
  NO_ORGANIZATION_ACCESS,
  type OrganizationAccess,
  SITE_ADMIN_ORGANIZATION_ACCESS,
  VIEW_ORGANIZATION_ACCESS,
} from '../../src/features/organizations/lib/organization-permissions';
import { getEmailVerificationEnforcedAt } from '../../src/lib/server/env.server';
import { getRecentStepUpWindowMs } from '../../src/lib/server/security-config.server';
import { isEmailVerificationRequiredForUser } from '../../src/lib/shared/email-verification';
import { assertUserId } from '../../src/lib/shared/user-id';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { authComponent, type BetterAuthSessionData, type BetterAuthSessionUser } from '../auth';
import type { Doc as BetterAuthDoc } from '../betterAuth/_generated/dataModel';
import {
  type BetterAuthMember,
  fetchBetterAuthMembersByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
} from '../lib/betterAuth';
import {
  getOrganizationMembershipStatus,
  getOrganizationMembershipStatuses,
} from '../lib/organizationMembershipState';
import { throwConvexError } from './errors';

type AuthzCtx = QueryCtx | MutationCtx | ActionCtx;
type BetterAuthUserRecord = BetterAuthDoc<'user'> & Partial<BetterAuthSessionUser>;
type BetterAuthSessionRecord = BetterAuthDoc<'session'> & Partial<BetterAuthSessionData>;

export type ACCESS = OrganizationAccess;

export const SITE_ADMIN_ACCESS: ACCESS = {
  ...SITE_ADMIN_ORGANIZATION_ACCESS,
};

export const ADMIN_ACCESS: ACCESS = {
  ...ADMIN_ORGANIZATION_ACCESS,
};

export const EDIT_ACCESS: ACCESS = {
  ...ADMIN_ORGANIZATION_ACCESS,
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
  authSession: BetterAuthSessionRecord | null;
  authUser: BetterAuthUserRecord;
  isSiteAdmin: boolean;
};

function requiresVerifiedEmail(authUser: BetterAuthUserRecord): boolean {
  return isEmailVerificationRequiredForUser({
    createdAt: authUser.createdAt,
    emailVerified: authUser.emailVerified,
    enforcedAt: getEmailVerificationEnforcedAt(),
  });
}

function toMillis(value: string | number | Date | undefined, fallback: number = 0): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}

function buildAuthAssuranceState(input: {
  authUser: BetterAuthUserRecord;
  authSession: BetterAuthSessionRecord | null;
  mfaEnabled: boolean;
}): AuthAssuranceState {
  const recentStepUpAt =
    input.authSession === null
      ? null
      : toMillis(input.authSession.updatedAt ?? input.authSession.createdAt, 0) || null;

  return {
    emailVerified: input.authUser.emailVerified ?? false,
    mfaEnabled: input.mfaEnabled,
    recentStepUpAt,
  };
}

async function getCurrentAuthSessionOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthSessionRecord | null> {
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
  })) as BetterAuthSessionRecord | null;
}

export async function getCurrentAuthUserOrThrow(ctx: AuthzCtx): Promise<BetterAuthUserRecord> {
  const authUser = (await authComponent.getAuthUser(ctx)) as BetterAuthUserRecord | null;
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  return authUser;
}

export async function getCurrentAuthUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthUserRecord | null> {
  return (await authComponent.safeGetAuthUser(ctx)) as BetterAuthUserRecord | null;
}

export function ensureAuthUserIsSiteAdminOrThrow<T extends BetterAuthUserRecord>(authUser: T): T {
  if (!deriveIsSiteAdmin(normalizeUserRole(authUser.role ?? undefined))) {
    throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
  }

  return authUser;
}

export async function getCurrentSiteAdminAuthUserOrThrow(ctx: AuthzCtx) {
  return ensureAuthUserIsSiteAdminOrThrow(await getCurrentAuthUserOrThrow(ctx));
}

export async function getVerifiedCurrentAuthUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<BetterAuthUserRecord | null> {
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
  session?: BetterAuthSessionRecord | null,
): Promise<string | null> {
  if (
    typeof session?.activeOrganizationId !== 'string' ||
    session.activeOrganizationId.length === 0
  ) {
    return null;
  }

  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  const activeMembershipStatuses = await getOrganizationMembershipStatuses(
    ctx,
    memberships.map((membership) => membership._id),
  );
  if (
    !memberships.some(
      (membership) =>
        membership.organizationId === session.activeOrganizationId &&
        (activeMembershipStatuses.get(membership._id) ?? 'active') === 'active',
    )
  ) {
    return null;
  }

  const organization = await findBetterAuthOrganizationById(ctx, session.activeOrganizationId);
  return organization ? session.activeOrganizationId : null;
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
    authSession: session,
    authUser,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role ?? undefined)),
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
    authSession: session,
    authUser,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role ?? undefined)),
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

export async function getVerifiedCurrentUserFromActionOrThrow(
  ctx: ActionCtx,
): Promise<CurrentUser> {
  const user = (await ctx.runQuery(anyApi.users.getCurrentAppUser, {})) as CurrentUser | null;
  if (!user) {
    throwConvexError('UNAUTHENTICATED', 'User context not initialized');
  }

  if (requiresVerifiedEmail(user.authUser)) {
    throwConvexError('FORBIDDEN', 'Email verification required');
  }

  return user;
}

export async function requireRecentStepUpFromActionOrThrow(ctx: ActionCtx): Promise<CurrentUser> {
  return await requireStepUpFromActionOrThrow(ctx, STEP_UP_REQUIREMENTS.organizationAdmin);
}

export async function requireStepUpFromActionOrThrow(
  ctx: ActionCtx,
  requirement: StepUpRequirement,
): Promise<CurrentUser> {
  const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
  const sessionResult = (await ctx.runAction(anyApi.auth.getCurrentSessionServer, {})) as
    | {
        data: {
          session: {
            createdAt: number;
            updatedAt: number | null;
          } | null;
        } | null;
        ok: true;
      }
    | {
        error?: {
          message?: string;
        };
        ok?: false;
      };

  const freshSessionEvaluation =
    sessionResult && sessionResult.ok === true && sessionResult.data?.session
      ? evaluateFreshSession({
          createdAt: sessionResult.data.session.createdAt,
          updatedAt: sessionResult.data.session.updatedAt,
          recentStepUpWindowMs: getRecentStepUpWindowMs(),
          requirement,
        })
      : null;

  if (!freshSessionEvaluation?.satisfied) {
    const redirectSearch = buildStepUpRedirectSearch(requirement);
    throwConvexError(
      'FORBIDDEN',
      `Recent step-up authentication is required (${redirectSearch.requirement})`,
    );
  }

  return user;
}

export function ensureCurrentUserIsSiteAdminOrThrow<T extends CurrentUser>(user: T): T {
  if (!user.isSiteAdmin) {
    throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
  }

  return user;
}

async function ensureCurrentUserHasMfaForSiteAdminOrThrow(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  user: CurrentUser,
) {
  const authPolicy = evaluateAuthPolicy({
    assurance: await resolveUserAuthAssuranceState(ctx, user),
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
  });

  if (authPolicy.requiresMfaSetup) {
    throwConvexError('FORBIDDEN', 'Multi-factor authentication is required for site admin access');
  }

  return user;
}

export async function getVerifiedCurrentSiteAdminUserOrThrow(ctx: QueryCtx | MutationCtx) {
  const user = ensureCurrentUserIsSiteAdminOrThrow(await getVerifiedCurrentUserOrThrow(ctx));
  return await ensureCurrentUserHasMfaForSiteAdminOrThrow(ctx, user);
}

export async function getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx: ActionCtx) {
  const user = ensureCurrentUserIsSiteAdminOrThrow(await getVerifiedCurrentUserFromActionOrThrow(ctx));
  return await ensureCurrentUserHasMfaForSiteAdminOrThrow(ctx, user);
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

  const membershipStatus = await getOrganizationMembershipStatus(ctx, membership._id);
  if (membershipStatus !== 'active') {
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
  mfaEnabled: boolean;
  mfaRequired: boolean;
  requiresMfaSetup: boolean;
  recentStepUpAt: number | null;
  recentStepUpValidUntil: number | null;
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

async function countPasskeysForUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  authUserId: string,
) {
  const rawResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'passkey',
    where: [
      {
        field: 'userId',
        operator: 'eq',
        value: authUserId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: 1,
      id: 0,
    },
  });

  if (
    !rawResult ||
    typeof rawResult !== 'object' ||
    !('page' in rawResult) ||
    !Array.isArray(rawResult.page)
  ) {
    return 0;
  }

  return rawResult.page.length;
}

async function resolveUserAuthAssuranceState(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  user: Pick<CurrentUser, 'authUser' | 'authSession' | 'authUserId'>,
): Promise<AuthAssuranceState> {
  const passkeyCount =
    user.authUser.twoFactorEnabled === true ? 0 : await countPasskeysForUser(ctx, user.authUserId);

  return buildAuthAssuranceState({
    authUser: user.authUser,
    authSession: user.authSession,
    mfaEnabled: user.authUser.twoFactorEnabled === true || passkeyCount > 0,
  });
}

async function resolveOrganizationsForUser(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
): Promise<Array<{ id: string; name: string; role: string }>> {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  const membershipStatuses = await getOrganizationMembershipStatuses(
    ctx,
    memberships.map((membership) => membership._id),
  );
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
      if ((membershipStatuses.get(membership._id) ?? 'active') !== 'active') {
        return null;
      }

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
  const role = normalizeUserRole(user.authUser.role ?? undefined);
  const createdAt = toMillis(user.authUser.createdAt);
  const emailVerified = user.authUser.emailVerified ?? false;
  const [organizations, passkeyCount] = await Promise.all([
    resolveOrganizationsForUser(ctx, user.authUserId),
    countPasskeysForUser(ctx, user.authUserId),
  ]);
  const currentOrganization = user.activeOrganizationId
    ? (organizations.find((organization) => organization.id === user.activeOrganizationId) ?? null)
    : null;
  const mfaEnabled = user.authUser.twoFactorEnabled === true || passkeyCount > 0;
  const authPolicy = evaluateAuthPolicy({
    assurance: buildAuthAssuranceState({
      authUser: user.authUser,
      authSession: user.authSession,
      mfaEnabled,
    }),
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
  });

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
    mfaEnabled,
    mfaRequired: true,
    requiresMfaSetup: authPolicy.requiresMfaSetup,
    recentStepUpAt: authPolicy.stepUp.verifiedAt,
    recentStepUpValidUntil: authPolicy.stepUp.validUntil,
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
