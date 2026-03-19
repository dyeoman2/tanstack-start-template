import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';
import {
  ADMIN_ORGANIZATION_ACCESS,
  canManageDomains,
  canManageOrganization,
  canManageOrganizationPolicies,
  canViewOrganizationAudit,
  deriveViewerRole,
  getOrganizationAccess,
  NO_ORGANIZATION_ACCESS,
  type OrganizationAccess,
  type OrganizationViewerRole,
  SITE_ADMIN_ORGANIZATION_ACCESS,
  VIEW_ORGANIZATION_ACCESS,
} from '../../src/features/organizations/lib/organization-permissions';
import { getEmailVerificationEnforcedAt } from '../../src/lib/server/env.server';
import { getRecentStepUpWindowMs } from '../../src/lib/server/security-config.server';
import {
  type AuthAssuranceState,
  buildStepUpRedirectSearch,
  evaluateAuthPolicy,
  evaluateFreshSession,
  STEP_UP_REQUIREMENTS,
  type StepUpRequirement,
} from '../../src/lib/shared/auth-policy';
import { isEmailVerificationRequiredForUser } from '../../src/lib/shared/email-verification';
import { assertUserId } from '../../src/lib/shared/user-id';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import { authComponent, type BetterAuthSessionData, type BetterAuthSessionUser } from '../auth';
import type { Doc as BetterAuthDoc } from '../betterAuth/_generated/dataModel';
import {
  type BetterAuthMember,
  fetchBetterAuthMembersByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
  findBetterAuthOrganizationBySlug,
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

export const ORGANIZATION_PERMISSION_VALUES = [
  'viewOrganization',
  'manageMembers',
  'manageDomains',
  'managePolicies',
  'viewAudit',
  'exportAudit',
  'manageEvidence',
  'readThread',
  'writeThread',
  'readAttachment',
  'deleteAttachment',
  'issueAttachmentAccessUrl',
] as const;

export type OrganizationPermission = (typeof ORGANIZATION_PERMISSION_VALUES)[number];

type OrganizationPoliciesForAuthorization = {
  allowBreakGlassPasswordLogin: boolean;
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  enterpriseProviderKey: 'google-workspace' | 'entra' | 'okta' | null;
};

type AuthorizationAssurance = {
  emailVerified: boolean;
  enterpriseSatisfied: boolean;
  mfaSatisfied: boolean;
  recentStepUpSatisfied: boolean;
};

export type OrganizationPermissionDecision = {
  assurance: AuthorizationAssurance;
  membership: BetterAuthMember | null;
  membershipStatus: 'active' | 'deactivated' | 'suspended' | null;
  organizationId: string;
  organizationSlug: string | null;
  permission: OrganizationPermission;
  user: CurrentUser;
  viewerRole: OrganizationViewerRole;
};

type AuthorizationFailure = {
  code: 'FORBIDDEN' | 'NOT_FOUND';
  reason: string;
};

type StorageReadAccessResult =
  | {
      allowed: false;
      organizationId: string | null;
      permission: OrganizationPermission | null;
      reason: string;
    }
  | {
      allowed: true;
      organizationId: string | null;
      permission: OrganizationPermission | null;
      reason: null;
    };

const organizationPermissionValidator = v.union(
  ...ORGANIZATION_PERMISSION_VALUES.map((permission) => v.literal(permission)),
);

function getPermissionStepUpRequirement(
  permission: OrganizationPermission,
): StepUpRequirement | null {
  switch (permission) {
    case 'managePolicies':
      return STEP_UP_REQUIREMENTS.organizationAdmin;
    case 'exportAudit':
      return STEP_UP_REQUIREMENTS.auditExport;
    case 'manageEvidence':
      return STEP_UP_REQUIREMENTS.auditExport;
    case 'issueAttachmentAccessUrl':
      return STEP_UP_REQUIREMENTS.attachmentAccess;
    default:
      return null;
  }
}

function requiresEnterpriseSatisfied(permission: OrganizationPermission) {
  switch (permission) {
    case 'manageDomains':
    case 'managePolicies':
    case 'viewAudit':
    case 'exportAudit':
      return true;
    default:
      return false;
  }
}

function canSiteAdminPerform(permission: OrganizationPermission) {
  switch (permission) {
    case 'viewOrganization':
    case 'manageMembers':
    case 'manageDomains':
    case 'managePolicies':
    case 'viewAudit':
    case 'exportAudit':
    case 'manageEvidence':
    case 'readThread':
    case 'writeThread':
    case 'readAttachment':
    case 'deleteAttachment':
    case 'issueAttachmentAccessUrl':
      return true;
  }
}

function isViewerRoleAllowed(
  permission: OrganizationPermission,
  viewerRole: OrganizationViewerRole,
) {
  switch (permission) {
    case 'viewOrganization':
      return viewerRole !== null;
    case 'manageMembers':
      return canManageOrganization(viewerRole);
    case 'manageDomains':
      return canManageDomains(viewerRole);
    case 'managePolicies':
      return canManageOrganizationPolicies(viewerRole);
    case 'viewAudit':
    case 'exportAudit':
      return canViewOrganizationAudit(viewerRole);
    case 'manageEvidence':
      return false;
    default:
      return viewerRole !== null;
  }
}

async function getOrganizationPoliciesForAuthorization(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<OrganizationPoliciesForAuthorization> {
  const policy = await ctx.db
    .query('organizationPolicies')
    .withIndex('by_organization_id', (query) => query.eq('organizationId', organizationId))
    .first();

  return {
    allowBreakGlassPasswordLogin: policy?.allowBreakGlassPasswordLogin ?? false,
    enterpriseAuthMode: policy?.enterpriseAuthMode ?? 'off',
    enterpriseProviderKey: policy?.enterpriseProviderKey ?? null,
  };
}

async function getVerifiedDomainsForAuthorization(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
) {
  const domains = await ctx.db
    .query('organizationDomains')
    .withIndex('by_organization_id', (query) => query.eq('organizationId', organizationId))
    .collect();

  return domains
    .filter((domain) => domain.status === 'verified')
    .map((domain) => domain.normalizedDomain);
}

function normalizeEmailDomain(email: string | undefined | null) {
  if (!email) {
    return '';
  }

  const [, domain = ''] = email.trim().toLowerCase().split('@');
  return domain;
}

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
  if (!identity?.sessionId || typeof identity.sessionId !== 'string') {
    return null;
  }

  return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'session',
    where: [
      {
        field: '_id',
        operator: 'eq',
        value: identity.sessionId,
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
  const user = ensureCurrentUserIsSiteAdminOrThrow(
    await getVerifiedCurrentUserFromActionOrThrow(ctx),
  );
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

async function countPasskeysForUser(ctx: QueryCtx | MutationCtx | ActionCtx, authUserId: string) {
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

async function evaluateEnterpriseAuthorization(
  ctx: QueryCtx | MutationCtx,
  input: {
    membership: BetterAuthMember | null;
    organizationId: string;
    user: CurrentUser;
  },
) {
  const policies = await getOrganizationPoliciesForAuthorization(ctx, input.organizationId);
  if (policies.enterpriseAuthMode !== 'required') {
    return true;
  }

  if (input.user.isSiteAdmin) {
    return true;
  }

  const verifiedDomains = await getVerifiedDomainsForAuthorization(ctx, input.organizationId);
  const emailDomain = normalizeEmailDomain(input.user.authUser.email);
  const matchesManagedDomain = verifiedDomains.includes(emailDomain);
  if (!matchesManagedDomain) {
    return true;
  }

  if (policies.allowBreakGlassPasswordLogin && input.membership?.role === 'owner') {
    return true;
  }

  return (
    input.user.authSession?.authMethod === 'enterprise' &&
    input.user.authSession.enterpriseOrganizationId === input.organizationId &&
    input.user.authSession.enterpriseProviderKey === policies.enterpriseProviderKey
  );
}

async function buildOrganizationPermissionDecision(
  ctx: QueryCtx | MutationCtx,
  input: {
    organizationId?: string;
    organizationSlug?: string;
    permission: OrganizationPermission;
  },
): Promise<OrganizationPermissionDecision | AuthorizationFailure> {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const organization = input.organizationId
    ? await findBetterAuthOrganizationById(ctx, input.organizationId)
    : input.organizationSlug
      ? await findBetterAuthOrganizationBySlug(ctx, input.organizationSlug)
      : null;

  if (!organization) {
    return {
      code: 'NOT_FOUND',
      reason: 'Organization not found',
    };
  }

  const organizationId = organization._id ?? organization.id;
  if (!organizationId) {
    return {
      code: 'NOT_FOUND',
      reason: 'Organization not found',
    };
  }

  const membership = await findBetterAuthMember(ctx, organizationId, user.authUserId);
  const membershipStatus =
    membership === null ? null : await getOrganizationMembershipStatus(ctx, membership._id);
  const viewerRole = deriveViewerRole({
    isSiteAdmin: user.isSiteAdmin,
    membershipRole: membershipStatus === 'active' ? membership?.role : null,
  });

  const assuranceState = await resolveUserAuthAssuranceState(ctx, user);
  const authPolicy = evaluateAuthPolicy({
    assurance: assuranceState,
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
    requirement: getPermissionStepUpRequirement(input.permission),
  });
  const enterpriseSatisfied = await evaluateEnterpriseAuthorization(ctx, {
    membership,
    organizationId,
    user,
  });

  const decision: OrganizationPermissionDecision = {
    assurance: {
      emailVerified: assuranceState.emailVerified,
      enterpriseSatisfied,
      mfaSatisfied: !authPolicy.requiresMfaSetup,
      recentStepUpSatisfied: authPolicy.stepUp.required ? authPolicy.stepUp.satisfied : true,
    },
    membership,
    membershipStatus,
    organizationId,
    organizationSlug: organization.slug ?? null,
    permission: input.permission,
    user,
    viewerRole,
  };

  if (user.isSiteAdmin && canSiteAdminPerform(input.permission)) {
    if (!decision.assurance.mfaSatisfied) {
      return {
        code: 'FORBIDDEN',
        reason: 'Multi-factor authentication is required for site admin access',
      };
    }
    if (!decision.assurance.recentStepUpSatisfied) {
      return {
        code: 'FORBIDDEN',
        reason: 'Recent step-up authentication is required',
      };
    }
    return decision;
  }

  if (membership === null || membershipStatus !== 'active' || viewerRole === null) {
    return {
      code: 'FORBIDDEN',
      reason: 'You are not a member of this organization',
    };
  }

  if (!isViewerRoleAllowed(input.permission, viewerRole)) {
    return {
      code: 'FORBIDDEN',
      reason: 'You do not have access to this organization resource',
    };
  }

  if (requiresEnterpriseSatisfied(input.permission) && !decision.assurance.enterpriseSatisfied) {
    return {
      code: 'FORBIDDEN',
      reason: 'This organization requires enterprise sign-in',
    };
  }

  if (!decision.assurance.recentStepUpSatisfied) {
    return {
      code: 'FORBIDDEN',
      reason: 'Recent step-up authentication is required',
    };
  }

  return decision;
}

async function recordAuthorizationDenied(
  ctx: MutationCtx | ActionCtx,
  input: {
    organizationId?: string;
    permission: OrganizationPermission;
    reason: string;
    sourceSurface?: string;
    user: CurrentUser;
  },
) {
  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    eventType: 'authorization_denied',
    userId: input.user.authUserId,
    actorUserId: input.user.authUserId,
    organizationId: input.organizationId,
    identifier: input.user.authUser.email?.toLowerCase(),
    sessionId: input.user.authSession?.id ?? undefined,
    outcome: 'failure',
    severity: 'warning',
    resourceType: 'organization_permission',
    resourceId: input.organizationId,
    resourceLabel: input.permission,
    sourceSurface: input.sourceSurface ?? 'auth.authorization',
    metadata: JSON.stringify({
      permission: input.permission,
      reason: input.reason,
    }),
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

export async function requireOrganizationPermission(
  ctx: QueryCtx | MutationCtx,
  input: {
    organizationId?: string;
    organizationSlug?: string;
    permission: OrganizationPermission;
    sourceSurface?: string;
  },
): Promise<OrganizationPermissionDecision> {
  const result = await buildOrganizationPermissionDecision(ctx, input);
  if ('code' in result) {
    throwConvexError(result.code, result.reason);
  }

  return result;
}

export async function requireOrganizationPermissionFromActionOrThrow(
  ctx: ActionCtx,
  input: {
    organizationId?: string;
    organizationSlug?: string;
    permission: OrganizationPermission;
    sourceSurface?: string;
  },
): Promise<OrganizationPermissionDecision> {
  const result = (
    input.organizationId
      ? await ctx.runQuery(anyApi['auth/access'].resolveOrganizationPermissionById, {
          organizationId: input.organizationId,
          permission: input.permission,
        })
      : await ctx.runQuery(anyApi['auth/access'].resolveOrganizationPermissionBySlug, {
          organizationSlug: input.organizationSlug ?? '',
          permission: input.permission,
        })
  ) as
    | {
        allowed: false;
        organizationId: string | null;
        reason: string;
      }
    | {
        allowed: true;
        decision: OrganizationPermissionDecision;
      };

  if (result.allowed === false) {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    await recordAuthorizationDenied(ctx, {
      organizationId: result.organizationId ?? input.organizationId,
      permission: input.permission,
      reason: result.reason,
      sourceSurface: input.sourceSurface,
      user,
    });
    throwConvexError('FORBIDDEN', result.reason);
  }

  return result.decision;
}

export async function requireAttachmentPermission(
  ctx: QueryCtx | MutationCtx,
  input: {
    attachmentId: Doc<'chatAttachments'>['_id'];
    permission: Extract<
      OrganizationPermission,
      'deleteAttachment' | 'issueAttachmentAccessUrl' | 'readAttachment'
    >;
  },
) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const attachment = await ctx.db.get(input.attachmentId);
  if (!attachment || attachment.deletedAt) {
    throwConvexError('NOT_FOUND', 'Attachment not found');
  }

  const decision = await requireOrganizationPermission(ctx, {
    organizationId: attachment.organizationId,
    permission: input.permission === 'deleteAttachment' ? 'deleteAttachment' : 'readAttachment',
  });

  const isOwner = attachment.userId === user.authUserId;
  const canAccess = user.isSiteAdmin || isOwner;
  if (!canAccess) {
    throwConvexError('FORBIDDEN', 'Attachment access denied');
  }

  if (input.permission === 'issueAttachmentAccessUrl') {
    const attachmentDecision = await requireOrganizationPermission(ctx, {
      organizationId: attachment.organizationId,
      permission: 'issueAttachmentAccessUrl',
    });
    return {
      ...attachmentDecision,
      attachment,
    };
  }

  return {
    ...decision,
    attachment,
  };
}

export async function requireThreadPermission(
  ctx: QueryCtx | MutationCtx,
  input: {
    permission: Extract<OrganizationPermission, 'readThread' | 'writeThread'>;
    threadId: Doc<'chatThreads'>['_id'];
  },
) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const thread = await ctx.db.get(input.threadId);
  if (!thread || thread.deletedAt) {
    throwConvexError('NOT_FOUND', 'Thread not found');
  }

  const decision = await requireOrganizationPermission(ctx, {
    organizationId: thread.organizationId,
    permission: input.permission,
  });
  const isOwner = thread.ownerUserId === user.authUserId;
  const canAccess = user.isSiteAdmin || isOwner;
  if (!canAccess) {
    throwConvexError('FORBIDDEN', 'Thread access denied');
  }

  return {
    ...decision,
    thread,
  };
}

export async function requireStorageReadAccessFromActionOrThrow(
  ctx: ActionCtx,
  input: {
    sourceSurface?: string;
    storageId: string;
  },
) {
  const result = (await ctx.runQuery(anyApi['auth/access'].resolveStorageReadAccess, {
    storageId: input.storageId,
  })) as StorageReadAccessResult;

  if (!result.allowed) {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    await recordAuthorizationDenied(ctx, {
      organizationId: result.organizationId ?? user.activeOrganizationId ?? undefined,
      permission: result.permission ?? 'readAttachment',
      reason: result.reason,
      sourceSurface: input.sourceSurface ?? 'storage.read',
      user,
    });
    throwConvexError('FORBIDDEN', result.reason);
  }

  return result;
}

export const resolveOrganizationPermissionById = query({
  args: {
    organizationId: v.string(),
    permission: organizationPermissionValidator,
  },
  returns: v.union(
    v.object({
      allowed: v.literal(false),
      organizationId: v.union(v.string(), v.null()),
      reason: v.string(),
    }),
    v.object({
      allowed: v.literal(true),
      decision: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const result = await buildOrganizationPermissionDecision(ctx, args);
    if ('code' in result) {
      return {
        allowed: false as const,
        organizationId: args.organizationId,
        reason: result.reason,
      };
    }
    return {
      allowed: true as const,
      decision: result,
    };
  },
});

export const resolveOrganizationPermissionBySlug = query({
  args: {
    organizationSlug: v.string(),
    permission: organizationPermissionValidator,
  },
  returns: v.union(
    v.object({
      allowed: v.literal(false),
      organizationId: v.union(v.string(), v.null()),
      reason: v.string(),
    }),
    v.object({
      allowed: v.literal(true),
      decision: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const result = await buildOrganizationPermissionDecision(ctx, {
      organizationSlug: args.organizationSlug,
      permission: args.permission,
    });
    if ('code' in result) {
      return {
        allowed: false as const,
        organizationId: null,
        reason: result.reason,
      };
    }
    return {
      allowed: true as const,
      decision: result,
    };
  },
});

export const resolveStorageReadAccess = query({
  args: {
    storageId: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    organizationId: v.union(v.string(), v.null()),
    permission: v.union(v.string(), v.null()),
    reason: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    const lifecycle = await ctx.db
      .query('storageLifecycle')
      .withIndex('by_storageId', (query) => query.eq('storageId', args.storageId))
      .first();

    if (!lifecycle) {
      return {
        allowed: false,
        organizationId: null,
        permission: null,
        reason: 'Stored file not found',
      };
    }

    if (lifecycle.sourceType === 'chat_attachment') {
      const attachment = await ctx.db
        .query('chatAttachments')
        .withIndex('by_storageId', (query) => query.eq('storageId', args.storageId))
        .unique();
      if (!attachment || attachment.deletedAt) {
        return {
          allowed: false,
          organizationId: null,
          permission: 'issueAttachmentAccessUrl',
          reason: 'Attachment not found',
        };
      }

      const decision = await buildOrganizationPermissionDecision(ctx, {
        organizationId: attachment.organizationId,
        permission: 'issueAttachmentAccessUrl',
      });
      if ('code' in decision) {
        return {
          allowed: false,
          organizationId: attachment.organizationId,
          permission: 'issueAttachmentAccessUrl',
          reason: decision.reason,
        };
      }

      if (!user.isSiteAdmin && attachment.userId !== user.authUserId) {
        return {
          allowed: false,
          organizationId: attachment.organizationId,
          permission: 'issueAttachmentAccessUrl',
          reason: 'Attachment access denied',
        };
      }

      return {
        allowed: true,
        organizationId: attachment.organizationId,
        permission: 'issueAttachmentAccessUrl',
        reason: null,
      };
    }

    if (lifecycle.sourceType === 'security_control_evidence') {
      const assurance = await resolveUserAuthAssuranceState(ctx, user);
      const authPolicy = evaluateAuthPolicy({
        assurance,
        recentStepUpWindowMs: getRecentStepUpWindowMs(),
        requirement: getPermissionStepUpRequirement('manageEvidence'),
      });

      if (!user.isSiteAdmin) {
        return {
          allowed: false,
          organizationId: user.activeOrganizationId,
          permission: 'manageEvidence',
          reason: 'Site admin access required',
        };
      }

      if (authPolicy.requiresMfaSetup) {
        return {
          allowed: false,
          organizationId: user.activeOrganizationId,
          permission: 'manageEvidence',
          reason: 'Multi-factor authentication is required for site admin access',
        };
      }

      if (!authPolicy.stepUp.satisfied) {
        return {
          allowed: false,
          organizationId: user.activeOrganizationId,
          permission: 'manageEvidence',
          reason: 'Recent step-up authentication is required',
        };
      }

      return {
        allowed: true,
        organizationId: user.activeOrganizationId,
        permission: 'manageEvidence',
        reason: null,
      };
    }

    return {
      allowed: false,
      organizationId: user.activeOrganizationId,
      permission: null,
      reason: 'Stored file access is not available for this resource type',
    };
  },
});
