import type { PaginationResult } from 'convex/server';
import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  canChangeMemberRole,
  canDeleteOrganization,
  canManageDomains,
  canManageMemberState,
  canManageOrganization,
  canManageOrganizationPolicies,
  canRemoveMember,
  canViewOrganizationAudit,
  deriveViewerRole,
  getAssignableRoles,
  normalizeOrganizationRole,
  type OrganizationRole,
  type OrganizationViewerRole,
} from '../src/features/organizations/lib/organization-permissions';
import { isGoogleWorkspaceOAuthConfigured } from '../src/lib/server/env.server';
import {
  applyAlwaysOnRegulatedBaseline,
  REGULATED_ORGANIZATION_POLICY_DEFAULTS,
} from '../src/lib/shared/security-baseline';
import { STEP_UP_REQUIREMENTS } from '../src/lib/shared/auth-policy';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import {
  checkOrganizationAccess,
  getVerifiedCurrentUserOrThrow,
  listOrganizationMembers,
  requireStepUpFromActionOrThrow,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import {
  type BetterAuthMember,
  fetchAllBetterAuthOrganizations,
  fetchBetterAuthInvitationsByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  fetchBetterAuthUsersByIds,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
  findBetterAuthOrganizationBySlug,
  findBetterAuthScimProviderByOrganizationId,
} from './lib/betterAuth';
import { listStandaloneAttachmentsForOrganization } from './lib/organizationCleanup';
import {
  getOrganizationMembershipStateRecord,
  getOrganizationMembershipStatus,
  getOrganizationMembershipStatuses,
  type OrganizationMembershipStatus,
} from './lib/organizationMembershipState';
import {
  allowedResultValidator,
  chatThreadsDocValidator,
  directoryOrganizationValidator,
  organizationAuditResponseValidator,
  organizationCreationEligibilityValidator,
  organizationDirectoryResponseValidator,
  organizationDomainDocValidator,
  organizationDomainsResponseValidator,
  organizationDomainValidator,
  organizationEnterpriseAccessResultValidator,
  organizationEnterpriseAuthResolutionResultValidator,
  organizationInvitePolicyValidator,
  organizationMemberStatusValidator,
  organizationSettingsValidator,
} from './lib/returnValidators';

type OrganizationDirectorySortField = 'name' | 'email' | 'kind' | 'role' | 'status' | 'createdAt';
type OrganizationDirectorySortDirection = 'asc' | 'desc';
type OrganizationAuditSortField = 'label' | 'identifier' | 'userId' | 'createdAt';

type OrganizationAccessContext = {
  access: Awaited<ReturnType<typeof checkOrganizationAccess>>;
  organization: NonNullable<Awaited<ReturnType<typeof findBetterAuthOrganizationById>>>;
  user: Awaited<ReturnType<typeof getVerifiedCurrentUserOrThrow>>;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
  viewerRole: OrganizationViewerRole;
};

type OrganizationMemberRow = {
  id: string;
  kind: 'member';
  membershipId: string;
  authUserId: string;
  name: string | null;
  email: string;
  role: OrganizationRole;
  status: OrganizationMembershipStatus;
  createdAt: number;
  isSiteAdmin: boolean;
  availableRoles: OrganizationRole[];
  canChangeRole: boolean;
  canRemove: boolean;
  canSuspend: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
};

type OrganizationInvitationRow = {
  id: string;
  kind: 'invite';
  invitationId: string;
  name: null;
  email: string;
  role: OrganizationRole;
  status: 'pending' | 'expired';
  createdAt: number;
  expiresAt: number;
  canRevoke: boolean;
};

type OrganizationDirectoryRow = OrganizationMemberRow | OrganizationInvitationRow;
type OrganizationInvitePolicy = 'owners_admins' | 'owners_only';
type OrganizationPolicies = {
  invitePolicy: OrganizationInvitePolicy;
  verifiedDomainsOnly: boolean;
  memberCap: number | null;
  mfaRequired: boolean;
  auditExportRequiresStepUp: boolean;
  attachmentSharingAllowed: boolean;
  dataRetentionDays: number;
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  enterpriseProviderKey: 'google-workspace' | 'entra' | 'okta' | null;
  enterpriseProtocol: 'oidc' | null;
  enterpriseEnabledAt: number | null;
  enterpriseEnforcedAt: number | null;
  allowBreakGlassPasswordLogin: boolean;
  temporaryLinkTtlMinutes: number;
  webSearchAllowed: boolean;
};
const ORGANIZATION_CLEANUP_BATCH_SIZE = 128;
const SELF_SERVE_ORGANIZATION_LIMIT = 2;
const ORGANIZATION_AUDIT_EVENT_TYPES = new Set([
  'organization_created',
  'organization_updated',
  'member_added',
  'member_removed',
  'member_role_updated',
  'member_suspended',
  'member_deactivated',
  'member_reactivated',
  'member_invited',
  'invite_accepted',
  'invite_rejected',
  'invite_cancelled',
  'domain_added',
  'domain_verification_succeeded',
  'domain_verification_failed',
  'domain_verification_token_regenerated',
  'domain_removed',
  'organization_policy_updated',
  'enterprise_auth_mode_updated',
  'enterprise_login_succeeded',
  'enterprise_scim_token_generated',
  'enterprise_scim_token_deleted',
  'scim_member_deprovisioned',
  'scim_member_reactivated',
  'scim_member_deprovision_failed',
  'bulk_invite_revoked',
  'bulk_invite_resent',
  'bulk_member_removed',
  'authorization_denied',
  'admin_user_sessions_viewed',
  'directory_exported',
  'audit_log_exported',
  'chat_thread_created',
  'chat_thread_deleted',
  'chat_attachment_uploaded',
  'chat_attachment_scan_passed',
  'chat_attachment_scan_failed',
  'chat_attachment_quarantined',
  'chat_attachment_deleted',
  'attachment_access_url_issued',
  'pdf_parse_requested',
  'pdf_parse_succeeded',
  'pdf_parse_failed',
  'chat_run_completed',
  'chat_run_failed',
  'chat_web_search_used',
  'audit_integrity_check_failed',
  'evidence_report_generated',
  'evidence_report_exported',
  'evidence_report_reviewed',
  'outbound_vendor_access_denied',
  'outbound_vendor_access_used',
  'mfa_enrollment_enforced',
  'email_verification_enforced',
  'step_up_challenge_required',
  'step_up_challenge_completed',
]);
const ORGANIZATION_AUDIT_FAILURE_EVENT_TYPES = new Set([
  'domain_verification_failed',
  'scim_member_deprovision_failed',
]);
const ORGANIZATION_AUDIT_SECURITY_EVENT_TYPES = new Set([
  'authorization_denied',
  'admin_user_sessions_viewed',
  'directory_exported',
  'audit_log_exported',
  'organization_policy_updated',
  'enterprise_auth_mode_updated',
  'enterprise_login_succeeded',
  'enterprise_scim_token_generated',
  'enterprise_scim_token_deleted',
  'scim_member_deprovisioned',
  'scim_member_reactivated',
  'scim_member_deprovision_failed',
  'member_removed',
  'member_suspended',
  'member_deactivated',
  'member_reactivated',
  'bulk_invite_revoked',
  'bulk_member_removed',
  'domain_removed',
  'domain_verification_failed',
  'chat_thread_created',
  'chat_thread_deleted',
  'chat_attachment_uploaded',
  'chat_attachment_scan_passed',
  'chat_attachment_scan_failed',
  'chat_attachment_quarantined',
  'chat_attachment_deleted',
  'attachment_access_url_issued',
  'pdf_parse_requested',
  'pdf_parse_succeeded',
  'pdf_parse_failed',
  'chat_run_completed',
  'chat_run_failed',
  'chat_web_search_used',
  'audit_integrity_check_failed',
  'evidence_report_generated',
  'evidence_report_exported',
  'evidence_report_reviewed',
  'outbound_vendor_access_denied',
  'outbound_vendor_access_used',
  'mfa_enrollment_enforced',
  'email_verification_enforced',
  'step_up_challenge_required',
  'step_up_challenge_completed',
]);
const ORGANIZATION_DOMAIN_VERIFICATION_PREFIX = '_ba-verify';

type OrganizationAccessContextForWrite = {
  access: Awaited<ReturnType<typeof checkOrganizationAccess>>;
  organization: NonNullable<Awaited<ReturnType<typeof findBetterAuthOrganizationById>>>;
  user: Awaited<ReturnType<typeof getVerifiedCurrentUserOrThrow>>;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
  viewerRole: OrganizationViewerRole;
};

type OrganizationDomainDoc = Doc<'organizationDomains'>;
type OrganizationPolicyDoc = Doc<'organizationPolicies'>;
const DEFAULT_ORGANIZATION_POLICIES: OrganizationPolicies = {
  ...REGULATED_ORGANIZATION_POLICY_DEFAULTS,
};

async function userHasPasskey(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  authUserId: string,
): Promise<boolean> {
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
    return false;
  }

  return rawResult.page.length > 0;
}

const GOOGLE_WORKSPACE_PROVIDER_KEY = 'google-workspace' as const;

function getEnterpriseProviderLabel(providerKey: 'google-workspace' | 'entra' | 'okta') {
  switch (providerKey) {
    case 'google-workspace':
      return 'Google Workspace';
    case 'entra':
      return 'Microsoft Entra ID';
    case 'okta':
      return 'Okta';
  }
}

function getOrganizationScimProviderId(
  organizationId: string,
  providerKey: 'google-workspace' | 'entra' | 'okta',
) {
  return `${providerKey}--${organizationId}`;
}

function getAvailableEnterpriseProviders() {
  return [
    {
      key: GOOGLE_WORKSPACE_PROVIDER_KEY,
      label: getEnterpriseProviderLabel(GOOGLE_WORKSPACE_PROVIDER_KEY),
      protocol: 'oidc' as const,
      status: isGoogleWorkspaceOAuthConfigured()
        ? ('active' as const)
        : ('not_configured' as const),
      selectable: isGoogleWorkspaceOAuthConfigured(),
    },
    {
      key: 'entra' as const,
      label: getEnterpriseProviderLabel('entra'),
      protocol: 'oidc' as const,
      status: 'coming_soon' as const,
      selectable: false,
    },
    {
      key: 'okta' as const,
      label: getEnterpriseProviderLabel('okta'),
      protocol: 'oidc' as const,
      status: 'coming_soon' as const,
      selectable: false,
    },
  ];
}

function getAvailableInviteRoles(viewerRole: OrganizationViewerRole): OrganizationRole[] {
  if (viewerRole === 'site-admin' || viewerRole === 'owner') {
    return ['owner', 'admin', 'member'];
  }

  if (viewerRole === 'admin') {
    return ['admin', 'member'];
  }

  return [];
}

function toOrganizationPolicies(
  policy: OrganizationPolicyDoc | null | undefined,
): OrganizationPolicies {
  return applyAlwaysOnRegulatedBaseline({
    invitePolicy: policy?.invitePolicy ?? DEFAULT_ORGANIZATION_POLICIES.invitePolicy,
    verifiedDomainsOnly:
      policy?.verifiedDomainsOnly ?? DEFAULT_ORGANIZATION_POLICIES.verifiedDomainsOnly,
    memberCap: policy?.memberCap ?? DEFAULT_ORGANIZATION_POLICIES.memberCap,
    mfaRequired: policy?.mfaRequired ?? DEFAULT_ORGANIZATION_POLICIES.mfaRequired,
    auditExportRequiresStepUp:
      policy?.auditExportRequiresStepUp ?? DEFAULT_ORGANIZATION_POLICIES.auditExportRequiresStepUp,
    attachmentSharingAllowed:
      policy?.attachmentSharingAllowed ?? DEFAULT_ORGANIZATION_POLICIES.attachmentSharingAllowed,
    dataRetentionDays: policy?.dataRetentionDays ?? DEFAULT_ORGANIZATION_POLICIES.dataRetentionDays,
    enterpriseAuthMode:
      policy?.enterpriseAuthMode ?? DEFAULT_ORGANIZATION_POLICIES.enterpriseAuthMode,
    enterpriseProviderKey:
      policy?.enterpriseProviderKey ?? DEFAULT_ORGANIZATION_POLICIES.enterpriseProviderKey,
    enterpriseProtocol:
      policy?.enterpriseProtocol ?? DEFAULT_ORGANIZATION_POLICIES.enterpriseProtocol,
    enterpriseEnabledAt:
      policy?.enterpriseEnabledAt ?? DEFAULT_ORGANIZATION_POLICIES.enterpriseEnabledAt,
    enterpriseEnforcedAt:
      policy?.enterpriseEnforcedAt ?? DEFAULT_ORGANIZATION_POLICIES.enterpriseEnforcedAt,
    allowBreakGlassPasswordLogin:
      policy?.allowBreakGlassPasswordLogin ??
      DEFAULT_ORGANIZATION_POLICIES.allowBreakGlassPasswordLogin,
    temporaryLinkTtlMinutes:
      policy?.temporaryLinkTtlMinutes ?? DEFAULT_ORGANIZATION_POLICIES.temporaryLinkTtlMinutes,
    webSearchAllowed: policy?.webSearchAllowed ?? DEFAULT_ORGANIZATION_POLICIES.webSearchAllowed,
  });
}

export async function getOrganizationPolicies(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<OrganizationPolicies> {
  const policy = await ctx.db
    .query('organizationPolicies')
    .withIndex('by_organization_id', (q) => q.eq('organizationId', organizationId))
    .first();

  return toOrganizationPolicies(policy);
}

async function countActiveOwners(ctx: QueryCtx | MutationCtx, memberships: BetterAuthMember[]) {
  const membershipStatuses = await getOrganizationMembershipStatuses(
    ctx,
    memberships.map((membership) => membership._id),
  );

  return memberships.filter(
    (membership) =>
      membership.role === 'owner' &&
      (membershipStatuses.get(membership._id) ?? 'active') === 'active',
  ).length;
}

async function getMembershipStatusMap(
  ctx: QueryCtx | MutationCtx,
  memberships: BetterAuthMember[],
) {
  return await getOrganizationMembershipStatuses(
    ctx,
    memberships.map((membership) => membership._id),
  );
}

async function upsertOrganizationMembershipState(
  ctx: MutationCtx,
  input: {
    membership: BetterAuthMember;
    nextStatus: Exclude<OrganizationMembershipStatus, 'active'>;
    reason?: string | null;
    updatedByUserId: string;
  },
) {
  const existing = await getOrganizationMembershipStateRecord(ctx, input.membership._id);
  const now = Date.now();
  const reason = input.reason?.trim() ? input.reason.trim() : null;

  if (existing) {
    await ctx.db.patch(existing._id, {
      status: input.nextStatus,
      reason,
      updatedAt: now,
      updatedByUserId: input.updatedByUserId,
      ...(input.nextStatus === 'deactivated' ? { deactivatedAt: now } : {}),
    });
    return;
  }

  await ctx.db.insert('organizationMembershipStates', {
    organizationId: input.membership.organizationId,
    membershipId: input.membership._id,
    userId: input.membership.userId,
    status: input.nextStatus,
    reason,
    createdAt: now,
    updatedAt: now,
    updatedByUserId: input.updatedByUserId,
    ...(input.nextStatus === 'deactivated' ? { deactivatedAt: now } : {}),
  });
}

async function clearOrganizationMembershipState(
  ctx: MutationCtx,
  input: {
    membership: BetterAuthMember;
  },
) {
  const existing = await getOrganizationMembershipStateRecord(ctx, input.membership._id);
  if (!existing) {
    return;
  }

  await ctx.db.delete(existing._id);
}

function canInviteUnderPolicy(
  viewerRole: OrganizationViewerRole,
  invitePolicy: OrganizationInvitePolicy,
) {
  if (viewerRole === 'site-admin' || viewerRole === 'owner') {
    return true;
  }

  if (viewerRole === 'admin') {
    return invitePolicy === 'owners_admins';
  }

  return false;
}

function canLeaveOrganization(input: {
  ownerCount: number;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
}) {
  if (!input.viewerMembership) {
    return false;
  }

  return input.viewerMembership.role !== 'owner' || input.ownerCount > 1;
}

function buildOrganizationCapabilities(input: {
  ownerCount: number;
  policies: OrganizationPolicies;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
  viewerRole: OrganizationViewerRole;
}) {
  return {
    availableInviteRoles: getAvailableInviteRoles(input.viewerRole),
    canInvite:
      getAvailableInviteRoles(input.viewerRole).length > 0 &&
      canInviteUnderPolicy(input.viewerRole, input.policies.invitePolicy),
    canUpdateSettings: canManageOrganization(input.viewerRole),
    canDeleteOrganization: canDeleteOrganization(input.viewerRole),
    canLeaveOrganization: canLeaveOrganization(input),
    canManageMembers: canManageOrganization(input.viewerRole),
    canManageDomains: canManageDomains(input.viewerRole),
    canViewAudit: canViewOrganizationAudit(input.viewerRole),
    canManagePolicies: canManageOrganizationPolicies(input.viewerRole),
  };
}

function normalizeOrganizationEmailDomain(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const atIndex = normalizedEmail.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    throwConvexError('VALIDATION', 'Enter a valid email address');
  }

  return normalizedEmail.slice(atIndex + 1);
}

function normalizeOrganizationDomain(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '');

  if (
    normalized.length < 3 ||
    normalized.length > 253 ||
    !normalized.includes('.') ||
    normalized.includes('..') ||
    !/^[a-z0-9.-]+$/.test(normalized)
  ) {
    throwConvexError('VALIDATION', 'Enter a valid domain name');
  }

  return normalized;
}

function createOrganizationDomainVerificationToken() {
  return crypto.randomUUID().replaceAll('-', '');
}

function normalizeEmailDomain(email: string) {
  const [, domain = ''] = email.trim().toLowerCase().split('@');
  return domain;
}

function getOrganizationDomainVerificationRecordName(domain: string) {
  return `${ORGANIZATION_DOMAIN_VERIFICATION_PREFIX}.${domain}`;
}

function getOrganizationDomainVerificationRecordValue(token: string) {
  return `better-auth-verify=${token}`;
}

function toOrganizationDomain(domain: OrganizationDomainDoc) {
  return {
    id: domain._id,
    organizationId: domain.organizationId,
    domain: domain.domain,
    normalizedDomain: domain.normalizedDomain,
    status: domain.status,
    verificationMethod: domain.verificationMethod,
    verificationToken: domain.verificationToken,
    verificationRecordName: getOrganizationDomainVerificationRecordName(domain.normalizedDomain),
    verificationRecordValue: getOrganizationDomainVerificationRecordValue(domain.verificationToken),
    verifiedAt: domain.verifiedAt,
    createdByUserId: domain.createdByUserId,
    createdAt: domain.createdAt,
  } as const;
}

async function getOrganizationEnterpriseAuthSummary(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  policies: OrganizationPolicies,
) {
  if (!policies.enterpriseProviderKey) {
    return null;
  }

  const managedDomains = (
    await ctx.db
      .query('organizationDomains')
      .withIndex('by_organization_id', (q) => q.eq('organizationId', organizationId))
      .collect()
  )
    .filter((domain) => domain.status === 'verified')
    .map((domain) => domain.normalizedDomain)
    .sort((left, right) => left.localeCompare(right));
  const scimProvider = await findBetterAuthScimProviderByOrganizationId(ctx, organizationId);
  const providerOption = getAvailableEnterpriseProviders().find(
    (option) => option.key === policies.enterpriseProviderKey,
  );
  if (!providerOption) {
    return null;
  }

  return {
    providerKey: policies.enterpriseProviderKey,
    providerLabel: providerOption.label,
    protocol: 'oidc' as const,
    providerStatus: providerOption.status,
    managedDomains,
    scimProviderId: getOrganizationScimProviderId(organizationId, policies.enterpriseProviderKey),
    scimConnectionConfigured: scimProvider !== null,
  } as const;
}

async function getOrganizationVerifiedDomains(ctx: QueryCtx | MutationCtx, organizationId: string) {
  return (
    await ctx.db
      .query('organizationDomains')
      .withIndex('by_organization_id', (q) => q.eq('organizationId', organizationId))
      .collect()
  )
    .filter((domain) => domain.status === 'verified')
    .map((domain) => domain.normalizedDomain);
}

async function getOrganizationEnterpriseAccessForUser(
  ctx: QueryCtx | MutationCtx,
  input: {
    organizationId: string;
    user: Awaited<ReturnType<typeof getVerifiedCurrentUserOrThrow>>;
    policies?: OrganizationPolicies;
  },
) {
  const policies = input.policies ?? (await getOrganizationPolicies(ctx, input.organizationId));
  if (policies.enterpriseAuthMode !== 'required') {
    return {
      allowed: true,
      reason: null,
      requiresEnterpriseAuth: false,
      providerKey: policies.enterpriseProviderKey,
      enterpriseAuthMode: policies.enterpriseAuthMode,
    } as const;
  }

  if (input.user.isSiteAdmin) {
    return {
      allowed: true,
      reason: null,
      requiresEnterpriseAuth: true,
      providerKey: policies.enterpriseProviderKey,
      enterpriseAuthMode: policies.enterpriseAuthMode,
    } as const;
  }

  const email = typeof input.user.authUser.email === 'string' ? input.user.authUser.email : '';
  const emailDomain = normalizeEmailDomain(email);
  const verifiedDomains = await getOrganizationVerifiedDomains(ctx, input.organizationId);
  const matchesManagedDomain = verifiedDomains.includes(emailDomain);
  if (!matchesManagedDomain) {
    return {
      allowed: true,
      reason: null,
      requiresEnterpriseAuth: true,
      providerKey: policies.enterpriseProviderKey,
      enterpriseAuthMode: policies.enterpriseAuthMode,
    } as const;
  }

  if (policies.allowBreakGlassPasswordLogin) {
    const membership = await findBetterAuthMember(ctx, input.organizationId, input.user.authUserId);
    if (membership?.role === 'owner') {
      return {
        allowed: true,
        reason: null,
        requiresEnterpriseAuth: true,
        providerKey: policies.enterpriseProviderKey,
        enterpriseAuthMode: policies.enterpriseAuthMode,
      } as const;
    }
  }

  const session = input.user.authSession;
  const hasMatchingEnterpriseSession =
    session?.authMethod === 'enterprise' &&
    session.enterpriseOrganizationId === input.organizationId &&
    session.enterpriseProviderKey === policies.enterpriseProviderKey;

  return {
    allowed: hasMatchingEnterpriseSession,
    reason: hasMatchingEnterpriseSession ? null : 'This organization requires enterprise sign-in',
    requiresEnterpriseAuth: true,
    providerKey: policies.enterpriseProviderKey,
    enterpriseAuthMode: policies.enterpriseAuthMode,
  } as const;
}

function auditEventMatchesSearch(
  event: {
    label?: string;
    actorLabel?: string;
    targetLabel?: string;
    eventType: string;
    identifier?: string;
    userId?: string;
    metadata?: unknown;
  },
  searchValue: string,
) {
  if (searchValue.length === 0) {
    return true;
  }

  const haystacks = [
    event.label,
    event.actorLabel,
    event.targetLabel,
    event.eventType,
    event.identifier,
    event.userId,
    typeof event.metadata === 'string' ? event.metadata : JSON.stringify(event.metadata ?? ''),
  ];

  return haystacks.some((value) => value?.toLowerCase().includes(searchValue) ?? false);
}

function getOrganizationAuditEventLabel(eventType: string) {
  switch (eventType) {
    case 'organization_created':
      return 'Organization created';
    case 'organization_updated':
      return 'Organization updated';
    case 'member_added':
      return 'Member added';
    case 'member_removed':
      return 'Member removed';
    case 'member_role_updated':
      return 'Member role updated';
    case 'member_suspended':
      return 'Member suspended';
    case 'member_deactivated':
      return 'Member deactivated';
    case 'member_reactivated':
      return 'Member reactivated';
    case 'member_invited':
      return 'Invitation sent';
    case 'invite_accepted':
      return 'Invitation accepted';
    case 'invite_rejected':
      return 'Invitation rejected';
    case 'invite_cancelled':
      return 'Invitation cancelled';
    case 'domain_added':
      return 'Domain added';
    case 'domain_verification_succeeded':
      return 'Domain verified';
    case 'domain_verification_failed':
      return 'Domain verification failed';
    case 'domain_verification_token_regenerated':
      return 'Domain verification token regenerated';
    case 'domain_removed':
      return 'Domain removed';
    case 'organization_policy_updated':
      return 'Organization policies updated';
    case 'enterprise_auth_mode_updated':
      return 'Enterprise auth mode updated';
    case 'enterprise_login_succeeded':
      return 'Enterprise login succeeded';
    case 'enterprise_scim_user_provisioned':
      return 'SCIM user provisioned';
    case 'enterprise_scim_user_updated':
      return 'SCIM user updated';
    case 'enterprise_scim_user_deactivated':
      return 'SCIM member deprovisioned';
    case 'enterprise_scim_user_reactivated':
      return 'SCIM member reactivated';
    case 'scim_member_deprovisioned':
      return 'SCIM member deprovisioned';
    case 'scim_member_reactivated':
      return 'SCIM member reactivated';
    case 'scim_member_deprovision_failed':
      return 'SCIM member deprovision failed';
    case 'bulk_invite_revoked':
      return 'Bulk invitation revoked';
    case 'bulk_invite_resent':
      return 'Bulk invitation resent';
    case 'bulk_member_removed':
      return 'Bulk member removed';
    case 'authorization_denied':
      return 'Authorization denied';
    case 'admin_user_sessions_viewed':
      return 'Admin user sessions viewed';
    case 'directory_exported':
      return 'Directory exported';
    case 'audit_log_exported':
      return 'Audit log exported';
    case 'chat_thread_created':
      return 'Chat thread created';
    case 'chat_thread_deleted':
      return 'Chat thread deleted';
    case 'chat_attachment_uploaded':
      return 'Chat attachment uploaded';
    case 'chat_attachment_scan_passed':
      return 'Chat attachment scan passed';
    case 'chat_attachment_scan_failed':
      return 'Chat attachment scan failed';
    case 'chat_attachment_quarantined':
      return 'Chat attachment quarantined';
    case 'chat_attachment_deleted':
      return 'Chat attachment deleted';
    case 'attachment_access_url_issued':
      return 'Attachment access URL issued';
    case 'pdf_parse_requested':
      return 'PDF parse requested';
    case 'pdf_parse_succeeded':
      return 'PDF parse succeeded';
    case 'pdf_parse_failed':
      return 'PDF parse failed';
    case 'chat_run_completed':
      return 'Chat run completed';
    case 'chat_run_failed':
      return 'Chat run failed';
    case 'chat_web_search_used':
      return 'Web search used';
    case 'audit_integrity_check_failed':
      return 'Audit integrity check failed';
    default:
      return eventType;
  }
}

function parseAuditMetadata(metadata: string | undefined) {
  if (!metadata) {
    return undefined;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

function getAuditMetadataRecord(metadata: unknown) {
  return typeof metadata === 'object' && metadata !== null
    ? (metadata as Record<string, unknown>)
    : null;
}

function toAuditMetadataDisplayValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getAuditProviderLabel(value: unknown) {
  const providerValue = toAuditMetadataDisplayValue(value);
  if (!providerValue) {
    return undefined;
  }

  if (providerValue === 'google-workspace' || providerValue.startsWith('google-workspace--')) {
    return getEnterpriseProviderLabel('google-workspace');
  }

  if (providerValue === 'entra' || providerValue.startsWith('entra--')) {
    return getEnterpriseProviderLabel('entra');
  }

  if (providerValue === 'okta' || providerValue.startsWith('okta--')) {
    return getEnterpriseProviderLabel('okta');
  }

  return providerValue;
}

function getGenericAuditActorLabel(eventType: string) {
  switch (eventType) {
    case 'domain_added':
    case 'domain_verification_succeeded':
    case 'domain_verification_failed':
    case 'domain_verification_token_regenerated':
    case 'domain_removed':
    case 'organization_policy_updated':
    case 'enterprise_auth_mode_updated':
      return 'Organization admin';
    default:
      return undefined;
  }
}

function getAuditActorLabel(event: Doc<'auditLogs'>, metadata: unknown) {
  const metadataRecord = getAuditMetadataRecord(metadata);

  if (
    event.eventType === 'enterprise_scim_token_generated' ||
    event.eventType === 'enterprise_scim_token_deleted'
  ) {
    return (
      getAuditProviderLabel(metadataRecord?.providerLabel) ??
      getAuditProviderLabel(metadataRecord?.providerKey) ??
      getAuditProviderLabel(metadataRecord?.providerId)
    );
  }

  return (
    toAuditMetadataDisplayValue(metadataRecord?.actorEmail) ??
    toAuditMetadataDisplayValue(metadataRecord?.inviterEmail) ??
    getGenericAuditActorLabel(event.eventType)
  );
}

function getAuditTargetLabel(event: Doc<'auditLogs'>, metadata: unknown) {
  const metadataRecord = getAuditMetadataRecord(metadata);

  if (event.eventType === 'organization_policy_updated') {
    return 'Organization policies';
  }

  if (event.eventType === 'enterprise_auth_mode_updated') {
    return 'Enterprise auth settings';
  }

  if (
    event.eventType === 'enterprise_scim_token_generated' ||
    event.eventType === 'enterprise_scim_token_deleted'
  ) {
    return 'SCIM token';
  }

  return (
    toAuditMetadataDisplayValue(metadataRecord?.targetEmail) ??
    toAuditMetadataDisplayValue(metadataRecord?.email) ??
    toAuditMetadataDisplayValue(metadataRecord?.domain) ??
    getAuditProviderLabel(metadataRecord?.providerLabel) ??
    getAuditProviderLabel(metadataRecord?.providerKey) ??
    getAuditProviderLabel(metadataRecord?.providerId)
  );
}

function getAuditSummary(eventType: string, metadata: unknown) {
  const metadataRecord = getAuditMetadataRecord(metadata);

  if (eventType === 'organization_policy_updated') {
    const changedKeys = Array.isArray(metadataRecord?.changedKeys)
      ? metadataRecord.changedKeys.filter((value): value is string => typeof value === 'string')
      : [];

    return changedKeys.length > 0 ? `Changed: ${changedKeys.join(', ')}` : undefined;
  }

  if (eventType === 'bulk_invite_revoked' || eventType === 'bulk_invite_resent') {
    const targetRole = toAuditMetadataDisplayValue(metadataRecord?.targetRole);
    return targetRole ? `Role: ${targetRole}` : undefined;
  }

  if (eventType === 'bulk_member_removed') {
    const targetRole = toAuditMetadataDisplayValue(metadataRecord?.targetRole);
    return targetRole ? `Removed ${targetRole}` : undefined;
  }

  if (
    eventType === 'member_suspended' ||
    eventType === 'member_deactivated' ||
    eventType === 'member_reactivated'
  ) {
    return toAuditMetadataDisplayValue(metadataRecord?.reason);
  }

  return undefined;
}

function compareNullableStrings(
  left: string | undefined,
  right: string | undefined,
  sortOrder: 'asc' | 'desc',
) {
  const leftValue = left?.trim().toLowerCase() ?? '';
  const rightValue = right?.trim().toLowerCase() ?? '';
  const result = leftValue.localeCompare(rightValue);

  return sortOrder === 'asc' ? result : -result;
}

function toOrganizationAuditEventViewModel(event: Doc<'auditLogs'>) {
  const metadata = parseAuditMetadata(event.metadata);
  const actorLabel = getAuditActorLabel(event, metadata);
  const targetLabel = getAuditTargetLabel(event, metadata);
  const summary = getAuditSummary(event.eventType, metadata);

  return {
    id: event.id,
    eventType: event.eventType,
    label: getOrganizationAuditEventLabel(event.eventType),
    ...(actorLabel ? { actorLabel } : {}),
    ...(targetLabel ? { targetLabel } : {}),
    ...(summary ? { summary } : {}),
    ...(event.userId ? { userId: event.userId } : {}),
    ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
    ...(event.targetUserId ? { targetUserId: event.targetUserId } : {}),
    ...(event.organizationId ? { organizationId: event.organizationId } : {}),
    ...(event.identifier ? { identifier: event.identifier } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.severity ? { severity: event.severity } : {}),
    ...(event.resourceType ? { resourceType: event.resourceType } : {}),
    ...(event.resourceId ? { resourceId: event.resourceId } : {}),
    ...(event.resourceLabel ? { resourceLabel: event.resourceLabel } : {}),
    ...(event.sourceSurface ? { sourceSurface: event.sourceSurface } : {}),
    ...(event.eventHash ? { eventHash: event.eventHash } : {}),
    ...(event.previousEventHash ? { previousEventHash: event.previousEventHash } : {}),
    createdAt: event.createdAt,
    ...(event.ipAddress ? { ipAddress: event.ipAddress } : {}),
    ...(event.userAgent ? { userAgent: event.userAgent } : {}),
    ...(event.metadata ? { metadata } : {}),
  };
}

function compareOrganizationAuditEvents(
  left: ReturnType<typeof toOrganizationAuditEventViewModel>,
  right: ReturnType<typeof toOrganizationAuditEventViewModel>,
  sortBy: OrganizationAuditSortField,
  sortOrder: 'asc' | 'desc',
) {
  switch (sortBy) {
    case 'label': {
      const labelResult = compareNullableStrings(left.label, right.label, sortOrder);
      if (labelResult !== 0) {
        return labelResult;
      }
      break;
    }
    case 'identifier': {
      const identifierResult = compareNullableStrings(left.identifier, right.identifier, sortOrder);
      if (identifierResult !== 0) {
        return identifierResult;
      }
      break;
    }
    case 'userId': {
      const userIdResult = compareNullableStrings(left.userId, right.userId, sortOrder);
      if (userIdResult !== 0) {
        return userIdResult;
      }
      break;
    }
    case 'createdAt': {
      const createdAtResult =
        sortOrder === 'asc' ? left.createdAt - right.createdAt : right.createdAt - left.createdAt;
      if (createdAtResult !== 0) {
        return createdAtResult;
      }
      break;
    }
    default:
      break;
  }

  const createdAtResult =
    sortOrder === 'asc' ? left.createdAt - right.createdAt : right.createdAt - left.createdAt;
  if (createdAtResult !== 0) {
    return createdAtResult;
  }

  return sortOrder === 'asc' ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id);
}

function getAuditSearchStrategy(searchValue: string) {
  const normalizedValue = searchValue.trim().toLowerCase();
  if (!normalizedValue) {
    return { kind: 'organization' as const };
  }

  const matchingEventType = Array.from(ORGANIZATION_AUDIT_EVENT_TYPES).find(
    (eventType) =>
      eventType === normalizedValue ||
      getOrganizationAuditEventLabel(eventType).toLowerCase() === normalizedValue,
  );
  if (matchingEventType) {
    return { kind: 'eventType' as const, eventType: matchingEventType };
  }

  if (normalizedValue.includes('@')) {
    return { kind: 'identifier' as const, identifier: normalizedValue };
  }

  if (/^[a-z0-9_-]+$/i.test(normalizedValue)) {
    return { kind: 'userId' as const, userId: normalizedValue };
  }

  return { kind: 'organization' as const };
}

function parseAuditDateBoundary(value: string | undefined, boundary: 'start' | 'end') {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  const normalizedValue =
    boundary === 'start' ? `${trimmedValue}T00:00:00.000Z` : `${trimmedValue}T23:59:59.999Z`;
  const parsedValue = Date.parse(normalizedValue);

  return Number.isNaN(parsedValue) ? null : parsedValue;
}

async function collectOrganizationAuditPage(
  ctx: QueryCtx,
  input: {
    organizationId: string;
    requestedEventType: string | null;
    searchStrategy:
      | { kind: 'organization' }
      | { kind: 'eventType'; eventType: string }
      | { kind: 'identifier'; identifier: string }
      | { kind: 'userId'; userId: string };
    sortOrder: 'asc' | 'desc';
    cursor: string | null;
    numItems: number;
  },
) {
  const { organizationId, requestedEventType, searchStrategy, sortOrder, cursor, numItems } = input;

  if (searchStrategy.kind === 'identifier') {
    return await ctx.db
      .query('auditLogs')
      .withIndex('by_identifier_and_createdAt', (q) =>
        q.eq('identifier', searchStrategy.identifier),
      )
      .order(sortOrder)
      .paginate({ cursor, numItems });
  }

  if (searchStrategy.kind === 'userId') {
    return await ctx.db
      .query('auditLogs')
      .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', searchStrategy.userId))
      .order(sortOrder)
      .paginate({ cursor, numItems });
  }

  if (requestedEventType || searchStrategy.kind === 'eventType') {
    const eventType =
      requestedEventType ?? (searchStrategy.kind === 'eventType' ? searchStrategy.eventType : null);
    if (!eventType) {
      throw new Error('Audit event type is required for event-type scoped queries');
    }

    return await ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_eventType_and_createdAt', (q) =>
        q.eq('organizationId', organizationId).eq('eventType', eventType),
      )
      .order(sortOrder)
      .paginate({ cursor, numItems });
  }

  return await ctx.db
    .query('auditLogs')
    .withIndex('by_organizationId_and_createdAt', (q) => q.eq('organizationId', organizationId))
    .order(sortOrder)
    .paginate({ cursor, numItems });
}

async function insertOrganizationAuditLog(
  ctx: MutationCtx | ActionCtx,
  input: {
    eventType:
      | 'domain_added'
      | 'domain_verification_succeeded'
      | 'domain_verification_failed'
      | 'domain_verification_token_regenerated'
      | 'domain_removed';
    organizationId: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await ctx.runMutation(internal.audit.insertAuditLog, {
    eventType: input.eventType,
    organizationId: input.organizationId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.metadata ? { metadata: JSON.stringify(input.metadata) } : {}),
  });
}

function toTimestamp(value: string | number | Date | undefined | null): number {
  if (!value) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function isInvitationExpired(expiresAt: string | number | Date | undefined | null, asOf: number) {
  return toTimestamp(expiresAt) <= asOf;
}

function matchesOrganizationDirectorySearch(row: OrganizationDirectoryRow, searchValue: string) {
  return (
    row.email.toLowerCase().includes(searchValue) ||
    (row.name?.toLowerCase().includes(searchValue) ?? false)
  );
}

function sortOrganizationDirectoryRows(
  rows: OrganizationDirectoryRow[],
  args: {
    sortBy: OrganizationDirectorySortField;
    sortOrder: OrganizationDirectorySortDirection;
    secondarySortBy: OrganizationDirectorySortField;
    secondarySortOrder: OrganizationDirectorySortDirection;
  },
) {
  return [...rows].sort((left, right) => {
    const primary = compareValues(
      sortValue(left, args.sortBy),
      sortValue(right, args.sortBy),
      args.sortOrder,
    );
    if (primary !== 0) {
      return primary;
    }

    return compareValues(
      sortValue(left, args.secondarySortBy),
      sortValue(right, args.secondarySortBy),
      args.secondarySortOrder,
    );
  });
}

async function getOrganizationAccessContextBySlug(ctx: QueryCtx, slug: string) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const organization = await findBetterAuthOrganizationBySlug(ctx, slug);
  if (!organization) {
    return null;
  }

  const organizationId = organization._id ?? organization.id;
  if (!organizationId) {
    throw new Error('Organization is missing an id');
  }

  const [access, viewerMembership] = await Promise.all([
    checkOrganizationAccess(ctx, organizationId, { user }),
    findBetterAuthMember(ctx, organizationId, user.authUserId),
  ]);

  const viewerRole = deriveViewerRole({
    isSiteAdmin: user.isSiteAdmin,
    membershipRole: access.view ? viewerMembership?.role : null,
  });

  return {
    user,
    organization,
    access,
    viewerMembership,
    viewerRole,
  } satisfies OrganizationAccessContext;
}

async function getOrganizationAccessContextById(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const organization = await findBetterAuthOrganizationById(ctx, organizationId);
  if (!organization) {
    return null;
  }

  const [access, viewerMembership] = await Promise.all([
    checkOrganizationAccess(ctx, organizationId, { user }),
    findBetterAuthMember(ctx, organizationId, user.authUserId),
  ]);

  const viewerRole = deriveViewerRole({
    isSiteAdmin: user.isSiteAdmin,
    membershipRole: access.view ? viewerMembership?.role : null,
  });

  return {
    user,
    organization,
    access,
    viewerMembership,
    viewerRole,
  } satisfies OrganizationAccessContextForWrite;
}

async function getVerifiedOrganizationDomains(ctx: QueryCtx | MutationCtx, organizationId: string) {
  const domains = await ctx.db
    .query('organizationDomains')
    .withIndex('by_organization_id', (q) => q.eq('organizationId', organizationId))
    .collect();

  return domains.filter((domain) => domain.status === 'verified');
}

async function getOrganizationSeatUsage(ctx: QueryCtx | MutationCtx, organizationId: string) {
  const [memberships, invitations] = await Promise.all([
    listOrganizationMembers(ctx, organizationId),
    fetchBetterAuthInvitationsByOrganizationId(ctx, organizationId),
  ]);
  const membershipStatuses = await getMembershipStatusMap(ctx, memberships);

  return {
    activeMembers: memberships.filter(
      (membership) => (membershipStatuses.get(membership._id) ?? 'active') === 'active',
    ).length,
    pendingInvites: invitations.filter((invitation) => invitation.status === 'pending').length,
  };
}

async function evaluateOrganizationInvitePolicy(
  ctx: QueryCtx,
  input: {
    email?: string;
    organizationId: string;
    resend?: boolean;
    viewerRole: OrganizationViewerRole;
  },
) {
  const policies = await getOrganizationPolicies(ctx, input.organizationId);

  if (input.viewerRole === 'site-admin') {
    return { allowed: true as const, policies };
  }

  if (!canInviteUnderPolicy(input.viewerRole, policies.invitePolicy)) {
    return {
      allowed: false as const,
      policies,
      reason:
        policies.invitePolicy === 'owners_only'
          ? 'Only organization owners can invite members'
          : 'Organization admin access required',
    };
  }

  if (policies.verifiedDomainsOnly) {
    if (!input.email) {
      return {
        allowed: false as const,
        policies,
        reason: 'Invite email is required',
      };
    }

    const normalizedDomain = normalizeOrganizationEmailDomain(input.email);
    const verifiedDomains = await getVerifiedOrganizationDomains(ctx, input.organizationId);
    if (!verifiedDomains.some((domain) => domain.normalizedDomain === normalizedDomain)) {
      return {
        allowed: false as const,
        policies,
        reason: 'Invites must use a verified organization domain',
      };
    }
  }

  if (policies.memberCap !== null) {
    const { activeMembers, pendingInvites } = await getOrganizationSeatUsage(
      ctx,
      input.organizationId,
    );
    const totalSeats = activeMembers + pendingInvites;

    if (!input.resend && totalSeats >= policies.memberCap) {
      return {
        allowed: false as const,
        policies,
        reason: `Organization member cap reached (${policies.memberCap})`,
      };
    }
  }

  return { allowed: true as const, policies };
}

function compareValues(
  left: string | number,
  right: string | number,
  direction: OrganizationDirectorySortDirection,
) {
  if (left === right) {
    return 0;
  }

  if (direction === 'asc') {
    return left > right ? 1 : -1;
  }

  return left < right ? 1 : -1;
}

function sortValue(
  row: OrganizationDirectoryRow,
  field: OrganizationDirectorySortField,
): string | number {
  switch (field) {
    case 'name':
      return row.name?.toLowerCase() ?? '';
    case 'email':
      return row.email.toLowerCase();
    case 'kind':
      return row.kind;
    case 'role':
      return row.role;
    case 'status':
      return row.status;
    default:
      return row.createdAt;
  }
}

export const getOrganizationDomainInternal = internalQuery({
  args: {
    domainId: v.id('organizationDomains'),
  },
  returns: v.union(organizationDomainDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.domainId);
  },
});

export const setOrganizationDomainVerifiedInternal = internalMutation({
  args: {
    domainId: v.id('organizationDomains'),
    verifiedAt: v.number(),
  },
  returns: organizationDomainValidator,
  handler: async (ctx, args) => {
    const domain = await ctx.db.get(args.domainId);
    if (!domain) {
      throw new Error('Domain not found');
    }

    await ctx.db.patch(args.domainId, {
      status: 'verified',
      verifiedAt: args.verifiedAt,
    });

    return toOrganizationDomain({
      ...domain,
      status: 'verified',
      verifiedAt: args.verifiedAt,
    });
  },
});

export const listOrganizationsForDirectory = query({
  args: {},
  returns: v.array(directoryOrganizationValidator),
  handler: async (ctx) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);

    if (user.isSiteAdmin) {
      const organizations = await fetchAllBetterAuthOrganizations(ctx);

      return organizations
        .map((organization) => ({
          id: organization._id ?? organization.id ?? '',
          slug: organization.slug,
          name: organization.name,
          logo: organization.logo ?? null,
          viewerRole: 'site-admin' as const,
          canManage: true,
          isSiteAdminView: true,
        }))
        .filter((organization) => organization.id.length > 0)
        .sort((left, right) => left.name.localeCompare(right.name));
    }

    const memberships = await listOrganizationMembersForUser(ctx, user.authUserId);
    const membershipStatuses = await getMembershipStatusMap(ctx, memberships);
    const organizations = await fetchBetterAuthOrganizationsByIds(
      ctx,
      memberships.map((membership) => membership.organizationId),
    );
    const organizationById = new Map(
      organizations.map((organization) => [
        organization._id ?? organization.id ?? '',
        organization,
      ]),
    );

    return memberships
      .map((membership) => {
        if ((membershipStatuses.get(membership._id) ?? 'active') !== 'active') {
          return null;
        }

        const organization = organizationById.get(membership.organizationId);
        if (!organization) {
          return null;
        }

        return {
          id: organization._id ?? membership.organizationId,
          slug: organization.slug,
          name: organization.name,
          logo: organization.logo ?? null,
          viewerRole: normalizeOrganizationRole(membership.role),
          canManage: membership.role === 'owner' || membership.role === 'admin',
          isSiteAdminView: false,
        };
      })
      .filter(
        (organization): organization is NonNullable<typeof organization> => organization !== null,
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const getOrganizationCreationEligibility = query({
  args: {},
  returns: organizationCreationEligibilityValidator,
  handler: async (ctx) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);

    if (user.isSiteAdmin) {
      const memberships = await listOrganizationMembersForUser(ctx, user.authUserId);
      const membershipStatuses = await getMembershipStatusMap(ctx, memberships);
      return {
        count: memberships.filter(
          (membership) => (membershipStatuses.get(membership._id) ?? 'active') === 'active',
        ).length,
        limit: null,
        canCreate: true,
        reason: null,
        isUnlimited: true,
      };
    }

    const memberships = await listOrganizationMembersForUser(ctx, user.authUserId);
    const membershipStatuses = await getMembershipStatusMap(ctx, memberships);
    const count = memberships.filter(
      (membership) => (membershipStatuses.get(membership._id) ?? 'active') === 'active',
    ).length;
    const canCreate = count < SELF_SERVE_ORGANIZATION_LIMIT;

    return {
      count,
      limit: SELF_SERVE_ORGANIZATION_LIMIT,
      canCreate,
      reason: canCreate
        ? null
        : `You can belong to up to ${SELF_SERVE_ORGANIZATION_LIMIT} organizations.`,
      isUnlimited: false,
    };
  },
});

export const getOrganizationSettings = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(organizationSettingsValidator, v.null()),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view) {
      return null;
    }

    const organizationId = context.organization._id ?? context.organization.id;
    const ownerCount =
      organizationId && context.viewerMembership
        ? await countActiveOwners(ctx, await listOrganizationMembers(ctx, organizationId))
        : 0;
    const policies = await getOrganizationPolicies(ctx, organizationId);
    const enterpriseAuth = await getOrganizationEnterpriseAuthSummary(
      ctx,
      organizationId,
      policies,
    );
    const capabilities = buildOrganizationCapabilities({
      ownerCount,
      policies,
      viewerMembership: context.viewerMembership,
      viewerRole: context.viewerRole,
    });

    return {
      organization: {
        id: context.organization._id ?? context.organization.id ?? '',
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      policies,
      enterpriseAuth,
      availableEnterpriseProviders: getAvailableEnterpriseProviders(),
      access: context.access,
      capabilities,
      isMember: context.viewerMembership !== null,
      viewerRole: context.viewerRole,
      canManage: capabilities.canManageMembers || capabilities.canUpdateSettings,
    };
  },
});

export const getOrganizationEnterpriseAuthSettings = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(organizationSettingsValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.runQuery(anyApi.organizationManagement.getOrganizationSettings, args);
  },
});

export const getOrganizationEnterpriseAccess = query({
  args: {
    organizationId: v.string(),
  },
  returns: organizationEnterpriseAccessResultValidator,
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    return await getOrganizationEnterpriseAccessForUser(ctx, {
      organizationId: args.organizationId,
      user,
    });
  },
});

export const resolveOrganizationEnterpriseAuthByEmail = query({
  args: {
    email: v.string(),
  },
  returns: organizationEnterpriseAuthResolutionResultValidator,
  handler: async (ctx, args) => {
    const emailDomain = normalizeEmailDomain(args.email);
    if (!emailDomain) {
      return null;
    }

    const domainRecord = await ctx.db
      .query('organizationDomains')
      .withIndex('by_normalized_domain', (q) => q.eq('normalizedDomain', emailDomain))
      .first();
    if (!domainRecord || domainRecord.status !== 'verified') {
      return null;
    }

    const organization = await findBetterAuthOrganizationById(ctx, domainRecord.organizationId);
    if (!organization) {
      return null;
    }

    const policies = await getOrganizationPolicies(ctx, domainRecord.organizationId);
    if (!policies.enterpriseProviderKey || !policies.enterpriseProtocol) {
      return null;
    }

    const enterpriseAuth = await getOrganizationEnterpriseAuthSummary(
      ctx,
      domainRecord.organizationId,
      policies,
    );
    if (!enterpriseAuth) {
      return null;
    }

    return {
      organizationId: domainRecord.organizationId,
      organizationSlug: organization.slug,
      organizationName: organization.name,
      providerKey: enterpriseAuth.providerKey,
      providerLabel: enterpriseAuth.providerLabel,
      providerStatus: enterpriseAuth.providerStatus,
      protocol: enterpriseAuth.protocol,
      enterpriseAuthMode: policies.enterpriseAuthMode,
      managedDomain: emailDomain,
      verifiedDomains: enterpriseAuth.managedDomains,
      canUsePasswordFallback:
        policies.enterpriseAuthMode !== 'required' || policies.allowBreakGlassPasswordLogin,
    };
  },
});

export const updateOrganizationPolicies = mutation({
  args: {
    organizationId: v.string(),
    invitePolicy: organizationInvitePolicyValidator,
    verifiedDomainsOnly: v.boolean(),
    memberCap: v.union(v.number(), v.null()),
    mfaRequired: v.boolean(),
    auditExportRequiresStepUp: v.boolean(),
    attachmentSharingAllowed: v.boolean(),
    dataRetentionDays: v.number(),
    enterpriseAuthMode: v.union(v.literal('off'), v.literal('optional'), v.literal('required')),
    enterpriseProviderKey: v.union(
      v.literal('google-workspace'),
      v.literal('entra'),
      v.literal('okta'),
      v.null(),
    ),
    enterpriseProtocol: v.union(v.literal('oidc'), v.null()),
    allowBreakGlassPasswordLogin: v.boolean(),
    temporaryLinkTtlMinutes: v.number(),
    webSearchAllowed: v.boolean(),
  },
  returns: v.object({
    success: v.literal(true),
    policies: v.object({
      invitePolicy: organizationInvitePolicyValidator,
      verifiedDomainsOnly: v.boolean(),
      memberCap: v.union(v.number(), v.null()),
      mfaRequired: v.boolean(),
      auditExportRequiresStepUp: v.boolean(),
      attachmentSharingAllowed: v.boolean(),
      dataRetentionDays: v.number(),
      enterpriseAuthMode: v.union(v.literal('off'), v.literal('optional'), v.literal('required')),
      enterpriseProviderKey: v.union(
        v.literal('google-workspace'),
        v.literal('entra'),
        v.literal('okta'),
        v.null(),
      ),
      enterpriseProtocol: v.union(v.literal('oidc'), v.null()),
      enterpriseEnabledAt: v.union(v.number(), v.null()),
      enterpriseEnforcedAt: v.union(v.number(), v.null()),
      allowBreakGlassPasswordLogin: v.boolean(),
      temporaryLinkTtlMinutes: v.number(),
      webSearchAllowed: v.boolean(),
    }),
  }),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextById(ctx, args.organizationId);
    if (!context || !context.access.view) {
      throwConvexError('NOT_FOUND', 'Organization not found');
    }

    if (!canManageOrganizationPolicies(context.viewerRole)) {
      throwConvexError('FORBIDDEN', 'Organization owner access required');
    }

    if (args.memberCap !== null && args.memberCap < 1) {
      throwConvexError('VALIDATION', 'Member cap must be at least 1');
    }

    if (args.dataRetentionDays < 1) {
      throwConvexError('VALIDATION', 'Data retention must be at least 1 day');
    }

    if (args.temporaryLinkTtlMinutes < 1) {
      throwConvexError('VALIDATION', 'Temporary link TTL must be at least 1 minute');
    }

    if (
      args.enterpriseAuthMode !== 'off' &&
      (!args.enterpriseProviderKey || !args.enterpriseProtocol)
    ) {
      throwConvexError(
        'VALIDATION',
        'Select an enterprise provider before enabling enterprise sign-in policy',
      );
    }

    if (
      args.enterpriseProviderKey &&
      args.enterpriseProviderKey !== GOOGLE_WORKSPACE_PROVIDER_KEY
    ) {
      throwConvexError('VALIDATION', 'Only Google Workspace enterprise auth is available today');
    }

    if (
      args.enterpriseProviderKey === GOOGLE_WORKSPACE_PROVIDER_KEY &&
      !isGoogleWorkspaceOAuthConfigured()
    ) {
      throwConvexError(
        'VALIDATION',
        'Google Workspace enterprise auth is not configured for this deployment',
      );
    }

    if (args.enterpriseAuthMode === 'required') {
      const verifiedDomains = await getOrganizationVerifiedDomains(ctx, args.organizationId);
      if (verifiedDomains.length === 0) {
        throwConvexError(
          'VALIDATION',
          'Verify at least one organization domain before requiring enterprise sign-in',
        );
      }
    }

    const currentPolicies = await getOrganizationPolicies(ctx, args.organizationId);
    const now = Date.now();
    const nextPolicies = applyAlwaysOnRegulatedBaseline({
      invitePolicy: args.invitePolicy,
      verifiedDomainsOnly: args.verifiedDomainsOnly,
      memberCap: args.memberCap,
      mfaRequired: args.mfaRequired,
      auditExportRequiresStepUp: args.auditExportRequiresStepUp,
      attachmentSharingAllowed: args.attachmentSharingAllowed,
      dataRetentionDays: args.dataRetentionDays,
      enterpriseAuthMode: args.enterpriseAuthMode,
      enterpriseProviderKey: args.enterpriseProviderKey,
      enterpriseProtocol: args.enterpriseProtocol,
      enterpriseEnabledAt:
        args.enterpriseAuthMode === 'off' ? null : (currentPolicies.enterpriseEnabledAt ?? now),
      enterpriseEnforcedAt:
        args.enterpriseAuthMode === 'required'
          ? (currentPolicies.enterpriseEnforcedAt ?? now)
          : null,
      allowBreakGlassPasswordLogin: args.allowBreakGlassPasswordLogin,
      temporaryLinkTtlMinutes: args.temporaryLinkTtlMinutes,
      webSearchAllowed: args.webSearchAllowed,
    }) satisfies OrganizationPolicies;
    const changedKeys = (Object.keys(nextPolicies) as Array<keyof OrganizationPolicies>).filter(
      (key) => currentPolicies[key] !== nextPolicies[key],
    );
    const existing = await ctx.db
      .query('organizationPolicies')
      .withIndex('by_organization_id', (q) => q.eq('organizationId', args.organizationId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...nextPolicies,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('organizationPolicies', {
        organizationId: args.organizationId,
        ...nextPolicies,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: 'organization_policy_updated',
      organizationId: args.organizationId,
      userId: context.user.authUserId,
      actorUserId: context.user.authUserId,
      identifier: context.user.authUser.email?.toLowerCase(),
      outcome: 'success',
      severity: 'info',
      resourceType: 'organization_policy',
      resourceId: args.organizationId,
      resourceLabel: args.organizationId,
      sourceSurface: 'organization.policy_update',
      sessionId: context.user.authSession?.id ?? undefined,
      metadata: JSON.stringify({
        actorEmail: context.user.authUser.email ?? undefined,
        changedKeys,
        previousPolicies: currentPolicies,
        nextPolicies,
      }),
    });

    if (currentPolicies.enterpriseAuthMode !== nextPolicies.enterpriseAuthMode) {
      await ctx.runMutation(internal.audit.insertAuditLog, {
        eventType: 'enterprise_auth_mode_updated',
        organizationId: args.organizationId,
        userId: context.user.authUserId,
        actorUserId: context.user.authUserId,
        identifier: context.user.authUser.email?.toLowerCase(),
        outcome: 'success',
        severity: 'info',
        resourceType: 'organization_policy',
        resourceId: args.organizationId,
        resourceLabel: args.organizationId,
        sourceSurface: 'organization.policy_update',
        sessionId: context.user.authSession?.id ?? undefined,
        metadata: JSON.stringify({
          nextMode: nextPolicies.enterpriseAuthMode,
          previousMode: currentPolicies.enterpriseAuthMode,
          providerKey: nextPolicies.enterpriseProviderKey,
        }),
      });
    }

    return {
      success: true as const,
      policies: nextPolicies,
    };
  },
});

export const getOrganizationWriteAccess = query({
  args: {
    organizationId: v.string(),
    action: v.union(
      v.literal('invite'),
      v.literal('update-member-role'),
      v.literal('remove-member'),
      v.literal('suspend-member'),
      v.literal('deactivate-member'),
      v.literal('reactivate-member'),
      v.literal('cancel-invitation'),
      v.literal('update-settings'),
      v.literal('delete-organization'),
    ),
    membershipId: v.optional(v.string()),
    nextRole: v.optional(v.union(v.literal('owner'), v.literal('admin'), v.literal('member'))),
    email: v.optional(v.string()),
    resend: v.optional(v.boolean()),
  },
  returns: allowedResultValidator,
  handler: async (ctx, args) => {
    const organization = await findBetterAuthOrganizationById(ctx, args.organizationId);
    if (!organization) {
      return {
        allowed: false as const,
        reason: 'Organization not found',
      };
    }

    const user = await getVerifiedCurrentUserOrThrow(ctx);
    const [_access, viewerMembership] = await Promise.all([
      checkOrganizationAccess(ctx, args.organizationId, { user }),
      findBetterAuthMember(ctx, args.organizationId, user.authUserId),
    ]);

    const viewerRole = deriveViewerRole({
      isSiteAdmin: user.isSiteAdmin,
      membershipRole: _access.view ? viewerMembership?.role : null,
    });
    if (args.action === 'invite') {
      const availableInviteRoles = getAvailableInviteRoles(viewerRole);
      if (availableInviteRoles.length === 0) {
        return {
          allowed: false as const,
          reason: 'Organization admin access required',
        };
      }

      if (args.nextRole && !availableInviteRoles.includes(args.nextRole)) {
        return {
          allowed: false as const,
          reason: 'You cannot assign that organization role',
        };
      }

      const policyAccess = await evaluateOrganizationInvitePolicy(ctx, {
        organizationId: args.organizationId,
        viewerRole,
        email: args.email,
        resend: args.resend,
      });

      return policyAccess.allowed
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: policyAccess.reason,
          };
    }

    if (args.action === 'cancel-invitation' || args.action === 'update-settings') {
      return canManageOrganization(viewerRole)
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: 'Organization admin access required',
          };
    }

    if (args.action === 'delete-organization') {
      return canDeleteOrganization(viewerRole)
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: 'Organization owner access required',
          };
    }

    if (!args.membershipId) {
      return {
        allowed: false as const,
        reason: 'Organization member not found',
      };
    }

    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      return {
        allowed: false as const,
        reason: 'Organization member not found',
      };
    }

    const currentRole = normalizeOrganizationRole(membership.role);
    const currentStatus = await getOrganizationMembershipStatus(ctx, membership._id);
    const ownerCount = await countActiveOwners(ctx, memberships);

    if (args.action === 'remove-member') {
      return canRemoveMember(
        viewerRole,
        currentRole,
        membership.userId === user.authUserId,
        ownerCount,
      )
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: 'Not authorized to remove this member',
          };
    }

    if (
      args.action === 'suspend-member' ||
      args.action === 'deactivate-member' ||
      args.action === 'reactivate-member'
    ) {
      const memberStateAccess = canManageMemberState(
        viewerRole,
        currentRole,
        currentStatus,
        membership.userId === user.authUserId,
        ownerCount,
      );

      const allowed =
        (args.action === 'suspend-member' && memberStateAccess.canSuspend) ||
        (args.action === 'deactivate-member' && memberStateAccess.canDeactivate) ||
        (args.action === 'reactivate-member' && memberStateAccess.canReactivate);

      return allowed
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: `Not authorized to ${args.action.replace('-', ' ')} this member`,
          };
    }

    const availableRoles = getAssignableRoles(viewerRole, currentRole, ownerCount);

    if (
      canChangeMemberRole(
        viewerRole,
        currentRole,
        currentStatus,
        availableRoles,
        membership.userId === user.authUserId,
      ) &&
      args.nextRole &&
      availableRoles.includes(args.nextRole)
    ) {
      return { allowed: true as const };
    }

    return {
      allowed: false as const,
      reason: 'Not authorized to change this member role',
    };
  },
});

export const getOrganizationMemberJoinAccess = query({
  args: {
    organizationId: v.string(),
  },
  returns: allowedResultValidator,
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    const policies = await getOrganizationPolicies(ctx, args.organizationId);
    const authUser = (await fetchBetterAuthUsersByIds(ctx, [user.authUserId]))[0];
    const hasPasskey =
      authUser?.twoFactorEnabled === true ? false : await userHasPasskey(ctx, user.authUserId);

    if (policies.mfaRequired && authUser?.twoFactorEnabled !== true && !hasPasskey) {
      return {
        allowed: false as const,
        reason: 'Multi-factor authentication is required to join this organization',
      };
    }

    return {
      allowed: true as const,
    };
  },
});

export const listOrganizationDirectory = query({
  args: {
    slug: v.string(),
    asOf: v.number(),
    page: v.number(),
    pageSize: v.number(),
    sortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('kind'),
      v.literal('role'),
      v.literal('status'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    secondarySortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('kind'),
      v.literal('role'),
      v.literal('status'),
      v.literal('createdAt'),
    ),
    secondarySortOrder: v.union(v.literal('asc'), v.literal('desc')),
    search: v.string(),
    kind: v.union(v.literal('all'), v.literal('member'), v.literal('invite')),
  },
  returns: v.union(organizationDirectoryResponseValidator, v.null()),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view || !canManageOrganization(context.viewerRole)) {
      return null;
    }

    const organizationId = context.organization._id ?? context.organization.id;
    if (!organizationId) {
      throw new Error('Organization is missing an id');
    }

    const [memberships, invitations] = await Promise.all([
      listOrganizationMembers(ctx, organizationId),
      fetchBetterAuthInvitationsByOrganizationId(ctx, organizationId),
    ]);
    const membershipStatuses = await getMembershipStatusMap(ctx, memberships);
    const ownerCount = await countActiveOwners(ctx, memberships);
    const policies = await getOrganizationPolicies(ctx, organizationId);
    const enterpriseAccess = await getOrganizationEnterpriseAccessForUser(ctx, {
      organizationId,
      user: context.user,
      policies,
    });
    if (!enterpriseAccess.allowed) {
      return null;
    }
    const capabilities = buildOrganizationCapabilities({
      ownerCount,
      policies,
      viewerMembership: context.viewerMembership,
      viewerRole: context.viewerRole,
    });
    const invitationRows: OrganizationInvitationRow[] = invitations
      .filter((invitation) => invitation.status === 'pending')
      .map(
        (invitation) =>
          ({
            id: `invite:${invitation._id ?? invitation.id ?? invitation.email}`,
            kind: 'invite',
            invitationId: invitation._id ?? invitation.id ?? '',
            name: null,
            email: invitation.email,
            role: normalizeOrganizationRole(invitation.role),
            status: isInvitationExpired(invitation.expiresAt, args.asOf) ? 'expired' : 'pending',
            createdAt: toTimestamp(invitation.createdAt),
            expiresAt: toTimestamp(invitation.expiresAt),
            canRevoke: capabilities.canInvite,
          }) satisfies OrganizationInvitationRow,
      )
      .filter((invitation) => invitation.invitationId.length > 0);

    const searchValue = args.search.trim().toLowerCase();
    const inviteCount = invitationRows.length;
    const shouldIncludeInvites = args.kind === 'all' || args.kind === 'invite';
    const shouldIncludeMembers = args.kind === 'all' || args.kind === 'member';
    const needsAllMembersHydrated =
      shouldIncludeMembers &&
      (args.kind === 'all' ||
        searchValue.length > 0 ||
        args.sortBy === 'name' ||
        args.sortBy === 'email' ||
        args.secondarySortBy === 'name' ||
        args.secondarySortBy === 'email');

    let memberRows: OrganizationMemberRow[] = [];
    let memberCount = memberships.length;

    if (needsAllMembersHydrated) {
      const authUsers = await fetchBetterAuthUsersByIds(
        ctx,
        memberships.map((membership) => membership.userId),
      );
      const authUsersById = new Map(
        authUsers.map((authUser) => [(authUser.id ?? authUser._id) as string, authUser]),
      );

      memberRows = memberships.map((membership) => {
        const authUser = authUsersById.get(membership.userId);
        const role = normalizeOrganizationRole(membership.role);
        const status = membershipStatuses.get(membership._id) ?? 'active';
        const availableRoles = getAssignableRoles(context.viewerRole, role, ownerCount);
        const memberStateActions = canManageMemberState(
          context.viewerRole,
          role,
          status,
          membership.userId === context.user.authUserId,
          ownerCount,
        );

        return {
          id: `member:${membership._id ?? membership.userId}`,
          kind: 'member',
          membershipId: membership._id ?? '',
          authUserId: membership.userId,
          name: authUser?.name ?? null,
          email: authUser?.email ?? '',
          role,
          status,
          createdAt: toTimestamp(membership.createdAt),
          isSiteAdmin: authUser ? deriveIsSiteAdmin(normalizeUserRole(authUser.role)) : false,
          availableRoles,
          canChangeRole: canChangeMemberRole(
            context.viewerRole,
            role,
            status,
            availableRoles,
            membership.userId === context.user.authUserId,
          ),
          canRemove: canRemoveMember(
            context.viewerRole,
            role,
            membership.userId === context.user.authUserId,
            ownerCount,
          ),
          canSuspend: memberStateActions.canSuspend,
          canDeactivate: memberStateActions.canDeactivate,
          canReactivate: memberStateActions.canReactivate,
        };
      });
    } else if (shouldIncludeMembers) {
      const lightweightMemberRows = sortOrganizationDirectoryRows(
        memberships.map((membership) => {
          const role = normalizeOrganizationRole(membership.role);
          const status = membershipStatuses.get(membership._id) ?? 'active';
          const availableRoles = getAssignableRoles(context.viewerRole, role, ownerCount);
          const memberStateActions = canManageMemberState(
            context.viewerRole,
            role,
            status,
            membership.userId === context.user.authUserId,
            ownerCount,
          );

          return {
            id: `member:${membership._id ?? membership.userId}`,
            kind: 'member' as const,
            membershipId: membership._id ?? '',
            authUserId: membership.userId,
            name: null,
            email: '',
            role,
            status,
            createdAt: toTimestamp(membership.createdAt),
            isSiteAdmin: false,
            availableRoles,
            canChangeRole: canChangeMemberRole(
              context.viewerRole,
              role,
              status,
              availableRoles,
              membership.userId === context.user.authUserId,
            ),
            canRemove: canRemoveMember(
              context.viewerRole,
              role,
              membership.userId === context.user.authUserId,
              ownerCount,
            ),
            canSuspend: memberStateActions.canSuspend,
            canDeactivate: memberStateActions.canDeactivate,
            canReactivate: memberStateActions.canReactivate,
          };
        }),
        args,
      );

      memberCount = lightweightMemberRows.length;

      const combinedRows = shouldIncludeInvites
        ? sortOrganizationDirectoryRows([...lightweightMemberRows, ...invitationRows], args)
        : lightweightMemberRows;
      const filteredRows =
        searchValue.length > 0
          ? combinedRows.filter((row) => matchesOrganizationDirectorySearch(row, searchValue))
          : combinedRows;
      const total = filteredRows.length;
      const start = Math.max(0, (args.page - 1) * args.pageSize);
      const end = start + args.pageSize;
      const pagedMemberIds = filteredRows
        .slice(start, end)
        .filter((row): row is OrganizationMemberRow => row.kind === 'member')
        .map((row) => row.authUserId);
      const authUsers = await fetchBetterAuthUsersByIds(ctx, pagedMemberIds);
      const authUsersById = new Map(
        authUsers.map((authUser) => [(authUser.id ?? authUser._id) as string, authUser]),
      );
      const hydratedRows = filteredRows.slice(start, end).map((row) => {
        if (row.kind !== 'member') {
          return row;
        }

        const authUser = authUsersById.get(row.authUserId);
        return {
          ...row,
          name: authUser?.name ?? null,
          email: authUser?.email ?? '',
          isSiteAdmin: authUser ? deriveIsSiteAdmin(normalizeUserRole(authUser.role)) : false,
        } satisfies OrganizationMemberRow;
      });

      return {
        organization: {
          id: organizationId,
          slug: context.organization.slug,
          name: context.organization.name,
          logo: context.organization.logo ?? null,
        },
        policies,
        access: context.access,
        capabilities,
        viewerRole: context.viewerRole,
        rows: hydratedRows,
        counts: {
          members: memberCount,
          invites: inviteCount,
        },
        pagination: {
          page: args.page,
          pageSize: args.pageSize,
          total,
          totalPages: Math.ceil(total / args.pageSize),
        },
      };
    }

    let rows: OrganizationDirectoryRow[] = [
      ...(shouldIncludeMembers ? memberRows : []),
      ...(shouldIncludeInvites ? invitationRows : []),
    ];

    if (searchValue.length > 0) {
      rows = rows.filter((row) => matchesOrganizationDirectorySearch(row, searchValue));
    }

    rows = sortOrganizationDirectoryRows(rows, args);

    const total = rows.length;
    const start = Math.max(0, (args.page - 1) * args.pageSize);
    const end = start + args.pageSize;

    return {
      organization: {
        id: organizationId,
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      policies,
      access: context.access,
      capabilities,
      viewerRole: context.viewerRole,
      rows: rows.slice(start, end),
      counts: {
        members: memberCount,
        invites: inviteCount,
      },
      pagination: {
        page: args.page,
        pageSize: args.pageSize,
        total,
        totalPages: Math.ceil(total / args.pageSize),
      },
    };
  },
});

export const listOrganizationDomains = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(organizationDomainsResponseValidator, v.null()),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view) {
      return null;
    }

    const organizationId = context.organization._id ?? context.organization.id;
    if (!organizationId) {
      throw new Error('Organization is missing an id');
    }

    const ownerCount = context.viewerMembership
      ? await countActiveOwners(ctx, await listOrganizationMembers(ctx, organizationId))
      : 0;
    const policies = await getOrganizationPolicies(ctx, organizationId);
    const enterpriseAccess = await getOrganizationEnterpriseAccessForUser(ctx, {
      organizationId,
      user: context.user,
      policies,
    });
    if (!enterpriseAccess.allowed) {
      return null;
    }
    const capabilities = buildOrganizationCapabilities({
      ownerCount,
      policies,
      viewerMembership: context.viewerMembership,
      viewerRole: context.viewerRole,
    });
    const enterpriseAuth = await getOrganizationEnterpriseAuthSummary(
      ctx,
      organizationId,
      policies,
    );
    const domains = await ctx.db
      .query('organizationDomains')
      .withIndex('by_organization_id_and_created_at', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .collect();

    return {
      organization: {
        id: organizationId,
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      enterpriseAuth,
      capabilities: {
        canManageDomains: capabilities.canManageDomains,
        canViewAudit: capabilities.canViewAudit,
      },
      domains: domains.map(toOrganizationDomain),
    };
  },
});

export const addOrganizationDomain = mutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  returns: organizationDomainValidator,
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextById(ctx, args.organizationId);
    if (!context || !context.access.view) {
      throwConvexError('NOT_FOUND', 'Organization not found');
    }

    if (!canManageDomains(context.viewerRole)) {
      throwConvexError('FORBIDDEN', 'Organization owner access required');
    }

    const normalizedDomain = normalizeOrganizationDomain(args.domain);
    const existing = await ctx.db
      .query('organizationDomains')
      .withIndex('by_normalized_domain', (q) => q.eq('normalizedDomain', normalizedDomain))
      .first();

    if (existing) {
      throwConvexError(
        'VALIDATION',
        existing.organizationId === args.organizationId
          ? 'That domain is already added to this organization'
          : 'That domain is already claimed by another organization',
      );
    }

    const token = createOrganizationDomainVerificationToken();
    const domainId = await ctx.db.insert('organizationDomains', {
      organizationId: args.organizationId,
      domain: normalizedDomain,
      normalizedDomain,
      status: 'pending_verification',
      verificationMethod: 'dns_txt',
      verificationToken: token,
      verifiedAt: null,
      createdByUserId: context.user.authUserId,
      createdAt: Date.now(),
    });

    const domain = await ctx.db.get(domainId);
    if (!domain) {
      throw new Error('Failed to create organization domain');
    }

    await insertOrganizationAuditLog(ctx, {
      eventType: 'domain_added',
      organizationId: args.organizationId,
      userId: context.user.authUserId,
      metadata: {
        domain: normalizedDomain,
        domainId,
      },
    });

    return toOrganizationDomain(domain);
  },
});

export const removeOrganizationDomain = mutation({
  args: {
    organizationId: v.string(),
    domainId: v.id('organizationDomains'),
  },
  returns: v.object({
    success: v.literal(true),
  }),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextById(ctx, args.organizationId);
    if (!context || !context.access.view) {
      throwConvexError('NOT_FOUND', 'Organization not found');
    }

    if (!canManageDomains(context.viewerRole)) {
      throwConvexError('FORBIDDEN', 'Organization owner access required');
    }

    const domain = await ctx.db.get(args.domainId);
    if (!domain || domain.organizationId !== args.organizationId) {
      throwConvexError('NOT_FOUND', 'Organization domain not found');
    }

    await ctx.db.delete(args.domainId);
    await insertOrganizationAuditLog(ctx, {
      eventType: 'domain_removed',
      organizationId: args.organizationId,
      userId: context.user.authUserId,
      metadata: {
        domain: domain.domain,
        domainId: args.domainId,
      },
    });
    return { success: true as const };
  },
});

export const regenerateOrganizationDomainToken = mutation({
  args: {
    organizationId: v.string(),
    domainId: v.id('organizationDomains'),
  },
  returns: organizationDomainValidator,
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextById(ctx, args.organizationId);
    if (!context || !context.access.view) {
      throwConvexError('NOT_FOUND', 'Organization not found');
    }

    if (!canManageDomains(context.viewerRole)) {
      throwConvexError('FORBIDDEN', 'Organization owner access required');
    }

    const domain = await ctx.db.get(args.domainId);
    if (!domain || domain.organizationId !== args.organizationId) {
      throwConvexError('NOT_FOUND', 'Organization domain not found');
    }

    const nextToken = createOrganizationDomainVerificationToken();
    await ctx.db.patch(args.domainId, {
      verificationToken: nextToken,
      status: 'pending_verification',
      verifiedAt: null,
    });

    await insertOrganizationAuditLog(ctx, {
      eventType: 'domain_verification_token_regenerated',
      organizationId: args.organizationId,
      userId: context.user.authUserId,
      metadata: {
        domain: domain.domain,
        domainId: args.domainId,
      },
    });

    return toOrganizationDomain({
      ...domain,
      verificationToken: nextToken,
      status: 'pending_verification',
      verifiedAt: null,
    });
  },
});

export const recordOrganizationBulkAuditEvents = mutation({
  args: {
    organizationId: v.string(),
    eventType: v.union(
      v.literal('bulk_invite_revoked'),
      v.literal('bulk_invite_resent'),
      v.literal('bulk_member_removed'),
    ),
    entries: v.array(
      v.object({
        targetId: v.string(),
        targetEmail: v.string(),
        targetRole: v.optional(
          v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
        ),
      }),
    ),
  },
  returns: v.object({
    success: v.literal(true),
  }),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextById(ctx, args.organizationId);
    if (!context || !context.access.view) {
      throwConvexError('NOT_FOUND', 'Organization not found');
    }

    if (!canManageOrganization(context.viewerRole)) {
      throwConvexError('FORBIDDEN', 'Organization admin access required');
    }

    await Promise.all(
      args.entries.map(async (entry) => {
        await ctx.runMutation(internal.audit.insertAuditLog, {
          eventType: args.eventType,
          organizationId: args.organizationId,
          userId: context.user.authUserId,
          identifier: entry.targetEmail.toLowerCase(),
          metadata: JSON.stringify({
            actorEmail: context.user.authUser.email ?? undefined,
            targetId: entry.targetId,
            targetEmail: entry.targetEmail,
            ...(entry.targetRole ? { targetRole: entry.targetRole } : {}),
          }),
        });
      }),
    );

    return {
      success: true as const,
    };
  },
});

async function changeOrganizationMemberStatus(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    membershipId: string;
    reason?: string | null;
    targetStatus: OrganizationMembershipStatus;
  },
) {
  const context = await getOrganizationAccessContextById(ctx, args.organizationId);
  if (!context || !context.access.view) {
    throwConvexError('NOT_FOUND', 'Organization not found');
  }

  const memberships = await listOrganizationMembers(ctx, args.organizationId);
  const membership = memberships.find((candidate) => candidate._id === args.membershipId);
  if (!membership) {
    throwConvexError('NOT_FOUND', 'Organization member not found');
  }

  const currentRole = normalizeOrganizationRole(membership.role);
  const currentStatus = await getOrganizationMembershipStatus(ctx, membership._id);
  const ownerCount = await countActiveOwners(ctx, memberships);
  const memberStateAccess = canManageMemberState(
    context.viewerRole,
    currentRole,
    currentStatus,
    membership.userId === context.user.authUserId,
    ownerCount,
  );

  if (args.targetStatus === 'active' && !memberStateAccess.canReactivate) {
    throwConvexError('FORBIDDEN', 'Not authorized to reactivate this member');
  }

  if (args.targetStatus === 'suspended' && !memberStateAccess.canSuspend) {
    throwConvexError('FORBIDDEN', 'Not authorized to suspend this member');
  }

  if (args.targetStatus === 'deactivated' && !memberStateAccess.canDeactivate) {
    throwConvexError('FORBIDDEN', 'Not authorized to deactivate this member');
  }

  if (args.targetStatus === currentStatus) {
    throwConvexError('VALIDATION', `Member is already ${currentStatus}`);
  }

  const targetUser = (await fetchBetterAuthUsersByIds(ctx, [membership.userId]))[0];
  const targetEmail = targetUser?.email ?? undefined;

  if (args.targetStatus === 'active') {
    await clearOrganizationMembershipState(ctx, {
      membership,
    });
  } else {
    await upsertOrganizationMembershipState(ctx, {
      membership,
      nextStatus: args.targetStatus,
      reason: args.reason,
      updatedByUserId: context.user.authUserId,
    });
  }

  const eventType =
    args.targetStatus === 'active'
      ? 'member_reactivated'
      : args.targetStatus === 'suspended'
        ? 'member_suspended'
        : 'member_deactivated';

  await ctx.runMutation(internal.audit.insertAuditLog, {
    eventType,
    organizationId: args.organizationId,
    userId: context.user.authUserId,
    identifier: targetEmail?.toLowerCase(),
    metadata: JSON.stringify({
      actorEmail: context.user.authUser.email ?? undefined,
      targetEmail,
      targetUserId: membership.userId,
      targetMembershipId: membership._id,
      targetRole: currentRole,
      previousStatus: currentStatus,
      nextStatus: args.targetStatus,
      reason: args.reason?.trim() ? args.reason.trim() : undefined,
    }),
  });

  return {
    success: true as const,
    status: args.targetStatus,
  };
}

export const suspendOrganizationMember = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
    reason: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    success: v.literal(true),
    status: organizationMemberStatusValidator,
  }),
  handler: async (ctx, args) =>
    await changeOrganizationMemberStatus(ctx, {
      ...args,
      targetStatus: 'suspended',
    }),
});

export const deactivateOrganizationMember = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
    reason: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    success: v.literal(true),
    status: organizationMemberStatusValidator,
  }),
  handler: async (ctx, args) =>
    await changeOrganizationMemberStatus(ctx, {
      ...args,
      targetStatus: 'deactivated',
    }),
});

export const reactivateOrganizationMember = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
  },
  returns: v.object({
    success: v.literal(true),
    status: organizationMemberStatusValidator,
  }),
  handler: async (ctx, args) =>
    await changeOrganizationMemberStatus(ctx, {
      ...args,
      targetStatus: 'active',
    }),
});

export const listOrganizationAuditEvents = query({
  args: {
    slug: v.string(),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    includeAllMatching: v.optional(v.boolean()),
    sortBy: v.optional(
      v.union(
        v.literal('label'),
        v.literal('identifier'),
        v.literal('userId'),
        v.literal('createdAt'),
      ),
    ),
    sortOrder: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
    preset: v.optional(v.union(v.literal('all'), v.literal('security'))),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    eventType: v.union(
      v.literal('all'),
      v.literal('organization_created'),
      v.literal('organization_updated'),
      v.literal('member_added'),
      v.literal('member_removed'),
      v.literal('member_role_updated'),
      v.literal('member_suspended'),
      v.literal('member_deactivated'),
      v.literal('member_reactivated'),
      v.literal('member_invited'),
      v.literal('invite_accepted'),
      v.literal('invite_rejected'),
      v.literal('invite_cancelled'),
      v.literal('domain_added'),
      v.literal('domain_verification_succeeded'),
      v.literal('domain_verification_failed'),
      v.literal('domain_verification_token_regenerated'),
      v.literal('domain_removed'),
      v.literal('organization_policy_updated'),
      v.literal('enterprise_auth_mode_updated'),
      v.literal('enterprise_login_succeeded'),
      v.literal('enterprise_scim_token_generated'),
      v.literal('enterprise_scim_token_deleted'),
      v.literal('scim_member_deprovisioned'),
      v.literal('scim_member_reactivated'),
      v.literal('scim_member_deprovision_failed'),
      v.literal('bulk_invite_revoked'),
      v.literal('bulk_invite_resent'),
      v.literal('bulk_member_removed'),
      v.literal('authorization_denied'),
      v.literal('admin_user_sessions_viewed'),
      v.literal('directory_exported'),
      v.literal('audit_log_exported'),
      v.literal('chat_thread_created'),
      v.literal('chat_thread_deleted'),
      v.literal('chat_attachment_uploaded'),
      v.literal('chat_attachment_scan_passed'),
      v.literal('chat_attachment_scan_failed'),
      v.literal('chat_attachment_quarantined'),
      v.literal('chat_attachment_deleted'),
      v.literal('attachment_access_url_issued'),
      v.literal('pdf_parse_requested'),
      v.literal('pdf_parse_succeeded'),
      v.literal('pdf_parse_failed'),
      v.literal('chat_run_completed'),
      v.literal('chat_run_failed'),
      v.literal('chat_web_search_used'),
      v.literal('audit_integrity_check_failed'),
    ),
    search: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    failuresOnly: v.optional(v.boolean()),
  },
  returns: v.union(organizationAuditResponseValidator, v.null()),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view) {
      return null;
    }

    const organizationId = context.organization._id ?? context.organization.id;
    if (!organizationId) {
      throw new Error('Organization is missing an id');
    }

    const ownerCount = context.viewerMembership
      ? await countActiveOwners(ctx, await listOrganizationMembers(ctx, organizationId))
      : 0;
    const policies = await getOrganizationPolicies(ctx, organizationId);
    const enterpriseAccess = await getOrganizationEnterpriseAccessForUser(ctx, {
      organizationId,
      user: context.user,
      policies,
    });
    if (!enterpriseAccess.allowed) {
      return null;
    }
    const capabilities = buildOrganizationCapabilities({
      ownerCount,
      policies,
      viewerMembership: context.viewerMembership,
      viewerRole: context.viewerRole,
    });

    if (!capabilities.canViewAudit) {
      return null;
    }

    const requestedEventType = args.eventType === 'all' ? null : args.eventType;
    const preset = args.preset ?? 'all';
    const searchValue = args.search.trim().toLowerCase();
    const searchStrategy = getAuditSearchStrategy(searchValue);
    const parsedStartDate = parseAuditDateBoundary(args.startDate, 'start');
    const parsedEndDate = parseAuditDateBoundary(args.endDate, 'end');
    const startCreatedAt =
      parsedStartDate !== null && parsedEndDate !== null
        ? Math.min(parsedStartDate, parsedEndDate)
        : parsedStartDate;
    const endCreatedAt =
      parsedStartDate !== null && parsedEndDate !== null
        ? Math.max(parsedStartDate, parsedEndDate)
        : parsedEndDate;
    const failuresOnly = args.failuresOnly ?? false;
    const sortBy = args.sortBy ?? 'createdAt';
    const sortOrder = args.sortOrder ?? 'desc';
    const pageSize = Math.max(1, Math.min(args.pageSize ?? args.limit ?? 10, 100));
    const page = Math.max(1, args.page ?? 1);
    const targetStart = (page - 1) * pageSize;
    const targetEnd = targetStart + pageSize;
    const includeAllMatching = args.includeAllMatching ?? false;
    const matchedEvents: Array<ReturnType<typeof toOrganizationAuditEventViewModel>> = [];
    let total = 0;
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const auditPage: PaginationResult<Doc<'auditLogs'>> = await collectOrganizationAuditPage(
        ctx,
        {
          organizationId,
          requestedEventType,
          searchStrategy,
          sortOrder,
          cursor,
          numItems: 100,
        },
      );

      for (const event of auditPage.page) {
        if (!ORGANIZATION_AUDIT_EVENT_TYPES.has(event.eventType)) {
          continue;
        }

        if (event.organizationId !== organizationId) {
          continue;
        }

        if (requestedEventType && event.eventType !== requestedEventType) {
          continue;
        }

        if (
          preset === 'security' &&
          !ORGANIZATION_AUDIT_SECURITY_EVENT_TYPES.has(event.eventType)
        ) {
          continue;
        }

        if (startCreatedAt !== null && event.createdAt < startCreatedAt) {
          continue;
        }

        if (endCreatedAt !== null && event.createdAt > endCreatedAt) {
          continue;
        }

        if (failuresOnly && !ORGANIZATION_AUDIT_FAILURE_EVENT_TYPES.has(event.eventType)) {
          continue;
        }

        const eventViewModel = toOrganizationAuditEventViewModel(event);

        if (
          searchValue.length > 0 &&
          !auditEventMatchesSearch(
            {
              label: eventViewModel.label,
              actorLabel: eventViewModel.actorLabel,
              targetLabel: eventViewModel.targetLabel,
              eventType: event.eventType,
              identifier: event.identifier,
              userId: event.userId,
              metadata: event.metadata,
            },
            searchValue,
          )
        ) {
          continue;
        }

        matchedEvents.push(eventViewModel);

        total += 1;
      }

      cursor = auditPage.isDone ? null : auditPage.continueCursor;
      isDone = auditPage.isDone;
    }

    const sortedEvents =
      sortBy === 'createdAt'
        ? matchedEvents
        : [...matchedEvents].sort((left, right) =>
            compareOrganizationAuditEvents(left, right, sortBy, sortOrder),
          );
    const pagedEvents = includeAllMatching
      ? sortedEvents
      : sortedEvents.slice(targetStart, targetEnd);
    const returnedPageSize = includeAllMatching ? Math.max(sortedEvents.length, 1) : pageSize;
    const returnedPage = includeAllMatching ? 1 : page;
    const returnedTotalPages = includeAllMatching
      ? sortedEvents.length > 0
        ? 1
        : 0
      : Math.ceil(total / pageSize);

    return {
      organization: {
        id: organizationId,
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      capabilities: {
        canViewAudit: capabilities.canViewAudit,
      },
      events: pagedEvents,
      pagination: {
        page: returnedPage,
        pageSize: returnedPageSize,
        total,
        totalPages: returnedTotalPages,
      },
    };
  },
});

export const exportOrganizationAuditCsv = action({
  args: {
    slug: v.string(),
    sortBy: v.union(
      v.literal('label'),
      v.literal('identifier'),
      v.literal('userId'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    preset: v.optional(v.union(v.literal('all'), v.literal('security'))),
    eventType: v.union(
      v.literal('all'),
      v.literal('organization_created'),
      v.literal('organization_updated'),
      v.literal('member_added'),
      v.literal('member_removed'),
      v.literal('member_role_updated'),
      v.literal('member_suspended'),
      v.literal('member_deactivated'),
      v.literal('member_reactivated'),
      v.literal('member_invited'),
      v.literal('invite_accepted'),
      v.literal('invite_rejected'),
      v.literal('invite_cancelled'),
      v.literal('domain_added'),
      v.literal('domain_verification_succeeded'),
      v.literal('domain_verification_failed'),
      v.literal('domain_verification_token_regenerated'),
      v.literal('domain_removed'),
      v.literal('organization_policy_updated'),
      v.literal('enterprise_auth_mode_updated'),
      v.literal('enterprise_login_succeeded'),
      v.literal('enterprise_scim_token_generated'),
      v.literal('enterprise_scim_token_deleted'),
      v.literal('scim_member_deprovisioned'),
      v.literal('scim_member_reactivated'),
      v.literal('scim_member_deprovision_failed'),
      v.literal('bulk_invite_revoked'),
      v.literal('bulk_invite_resent'),
      v.literal('bulk_member_removed'),
      v.literal('authorization_denied'),
      v.literal('admin_user_sessions_viewed'),
      v.literal('directory_exported'),
      v.literal('audit_log_exported'),
      v.literal('chat_thread_created'),
      v.literal('chat_thread_deleted'),
      v.literal('chat_attachment_uploaded'),
      v.literal('chat_attachment_scan_passed'),
      v.literal('chat_attachment_scan_failed'),
      v.literal('chat_attachment_quarantined'),
      v.literal('chat_attachment_deleted'),
      v.literal('attachment_access_url_issued'),
      v.literal('pdf_parse_requested'),
      v.literal('pdf_parse_succeeded'),
      v.literal('pdf_parse_failed'),
      v.literal('chat_run_completed'),
      v.literal('chat_run_failed'),
      v.literal('chat_web_search_used'),
      v.literal('audit_integrity_check_failed'),
    ),
    search: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    failuresOnly: v.optional(v.boolean()),
  },
  returns: v.object({
    filename: v.string(),
    csv: v.string(),
  }),
  handler: async (ctx, args) => {
    const currentUser = await requireStepUpFromActionOrThrow(ctx, STEP_UP_REQUIREMENTS.auditExport);
    const rows: Array<Record<string, string>> = [];
    let pageNumber = 1;
    let organizationName = 'organization';
    let exportedOrganizationId: string | undefined;

    while (true) {
      const auditPage = await ctx.runQuery(
        anyApi.organizationManagement.listOrganizationAuditEvents,
        {
          slug: args.slug,
          page: pageNumber,
          pageSize: 100,
          sortBy: args.sortBy,
          sortOrder: args.sortOrder,
          preset: args.preset,
          eventType: args.eventType,
          search: args.search,
          startDate: args.startDate,
          endDate: args.endDate,
          failuresOnly: args.failuresOnly,
        },
      );

      if (!auditPage) {
        throw new Error('Organization audit log is unavailable');
      }

      organizationName = auditPage.organization.slug;
      exportedOrganizationId = auditPage.organization.id;
      for (const event of auditPage.events) {
        rows.push({
          timestamp: new Date(event.createdAt).toISOString(),
          event_type: event.eventType,
          organization_id: event.organizationId ?? '',
          user_id: event.userId ?? '',
          identifier: event.identifier ?? '',
          ip_address: event.ipAddress ?? '',
          user_agent: event.userAgent ?? '',
          metadata: JSON.stringify(event.metadata ?? null),
        });
      }

      if (
        auditPage.pagination.page >= auditPage.pagination.totalPages ||
        auditPage.pagination.totalPages === 0
      ) {
        break;
      }

      pageNumber += 1;
    }

    const header = [
      'timestamp',
      'event_type',
      'organization_id',
      'user_id',
      'identifier',
      'ip_address',
      'user_agent',
      'metadata',
    ];
    const csv = [
      header.join(','),
      ...rows.map((row) =>
        header.map((key) => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','),
      ),
    ].join('\n');

    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: 'audit_log_exported',
      userId: currentUser.authUserId,
      actorUserId: currentUser.authUserId,
      organizationId: exportedOrganizationId,
      identifier:
        typeof currentUser.authUser.email === 'string' ? currentUser.authUser.email : undefined,
      sessionId: currentUser.authSession?.id ?? undefined,
      outcome: 'success',
      severity: 'info',
      resourceType: 'audit_export',
      resourceId: organizationName,
      resourceLabel: `${organizationName}-audit`,
      sourceSurface: 'organization.audit_export',
      metadata: JSON.stringify({
        eventType: args.eventType,
        preset: args.preset ?? 'all',
        search: args.search,
        startDate: args.startDate ?? null,
        endDate: args.endDate ?? null,
        failuresOnly: args.failuresOnly ?? false,
        rowCount: rows.length,
      }),
    });

    return {
      filename: `${organizationName}-audit-log.csv`,
      csv,
    };
  },
});

export const exportOrganizationDirectoryCsv = action({
  args: {
    slug: v.string(),
    asOf: v.number(),
    sortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('kind'),
      v.literal('role'),
      v.literal('status'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    secondarySortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('kind'),
      v.literal('role'),
      v.literal('status'),
      v.literal('createdAt'),
    ),
    secondarySortOrder: v.union(v.literal('asc'), v.literal('desc')),
    search: v.string(),
    kind: v.union(v.literal('all'), v.literal('member'), v.literal('invite')),
  },
  returns: v.object({
    filename: v.string(),
    csv: v.string(),
  }),
  handler: async (ctx, args) => {
    const currentUser = await requireStepUpFromActionOrThrow(ctx, STEP_UP_REQUIREMENTS.auditExport);
    const rows: Array<Record<string, string>> = [];
    let pageNumber = 1;
    let organizationName = 'organization';
    let exportedOrganizationId: string | undefined;

    while (true) {
      const directoryPage = await ctx.runQuery(
        anyApi.organizationManagement.listOrganizationDirectory,
        {
          slug: args.slug,
          asOf: args.asOf,
          page: pageNumber,
          pageSize: 100,
          sortBy: args.sortBy,
          sortOrder: args.sortOrder,
          secondarySortBy: args.secondarySortBy,
          secondarySortOrder: args.secondarySortOrder,
          search: args.search,
          kind: args.kind,
        },
      );

      if (!directoryPage) {
        throw new Error('Organization directory export is unavailable');
      }

      organizationName = directoryPage.organization.slug;
      exportedOrganizationId = directoryPage.organization.id;
      for (const row of directoryPage.rows) {
        rows.push({
          name: row.name ?? '',
          email: row.email,
          type: row.kind,
          role: row.role,
          status: row.status,
          created_at: new Date(row.createdAt).toISOString(),
        });
      }

      if (
        directoryPage.pagination.page >= directoryPage.pagination.totalPages ||
        directoryPage.pagination.totalPages === 0
      ) {
        break;
      }

      pageNumber += 1;
    }

    const header = ['name', 'email', 'type', 'role', 'status', 'created_at'];
    const csv = [
      header.join(','),
      ...rows.map((row) =>
        header.map((key) => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','),
      ),
    ].join('\n');

    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: 'directory_exported',
      userId: currentUser.authUserId,
      actorUserId: currentUser.authUserId,
      organizationId: exportedOrganizationId,
      identifier:
        typeof currentUser.authUser.email === 'string' ? currentUser.authUser.email : undefined,
      sessionId: currentUser.authSession?.id ?? undefined,
      outcome: 'success',
      severity: 'info',
      resourceType: 'directory_export',
      resourceId: organizationName,
      resourceLabel: `${organizationName}-directory`,
      sourceSurface: 'organization.directory_export',
      metadata: JSON.stringify({
        kind: args.kind,
        search: args.search,
        rowCount: rows.length,
      }),
    });

    return {
      filename: `${organizationName}-directory.csv`,
      csv,
    };
  },
});

async function listOrganizationMembersForUser(ctx: QueryCtx, authUserId: string) {
  return await fetchBetterAuthMembersByUserId(ctx, authUserId);
}

export const listOrganizationThreadsBatch = internalQuery({
  args: {
    organizationId: v.string(),
    limit: v.number(),
  },
  returns: v.array(chatThreadsDocValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatThreads')
      .withIndex('by_organizationId_and_updatedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')
      .take(args.limit);
  },
});

export const deleteOrganizationStandaloneAttachmentsBatch = internalMutation({
  args: {
    organizationId: v.string(),
    limit: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const standaloneAttachments = await listStandaloneAttachmentsForOrganization(ctx, args);
    await Promise.all(
      standaloneAttachments.map(async (attachment) => {
        if (attachment.rawStorageId) {
          await ctx.storage.delete(attachment.rawStorageId);
        }

        if (attachment.extractedTextStorageId) {
          await ctx.storage.delete(attachment.extractedTextStorageId);
        }

        await ctx.db.delete(attachment._id);
      }),
    );
    return standaloneAttachments.length;
  },
});

export const deleteOrganizationPersonasBatch = internalMutation({
  args: {
    organizationId: v.string(),
    limit: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const personas = await ctx.db
      .query('aiPersonas')
      .withIndex('by_organizationId_and_createdAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')
      .take(args.limit);

    await Promise.all(personas.map((persona) => ctx.db.delete(persona._id)));
    return personas.length;
  },
});

export const cleanupOrganizationDataInternal = internalAction({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    deletedThreads: v.number(),
    deletedStandaloneAttachments: v.number(),
    deletedPersonas: v.number(),
  }),
  handler: async (ctx, args) => {
    let deletedThreads = 0;
    let deletedStandaloneAttachments = 0;
    let deletedPersonas = 0;

    while (true) {
      const threads = await ctx.runQuery(
        internal.organizationManagement.listOrganizationThreadsBatch,
        {
          organizationId: args.organizationId,
          limit: ORGANIZATION_CLEANUP_BATCH_SIZE,
        },
      );

      if (threads.length === 0) {
        break;
      }

      for (const thread of threads as Array<{ _id: Id<'chatThreads'> }>) {
        const result = await ctx.runMutation(internal.agentChat.deleteThreadForCleanupInternal, {
          threadId: thread._id,
        });

        if (result.deleted) {
          deletedThreads += 1;
        }
      }
    }

    while (true) {
      const deletedCount = await ctx.runMutation(
        internal.organizationManagement.deleteOrganizationStandaloneAttachmentsBatch,
        {
          organizationId: args.organizationId,
          limit: ORGANIZATION_CLEANUP_BATCH_SIZE,
        },
      );

      if (deletedCount === 0) {
        break;
      }

      deletedStandaloneAttachments += deletedCount;
    }

    while (true) {
      const deletedCount = await ctx.runMutation(
        internal.organizationManagement.deleteOrganizationPersonasBatch,
        {
          organizationId: args.organizationId,
          limit: ORGANIZATION_CLEANUP_BATCH_SIZE,
        },
      );

      if (deletedCount === 0) {
        break;
      }

      deletedPersonas += deletedCount;
    }

    return {
      success: true,
      deletedThreads,
      deletedStandaloneAttachments,
      deletedPersonas,
    };
  },
});
