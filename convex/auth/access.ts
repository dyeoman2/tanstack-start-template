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
import { getRecentStepUpWindowMs } from '../../src/lib/server/security-config.server';
import {
  type AuthAssuranceState,
  evaluateAuthPolicy,
  evaluateStepUpClaim,
  STEP_UP_REQUIREMENTS,
  type StepUpRequirement,
} from '../../src/lib/shared/auth-policy';
import { isEmailVerificationRequiredForUser } from '../../src/lib/shared/email-verification';
import { assertUserId } from '../../src/lib/shared/user-id';
import { components, internal } from '../_generated/api';
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
import {
  type OrganizationEnterpriseSatisfactionPath,
  resolveOrganizationEnterpriseAccess,
} from '../lib/enterpriseAccess';
import {
  type OrganizationPermission,
  organizationPermissionValidator,
  requiresEnterpriseSatisfied,
} from '../lib/organizationPermissions';
import { organizationPermissionDecisionValidator } from '../lib/returnValidators';
import { getActiveStepUpClaim, getCompatibilityStepUpClaim } from '../stepUp';
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

type OrganizationPoliciesForAuthorization = {
  allowBreakGlassPasswordLogin: boolean;
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  enterpriseProviderKey: 'google-workspace' | 'entra' | 'okta' | null;
};

type AuthorizationAssurance = {
  emailVerified: boolean;
  enterpriseSatisfied: boolean;
  enterpriseSatisfactionPath: OrganizationEnterpriseSatisfactionPath | null;
  enterpriseStatus:
    | 'not_required'
    | 'satisfied'
    | 'missing_enterprise_session'
    | 'unmanaged_email_domain'
    | 'support_grant_required'
    | 'support_grant_expired';
  mfaSatisfied: boolean;
  recentStepUpSatisfied: boolean;
  supportGrantId: Doc<'organizationSupportAccessGrants'>['_id'] | null;
  supportGrantScope: 'read_only' | 'read_write' | null;
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
      supportGrantId: null;
      supportGrantScope: null;
    }
  | {
      allowed: true;
      organizationId: string | null;
      permission: OrganizationPermission | null;
      reason: null;
      supportGrantId: Doc<'organizationSupportAccessGrants'>['_id'] | null;
      supportGrantScope: 'read_only' | 'read_write' | null;
    };

function serializeOrganizationPermissionDecision(decision: OrganizationPermissionDecision) {
  const authSession = decision.user.authSession
    ? {
        id: decision.user.authSession.id,
        expiresAt: decision.user.authSession.expiresAt,
        createdAt: decision.user.authSession.createdAt,
        updatedAt: decision.user.authSession.updatedAt,
        impersonatedBy: decision.user.authSession.impersonatedBy,
        activeOrganizationId: decision.user.authSession.activeOrganizationId,
        authMethod: decision.user.authSession.authMethod,
        enterpriseOrganizationId: decision.user.authSession.enterpriseOrganizationId,
        enterpriseProviderKey: decision.user.authSession.enterpriseProviderKey,
        enterpriseProtocol: decision.user.authSession.enterpriseProtocol,
      }
    : null;

  return {
    ...decision,
    membership: decision.membership
      ? {
          ...decision.membership,
          createdAt: toMillis(decision.membership.createdAt),
        }
      : null,
    user: {
      ...decision.user,
      authSession,
    },
  };
}

function getPermissionStepUpRequirement(
  permission: OrganizationPermission,
): StepUpRequirement | null {
  switch (permission) {
    case 'manageDomains':
      return STEP_UP_REQUIREMENTS.organizationAdmin;
    case 'manageMembers':
      return STEP_UP_REQUIREMENTS.organizationAdmin;
    case 'managePolicies':
      return STEP_UP_REQUIREMENTS.organizationAdmin;
    case 'exportAudit':
      return STEP_UP_REQUIREMENTS.auditExport;
    case 'manageEvidence':
      return STEP_UP_REQUIREMENTS.organizationAdmin;
    case 'issueAttachmentAccessUrl':
      return STEP_UP_REQUIREMENTS.attachmentAccess;
    default:
      return null;
  }
}

async function resolveChatAttachmentStorageAccess(
  ctx: QueryCtx,
  args: {
    organizationId: string | null;
    storageId: string;
    user: CurrentUser;
  },
): Promise<StorageReadAccessResult> {
  const attachment = await ctx.db
    .query('chatAttachments')
    .withIndex('by_storageId', (query) => query.eq('storageId', args.storageId))
    .unique();

  if (!attachment || attachment.deletedAt) {
    return {
      allowed: false,
      organizationId: args.organizationId,
      permission: 'issueAttachmentAccessUrl' as const,
      reason: 'Attachment not found',
      supportGrantId: null,
      supportGrantScope: null,
    };
  }

  const decision = await buildOrganizationPermissionDecision(ctx, {
    organizationId: args.organizationId ?? attachment.organizationId,
    permission: 'issueAttachmentAccessUrl',
  });
  if ('code' in decision) {
    return {
      allowed: false,
      organizationId: args.organizationId ?? attachment.organizationId,
      permission: 'issueAttachmentAccessUrl' as const,
      reason: decision.reason,
      supportGrantId: null,
      supportGrantScope: null,
    };
  }

  if (!args.user.isSiteAdmin && attachment.userId !== args.user.authUserId) {
    return {
      allowed: false,
      organizationId: args.organizationId ?? attachment.organizationId,
      permission: 'issueAttachmentAccessUrl' as const,
      reason: 'Attachment access denied',
      supportGrantId: null,
      supportGrantScope: null,
    };
  }

  return {
    allowed: true,
    organizationId: args.organizationId ?? attachment.organizationId,
    permission: 'issueAttachmentAccessUrl' as const,
    reason: null,
    supportGrantId: decision.assurance.supportGrantId,
    supportGrantScope: decision.assurance.supportGrantScope,
  };
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
  mfaEnabled: boolean;
  recentStepUpAt: number | null;
}): AuthAssuranceState {
  return {
    emailVerified: input.authUser.emailVerified ?? false,
    mfaEnabled: input.mfaEnabled,
    recentStepUpAt: input.recentStepUpAt,
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
  const user = (await ctx.runQuery(
    internal.users.getCurrentAppUserInternal,
    {},
  )) as CurrentUser | null;
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
  const sessionId = user.authSession?.id;
  if (!sessionId) {
    throwConvexError('FORBIDDEN', `Step-up authentication is required (${requirement})`);
  }

  const activeClaim = await ctx.runQuery(internal.stepUp.getActiveClaimInternal, {
    authUserId: user.authUserId,
    requirement,
    sessionId,
  });

  if (
    !evaluateStepUpClaim({
      claim: activeClaim
        ? {
            consumedAt: activeClaim.consumedAt,
            expiresAt: activeClaim.expiresAt,
            method: activeClaim.method,
            requirement: activeClaim.requirement,
            sessionId: activeClaim.sessionId,
            verifiedAt: activeClaim.verifiedAt,
          }
        : null,
      requirement,
      sessionId,
    }).satisfied
  ) {
    throwConvexError('FORBIDDEN', `Step-up authentication is required (${requirement})`);
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
  const compatibilityClaim =
    user.authSession?.id && 'db' in ctx
      ? await getCompatibilityStepUpClaim(ctx as QueryCtx | MutationCtx, {
          authUserId: user.authUserId,
          sessionId: user.authSession.id,
        })
      : null;

  return buildAuthAssuranceState({
    authUser: user.authUser,
    mfaEnabled: user.authUser.twoFactorEnabled === true || passkeyCount > 0,
    recentStepUpAt: compatibilityClaim?.verifiedAt ?? null,
  });
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
  const stepUpRequirement = getPermissionStepUpRequirement(input.permission);
  const stepUpClaim =
    stepUpRequirement && user.authSession?.id
      ? await getActiveStepUpClaim(ctx, {
          authUserId: user.authUserId,
          requirement: stepUpRequirement,
          sessionId: user.authSession.id,
        })
      : null;
  const authPolicy = evaluateAuthPolicy({
    assurance: assuranceState,
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
  });
  const stepUpEvaluation = evaluateStepUpClaim({
    claim: stepUpClaim
      ? {
          consumedAt: stepUpClaim.consumedAt,
          expiresAt: stepUpClaim.expiresAt,
          method: stepUpClaim.method,
          requirement: stepUpClaim.requirement,
          sessionId: stepUpClaim.sessionId,
          verifiedAt: stepUpClaim.verifiedAt,
        }
      : null,
    requirement: stepUpRequirement,
    sessionId: user.authSession?.id ?? null,
  });
  const policies = await getOrganizationPoliciesForAuthorization(ctx, organizationId);
  const enterpriseAccess = await resolveOrganizationEnterpriseAccess(ctx, {
    membership,
    organizationId,
    permission: input.permission,
    policies,
    user,
  });

  const decision: OrganizationPermissionDecision = {
    assurance: {
      emailVerified: assuranceState.emailVerified,
      enterpriseSatisfied: enterpriseAccess.allowed,
      enterpriseSatisfactionPath: enterpriseAccess.satisfactionPath,
      enterpriseStatus: enterpriseAccess.status,
      mfaSatisfied: !authPolicy.requiresMfaSetup,
      recentStepUpSatisfied: stepUpEvaluation.required ? stepUpEvaluation.satisfied : true,
      supportGrantId: enterpriseAccess.supportGrant?.id ?? null,
      supportGrantScope: enterpriseAccess.supportGrant?.scope ?? null,
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
    if (requiresEnterpriseSatisfied(input.permission) && !decision.assurance.enterpriseSatisfied) {
      return {
        code: 'FORBIDDEN',
        reason: enterpriseAccess.reason ?? 'This organization requires enterprise sign-in',
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
      reason: enterpriseAccess.reason ?? 'This organization requires enterprise sign-in',
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
  await ctx.runMutation(anyApi.audit.appendAuditLedgerEventInternal, {
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

async function recordEnterpriseBreakGlassUsed(
  ctx: MutationCtx | ActionCtx,
  input: {
    decision: OrganizationPermissionDecision;
    sourceSurface?: string;
  },
) {
  if (input.decision.assurance.enterpriseSatisfactionPath !== 'owner_break_glass') {
    return;
  }

  await ctx.runMutation(anyApi.audit.appendAuditLedgerEventInternal, {
    eventType: 'enterprise_break_glass_used',
    userId: input.decision.user.authUserId,
    actorUserId: input.decision.user.authUserId,
    organizationId: input.decision.organizationId,
    identifier: input.decision.user.authUser.email?.toLowerCase(),
    sessionId: input.decision.user.authSession?.id ?? undefined,
    outcome: 'success',
    severity: 'warning',
    resourceType: 'organization_permission',
    resourceId: input.decision.organizationId,
    resourceLabel: input.decision.permission,
    sourceSurface: input.sourceSurface ?? 'auth.authorization',
    metadata: JSON.stringify({
      permission: input.decision.permission,
      satisfactionPath: 'owner_break_glass',
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
  const compatibilityClaim = user.authSession?.id
    ? await getCompatibilityStepUpClaim(ctx, {
        authUserId: user.authUserId,
        sessionId: user.authSession.id,
      })
    : null;
  const authPolicy = evaluateAuthPolicy({
    assurance: buildAuthAssuranceState({
      authUser: user.authUser,
      mfaEnabled,
      recentStepUpAt: compatibilityClaim?.verifiedAt ?? null,
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
    }),
    createdAt,
    updatedAt: toMillis(user.authUser.updatedAt),
    mfaEnabled,
    mfaRequired: true,
    requiresMfaSetup: authPolicy.requiresMfaSetup,
    recentStepUpAt: compatibilityClaim?.verifiedAt ?? null,
    recentStepUpValidUntil: compatibilityClaim?.expiresAt ?? null,
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

  if ('runMutation' in ctx) {
    await recordEnterpriseBreakGlassUsed(ctx, {
      decision: result,
      sourceSurface: input.sourceSurface,
    });
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

  await recordEnterpriseBreakGlassUsed(ctx, {
    decision: result.decision,
    sourceSurface: input.sourceSurface,
  });

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
      decision: organizationPermissionDecisionValidator,
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
      decision: serializeOrganizationPermissionDecision(result),
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
      decision: organizationPermissionDecisionValidator,
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
      decision: serializeOrganizationPermissionDecision(result),
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
    permission: v.union(organizationPermissionValidator, v.null()),
    reason: v.union(v.string(), v.null()),
    supportGrantId: v.union(v.id('organizationSupportAccessGrants'), v.null()),
    supportGrantScope: v.union(v.literal('read_only'), v.literal('read_write'), v.null()),
  }),
  handler: async (ctx, args): Promise<StorageReadAccessResult> => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    const resolveLifecycleAccess = async (
      storageId: string,
      visited = new Set<string>(),
    ): Promise<StorageReadAccessResult> => {
      if (visited.has(storageId)) {
        return {
          allowed: false,
          organizationId: user.activeOrganizationId,
          permission: null,
          reason: 'Stored file access lineage is invalid',
          supportGrantId: null,
          supportGrantScope: null,
        };
      }
      visited.add(storageId);

      const lifecycle = await ctx.db
        .query('storageLifecycle')
        .withIndex('by_storageId', (query) => query.eq('storageId', storageId))
        .first();

      if (!lifecycle) {
        return {
          allowed: false,
          organizationId: null,
          permission: null,
          reason: 'Stored file not found',
          supportGrantId: null,
          supportGrantScope: null,
        };
      }

      if (lifecycle.parentStorageId) {
        return await resolveLifecycleAccess(lifecycle.parentStorageId, visited);
      }

      if (lifecycle.sourceType === 'chat_attachment') {
        return await resolveChatAttachmentStorageAccess(ctx, {
          organizationId: lifecycle.organizationId ?? null,
          storageId: lifecycle.storageId,
          user,
        });
      }

      if (lifecycle.sourceType === 'security_control_evidence') {
        const assurance = await resolveUserAuthAssuranceState(ctx, user);
        const evidenceClaim = user.authSession?.id
          ? await getActiveStepUpClaim(ctx, {
              authUserId: user.authUserId,
              requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
              sessionId: user.authSession.id,
            })
          : null;
        const authPolicy = evaluateAuthPolicy({
          assurance,
          recentStepUpWindowMs: getRecentStepUpWindowMs(),
        });
        const evidenceStepUp = evaluateStepUpClaim({
          claim: evidenceClaim
            ? {
                consumedAt: evidenceClaim.consumedAt,
                expiresAt: evidenceClaim.expiresAt,
                method: evidenceClaim.method,
                requirement: evidenceClaim.requirement,
                sessionId: evidenceClaim.sessionId,
                verifiedAt: evidenceClaim.verifiedAt,
              }
            : null,
          requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
          sessionId: user.authSession?.id ?? null,
        });

        if (!user.isSiteAdmin) {
          return {
            allowed: false,
            organizationId: lifecycle.organizationId ?? user.activeOrganizationId,
            permission: 'manageEvidence' as const,
            reason: 'Site admin access required',
            supportGrantId: null,
            supportGrantScope: null,
          };
        }

        if (authPolicy.requiresMfaSetup) {
          return {
            allowed: false,
            organizationId: lifecycle.organizationId ?? user.activeOrganizationId,
            permission: 'manageEvidence' as const,
            reason: 'Multi-factor authentication is required for site admin access',
            supportGrantId: null,
            supportGrantScope: null,
          };
        }

        if (!evidenceStepUp.satisfied) {
          return {
            allowed: false,
            organizationId: lifecycle.organizationId ?? user.activeOrganizationId,
            permission: 'manageEvidence' as const,
            reason: 'Step-up authentication is required',
            supportGrantId: null,
            supportGrantScope: null,
          };
        }

        return {
          allowed: true,
          organizationId: lifecycle.organizationId ?? user.activeOrganizationId,
          permission: 'manageEvidence' as const,
          reason: null,
          supportGrantId: null,
          supportGrantScope: null,
        };
      }

      return {
        allowed: false,
        organizationId: lifecycle.organizationId ?? user.activeOrganizationId,
        permission: null,
        reason: 'Stored file access is not available for this resource type',
        supportGrantId: null,
        supportGrantScope: null,
      };
    };

    return await resolveLifecycleAccess(args.storageId);
  },
});
