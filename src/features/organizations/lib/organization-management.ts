import type { Id } from '../../../../convex/_generated/dataModel';
import { z } from 'zod';

export const ORGANIZATION_DIRECTORY_SORT_FIELDS = [
  'name',
  'email',
  'kind',
  'role',
  'status',
  'createdAt',
] as const;

export const ORGANIZATION_DIRECTORY_KIND_VALUES = ['all', 'member', 'invite'] as const;
export const ORGANIZATION_DIRECTORY_ROLE_VALUES = ['owner', 'admin', 'member'] as const;
export const ORGANIZATION_MEMBER_STATUS_VALUES = [
  'active',
  'suspended',
  'deactivated',
] as const;
export const ORGANIZATION_INVITE_POLICY_VALUES = ['owners_admins', 'owners_only'] as const;
export const ORGANIZATION_AUDIT_EVENT_TYPES = [
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
  'enterprise_scim_user_provisioned',
  'enterprise_scim_user_updated',
  'enterprise_scim_user_deactivated',
  'enterprise_scim_user_reactivated',
  'scim_member_deprovisioned',
  'scim_member_reactivated',
  'scim_member_deprovision_failed',
  'bulk_invite_revoked',
  'bulk_invite_resent',
  'bulk_member_removed',
] as const;
export const ORGANIZATION_AUDIT_EVENT_FILTER_VALUES = [
  'all',
  ...ORGANIZATION_AUDIT_EVENT_TYPES,
] as const;
export const ORGANIZATION_AUDIT_SORT_FIELDS = [
  'label',
  'identifier',
  'userId',
  'createdAt',
] as const;

export const organizationDirectorySearchSchema = z.object({
  page: z.number().default(1),
  pageSize: z.number().default(10),
  sortBy: z.enum(ORGANIZATION_DIRECTORY_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  secondarySortBy: z.enum(ORGANIZATION_DIRECTORY_SORT_FIELDS).default('email'),
  secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  kind: z.enum(ORGANIZATION_DIRECTORY_KIND_VALUES).default('all'),
});

export type OrganizationDirectorySortField = (typeof ORGANIZATION_DIRECTORY_SORT_FIELDS)[number];
export type OrganizationDirectorySortOrder = 'asc' | 'desc';
export type OrganizationDirectoryKind = (typeof ORGANIZATION_DIRECTORY_KIND_VALUES)[number];
export type OrganizationDirectoryRole = (typeof ORGANIZATION_DIRECTORY_ROLE_VALUES)[number];
export type OrganizationMemberStatus = (typeof ORGANIZATION_MEMBER_STATUS_VALUES)[number];
export type OrganizationInvitePolicy = (typeof ORGANIZATION_INVITE_POLICY_VALUES)[number];

export type OrganizationDirectorySearchParams = z.infer<typeof organizationDirectorySearchSchema>;

export const organizationAuditSearchSchema = z.object({
  page: z.number().default(1),
  pageSize: z.number().default(10),
  sortBy: z.enum(ORGANIZATION_AUDIT_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().default(''),
  eventType: z.enum(ORGANIZATION_AUDIT_EVENT_FILTER_VALUES).default('all'),
});

export type OrganizationAuditSearchParams = z.infer<typeof organizationAuditSearchSchema>;
export type OrganizationAuditSortField = (typeof ORGANIZATION_AUDIT_SORT_FIELDS)[number];

export type OrganizationCreationEligibility = {
  count: number;
  limit: number | null;
  canCreate: boolean;
  reason: string | null;
  isUnlimited: boolean;
};

export type OrganizationCapabilities = {
  availableInviteRoles: OrganizationDirectoryRole[];
  canInvite: boolean;
  canUpdateSettings: boolean;
  canDeleteOrganization: boolean;
  canLeaveOrganization: boolean;
  canManageMembers: boolean;
  canManageDomains: boolean;
  canViewAudit: boolean;
  canManagePolicies: boolean;
};

export type OrganizationPolicies = {
  invitePolicy: OrganizationInvitePolicy;
  verifiedDomainsOnly: boolean;
  memberCap: number | null;
  mfaRequired: boolean;
  enterpriseAuthMode: OrganizationEnterpriseAuthMode;
  enterpriseProviderKey: OrganizationEnterpriseProviderKey | null;
  enterpriseProtocol: OrganizationEnterpriseAuthProtocol | null;
  enterpriseEnabledAt: number | null;
  enterpriseEnforcedAt: number | null;
  allowBreakGlassPasswordLogin: boolean;
};

export const ORGANIZATION_ENTERPRISE_PROVIDER_KEYS = [
  'google-workspace',
  'entra',
  'okta',
] as const;
export const ORGANIZATION_ENTERPRISE_PROVIDER_STATUS_VALUES = [
  'active',
  'not_configured',
  'coming_soon',
] as const;

export type OrganizationEnterpriseAuthMode = 'off' | 'optional' | 'required';
export type OrganizationEnterpriseAuthProtocol = 'oidc';
export type OrganizationEnterpriseProviderKey =
  (typeof ORGANIZATION_ENTERPRISE_PROVIDER_KEYS)[number];
export type OrganizationEnterpriseProviderStatus =
  (typeof ORGANIZATION_ENTERPRISE_PROVIDER_STATUS_VALUES)[number];

export type OrganizationEnterpriseProviderOption = {
  key: OrganizationEnterpriseProviderKey;
  label: string;
  protocol: OrganizationEnterpriseAuthProtocol;
  status: OrganizationEnterpriseProviderStatus;
  selectable: boolean;
};

export type OrganizationEnterpriseAuthSummary = {
  providerKey: OrganizationEnterpriseProviderKey;
  providerLabel: string;
  protocol: OrganizationEnterpriseAuthProtocol;
  providerStatus: OrganizationEnterpriseProviderStatus;
  managedDomains: string[];
  scimProviderId: string;
  scimConnectionConfigured: boolean;
} | null;

export type OrganizationMemberRow = {
  id: string;
  kind: 'member';
  membershipId: string;
  authUserId: string;
  name: string | null;
  email: string;
  role: OrganizationDirectoryRole;
  status: OrganizationMemberStatus;
  createdAt: number;
  isSiteAdmin: boolean;
  availableRoles: OrganizationDirectoryRole[];
  canChangeRole: boolean;
  canRemove: boolean;
  canSuspend: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
};

export type OrganizationInvitationRow = {
  id: string;
  kind: 'invite';
  invitationId: string;
  name: null;
  email: string;
  role: OrganizationDirectoryRole;
  status: 'pending' | 'expired';
  createdAt: number;
  expiresAt: number;
  canRevoke: boolean;
};

export type OrganizationDirectoryRow = OrganizationMemberRow | OrganizationInvitationRow;

export type OrganizationDomainStatus = 'pending_verification' | 'verified';

export type OrganizationDomain = {
  id: Id<'organizationDomains'>;
  organizationId: string;
  domain: string;
  normalizedDomain: string;
  status: OrganizationDomainStatus;
  verificationMethod: 'dns_txt';
  verificationToken: string;
  verificationRecordName: string;
  verificationRecordValue: string;
  verifiedAt: number | null;
  createdByUserId: string;
  createdAt: number;
};

export type OrganizationDomainVerificationResult = {
  verified: boolean;
  checkedAt: number;
  domain: OrganizationDomain;
  reason: string | null;
};

export type OrganizationEnterpriseAuthResolutionResult = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  providerKey: OrganizationEnterpriseProviderKey;
  providerLabel: string;
  providerStatus: OrganizationEnterpriseProviderStatus;
  protocol: OrganizationEnterpriseAuthProtocol;
  enterpriseAuthMode: OrganizationEnterpriseAuthMode;
  managedDomain: string;
  verifiedDomains: string[];
  canUsePasswordFallback: boolean;
} | null;

export type OrganizationEnterpriseAccessResult = {
  allowed: boolean;
  reason: string | null;
  requiresEnterpriseAuth: boolean;
  providerKey: OrganizationEnterpriseProviderKey | null;
  enterpriseAuthMode: OrganizationEnterpriseAuthMode;
};

export type OrganizationAuditEventType = (typeof ORGANIZATION_AUDIT_EVENT_TYPES)[number];

export type OrganizationAuditEventViewModel = {
  id: string;
  eventType: OrganizationAuditEventType;
  label: string;
  actorLabel?: string;
  targetLabel?: string;
  summary?: string;
  userId?: string;
  organizationId?: string;
  identifier?: string;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
};

export type OrganizationAuditPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
