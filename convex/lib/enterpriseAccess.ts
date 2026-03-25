import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  canOwnerUseBreakGlassForPermission,
  isEnterpriseDataPlanePermission,
  requiresEnterpriseSatisfied,
} from './organizationPermissions';

export {
  isEnterpriseDataPlanePermission,
  requiresEnterpriseSatisfied,
} from './organizationPermissions';

export const ORGANIZATION_SUPPORT_ACCESS_SCOPE_VALUES = ['read_only', 'read_write'] as const;
export type OrganizationSupportAccessScope =
  (typeof ORGANIZATION_SUPPORT_ACCESS_SCOPE_VALUES)[number];

export const organizationSupportAccessScopeValidator = v.union(
  v.literal('read_only'),
  v.literal('read_write'),
);

export const ORGANIZATION_ENTERPRISE_ACCESS_STATUS_VALUES = [
  'not_required',
  'satisfied',
  'missing_enterprise_session',
  'unmanaged_email_domain',
  'support_grant_required',
  'support_grant_expired',
] as const;
export type OrganizationEnterpriseAccessStatus =
  (typeof ORGANIZATION_ENTERPRISE_ACCESS_STATUS_VALUES)[number];

export const organizationEnterpriseAccessStatusValidator = v.union(
  v.literal('not_required'),
  v.literal('satisfied'),
  v.literal('missing_enterprise_session'),
  v.literal('unmanaged_email_domain'),
  v.literal('support_grant_required'),
  v.literal('support_grant_expired'),
);

export const ORGANIZATION_ENTERPRISE_SATISFACTION_PATH_VALUES = [
  'not_required',
  'enterprise_session',
  'owner_break_glass',
  'site_admin',
  'support_grant',
] as const;
export type OrganizationEnterpriseSatisfactionPath =
  (typeof ORGANIZATION_ENTERPRISE_SATISFACTION_PATH_VALUES)[number];

export const organizationEnterpriseSatisfactionPathValidator = v.union(
  v.literal('not_required'),
  v.literal('enterprise_session'),
  v.literal('owner_break_glass'),
  v.literal('site_admin'),
  v.literal('support_grant'),
);

type OrganizationPoliciesForEnterpriseAccess = {
  allowBreakGlassPasswordLogin: boolean;
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  enterpriseProviderKey: 'google-workspace' | 'entra' | 'okta' | null;
};

type EnterpriseAccessUser = {
  authSession: {
    authMethod?: string | null;
    enterpriseOrganizationId?: string | null;
    enterpriseProviderKey?: string | null;
  } | null;
  authUser: {
    email?: string | null;
  };
  authUserId: string;
  isSiteAdmin: boolean;
};

type EnterpriseAccessMembership = {
  role: string;
} | null;

export type OrganizationSupportAccessGrantSummary = {
  expiresAt: number;
  id: Id<'organizationSupportAccessGrants'>;
  reason: string;
  scope: OrganizationSupportAccessScope;
};

export type OrganizationEnterpriseAccessResult = {
  allowed: boolean;
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  providerKey: 'google-workspace' | 'entra' | 'okta' | null;
  reason: string | null;
  requiresEnterpriseAuth: boolean;
  satisfactionPath: OrganizationEnterpriseSatisfactionPath | null;
  status: OrganizationEnterpriseAccessStatus;
  supportGrant: OrganizationSupportAccessGrantSummary | null;
};

type ResolveOrganizationEnterpriseAccessInput = {
  membership: EnterpriseAccessMembership;
  organizationId: string;
  permission?: string | null;
  policies: OrganizationPoliciesForEnterpriseAccess;
  user: EnterpriseAccessUser;
};

function normalizeEmailDomain(email: string | undefined | null) {
  if (!email) {
    return '';
  }

  const [, domain = ''] = email.trim().toLowerCase().split('@');
  return domain;
}

export function doesSupportGrantCoverPermission(
  scope: OrganizationSupportAccessScope,
  permission?: string | null,
) {
  if (!permission || !isEnterpriseDataPlanePermission(permission)) {
    return false;
  }

  if (scope === 'read_write') {
    return true;
  }

  return permission !== 'writeThread' && permission !== 'deleteAttachment';
}

export function getEnterpriseAccessReason(status: OrganizationEnterpriseAccessStatus) {
  switch (status) {
    case 'missing_enterprise_session':
      return 'This organization requires enterprise sign-in';
    case 'unmanaged_email_domain':
      return 'Use a verified organization email domain to access this organization';
    case 'support_grant_required':
      return 'Organization owner approval is required before provider support can access tenant data';
    case 'support_grant_expired':
      return 'Your temporary support access grant has expired';
    default:
      return null;
  }
}

export function buildEnterpriseAccessResult(input: {
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  providerKey: 'google-workspace' | 'entra' | 'okta' | null;
  satisfactionPath?: OrganizationEnterpriseSatisfactionPath | null;
  status: OrganizationEnterpriseAccessStatus;
  supportGrant?: OrganizationSupportAccessGrantSummary | null;
}): OrganizationEnterpriseAccessResult {
  const requiresEnterpriseAuth =
    input.enterpriseAuthMode === 'required' && input.status !== 'not_required';

  return {
    allowed: input.status === 'not_required' || input.status === 'satisfied',
    enterpriseAuthMode: input.enterpriseAuthMode,
    providerKey: input.providerKey,
    reason: getEnterpriseAccessReason(input.status),
    requiresEnterpriseAuth,
    satisfactionPath: input.satisfactionPath ?? null,
    status: input.status,
    supportGrant: input.supportGrant ?? null,
  };
}

async function getVerifiedOrganizationDomains(ctx: QueryCtx | MutationCtx, organizationId: string) {
  const domains = await ctx.db
    .query('organizationDomains')
    .withIndex('by_organization_id', (query) => query.eq('organizationId', organizationId))
    .collect();

  return domains
    .filter((domain) => domain.status === 'verified')
    .map((domain) => domain.normalizedDomain);
}

async function resolveSupportGrantState(
  ctx: QueryCtx | MutationCtx,
  input: {
    organizationId: string;
    permission?: string | null;
    siteAdminUserId: string;
  },
): Promise<{
  grant: OrganizationSupportAccessGrantSummary | null;
  status: 'active' | 'expired' | 'missing';
}> {
  if (!isEnterpriseDataPlanePermission(input.permission)) {
    return {
      grant: null,
      status: 'missing',
    };
  }

  const now = Date.now();
  const grants = await ctx.db
    .query('organizationSupportAccessGrants')
    .withIndex('by_organization_id_and_site_admin_user_id', (query) =>
      query.eq('organizationId', input.organizationId).eq('siteAdminUserId', input.siteAdminUserId),
    )
    .collect();

  const covered = grants
    .filter(
      (grant) =>
        grant.revokedAt === null && doesSupportGrantCoverPermission(grant.scope, input.permission),
    )
    .sort((left, right) => right.expiresAt - left.expiresAt);

  const active = covered.find((grant) => grant.expiresAt > now);
  if (active) {
    return {
      grant: {
        expiresAt: active.expiresAt,
        id: active._id,
        reason: active.reason,
        scope: active.scope,
      },
      status: 'active',
    };
  }

  if (covered.length > 0) {
    return {
      grant: null,
      status: 'expired',
    };
  }

  return {
    grant: null,
    status: 'missing',
  };
}

export async function resolveOrganizationEnterpriseAccess(
  ctx: QueryCtx | MutationCtx,
  input: ResolveOrganizationEnterpriseAccessInput,
): Promise<OrganizationEnterpriseAccessResult> {
  if (input.policies.enterpriseAuthMode !== 'required') {
    return buildEnterpriseAccessResult({
      enterpriseAuthMode: input.policies.enterpriseAuthMode,
      providerKey: input.policies.enterpriseProviderKey,
      satisfactionPath: 'not_required',
      status: 'not_required',
    });
  }

  if (!requiresEnterpriseSatisfied(input.permission)) {
    return buildEnterpriseAccessResult({
      enterpriseAuthMode: input.policies.enterpriseAuthMode,
      providerKey: input.policies.enterpriseProviderKey,
      satisfactionPath: 'site_admin',
      status: 'satisfied',
    });
  }

  if (input.user.isSiteAdmin) {
    if (!isEnterpriseDataPlanePermission(input.permission)) {
      return buildEnterpriseAccessResult({
        enterpriseAuthMode: input.policies.enterpriseAuthMode,
        providerKey: input.policies.enterpriseProviderKey,
        satisfactionPath: 'site_admin',
        status: 'satisfied',
      });
    }

    const supportGrantState = await resolveSupportGrantState(ctx, {
      organizationId: input.organizationId,
      permission: input.permission,
      siteAdminUserId: input.user.authUserId,
    });

    return buildEnterpriseAccessResult({
      enterpriseAuthMode: input.policies.enterpriseAuthMode,
      providerKey: input.policies.enterpriseProviderKey,
      status:
        supportGrantState.status === 'active'
          ? 'satisfied'
          : supportGrantState.status === 'expired'
            ? 'support_grant_expired'
            : 'support_grant_required',
      supportGrant: supportGrantState.grant,
      satisfactionPath: supportGrantState.status === 'active' ? 'support_grant' : null,
    });
  }

  const verifiedDomains = await getVerifiedOrganizationDomains(ctx, input.organizationId);
  const emailDomain = normalizeEmailDomain(input.user.authUser.email);
  const matchesManagedDomain = verifiedDomains.includes(emailDomain);

  if (!matchesManagedDomain) {
    return buildEnterpriseAccessResult({
      enterpriseAuthMode: input.policies.enterpriseAuthMode,
      providerKey: input.policies.enterpriseProviderKey,
      status: 'unmanaged_email_domain',
    });
  }

  if (
    canOwnerUseBreakGlassForPermission(input.permission) &&
    input.policies.allowBreakGlassPasswordLogin &&
    input.membership?.role === 'owner'
  ) {
    return buildEnterpriseAccessResult({
      enterpriseAuthMode: input.policies.enterpriseAuthMode,
      providerKey: input.policies.enterpriseProviderKey,
      satisfactionPath: 'owner_break_glass',
      status: 'satisfied',
    });
  }

  const hasMatchingEnterpriseSession =
    input.user.authSession?.authMethod === 'enterprise' &&
    input.user.authSession.enterpriseOrganizationId === input.organizationId &&
    input.user.authSession.enterpriseProviderKey === input.policies.enterpriseProviderKey;

  return buildEnterpriseAccessResult({
    enterpriseAuthMode: input.policies.enterpriseAuthMode,
    providerKey: input.policies.enterpriseProviderKey,
    satisfactionPath: hasMatchingEnterpriseSession ? 'enterprise_session' : null,
    status: hasMatchingEnterpriseSession ? 'satisfied' : 'missing_enterprise_session',
  });
}

export type OrganizationSupportAccessGrantDoc = Doc<'organizationSupportAccessGrants'>;
