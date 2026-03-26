import { z } from 'zod';
import type { Id } from '../../../../convex/_generated/dataModel';

const ORGANIZATION_DIRECTORY_SORT_FIELDS = [
  'name',
  'email',
  'kind',
  'role',
  'status',
  'createdAt',
] as const;

export const ORGANIZATION_DIRECTORY_KIND_VALUES = ['all', 'member', 'invite'] as const;
export const ORGANIZATION_DIRECTORY_ROLE_VALUES = ['owner', 'admin', 'member'] as const;
export const ORGANIZATION_MEMBER_STATUS_VALUES = ['active', 'suspended', 'deactivated'] as const;
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
  'enterprise_break_glass_used',
  'enterprise_login_succeeded',
  'enterprise_scim_token_generated',
  'enterprise_scim_token_deleted',
  'scim_member_deprovisioned',
  'scim_member_reactivated',
  'scim_member_deprovision_failed',
  'bulk_invite_revoked',
  'bulk_invite_resent',
  'bulk_member_removed',
  'support_access_granted',
  'support_access_revoked',
  'support_access_used',
  'authorization_denied',
  'admin_user_sessions_viewed',
  'directory_exported',
  'audit_log_exported',
  'retention_hold_applied',
  'retention_hold_released',
  'retention_purge_completed',
  'retention_purge_failed',
  'retention_purge_skipped_on_hold',
  'chat_thread_created',
  'chat_thread_deleted',
  'chat_attachment_uploaded',
  'chat_attachment_scan_passed',
  'chat_attachment_scan_failed',
  'chat_attachment_quarantined',
  'chat_attachment_deleted',
  'attachment_access_url_issued',
  'file_access_ticket_issued',
  'file_access_redeemed',
  'file_access_redeem_failed',
  'pdf_parse_requested',
  'pdf_parse_succeeded',
  'pdf_parse_failed',
  'chat_run_completed',
  'chat_run_failed',
  'chat_web_search_used',
  'evidence_report_generated',
  'evidence_report_exported',
  'evidence_report_reviewed',
  'security_control_evidence_created',
  'security_control_evidence_reviewed',
  'security_control_evidence_archived',
  'security_control_evidence_renewed',
  'outbound_vendor_access_denied',
  'outbound_vendor_access_used',
  'mfa_enrollment_enforced',
  'email_verification_enforced',
  'admin_step_up_challenged',
  'step_up_challenge_required',
  'step_up_challenge_completed',
  'step_up_challenge_failed',
  'step_up_consumed',
  'backup_restore_drill_completed',
  'backup_restore_drill_failed',
] as const;
const ORGANIZATION_AUDIT_EVENT_FILTER_VALUES = ['all', ...ORGANIZATION_AUDIT_EVENT_TYPES] as const;
const ORGANIZATION_AUDIT_PRESET_VALUES = ['all', 'security'] as const;
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
  preset: z.enum(ORGANIZATION_AUDIT_PRESET_VALUES).default('all'),
  eventType: z.enum(ORGANIZATION_AUDIT_EVENT_FILTER_VALUES).default('all'),
  startDate: z.string().default(''),
  endDate: z.string().default(''),
  failuresOnly: z.boolean().default(false),
});

export type OrganizationAuditSearchParams = z.infer<typeof organizationAuditSearchSchema>;
export type OrganizationAuditSortField = (typeof ORGANIZATION_AUDIT_SORT_FIELDS)[number];

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

export const ORGANIZATION_ENTERPRISE_PROVIDER_KEYS = ['google-workspace', 'entra', 'okta'] as const;
export const ORGANIZATION_ENTERPRISE_PROVIDER_STATUS_VALUES = [
  'active',
  'not_configured',
  'coming_soon',
] as const;

export type OrganizationEnterpriseAuthMode = 'off' | 'optional' | 'required';
export type OrganizationEnterpriseAuthProtocol = 'oidc';
export type OrganizationEnterpriseAccessStatus =
  | 'not_required'
  | 'satisfied'
  | 'missing_enterprise_session'
  | 'unmanaged_email_domain'
  | 'support_grant_required'
  | 'support_grant_expired';
export type OrganizationEnterpriseProviderKey =
  (typeof ORGANIZATION_ENTERPRISE_PROVIDER_KEYS)[number];
export type OrganizationEnterpriseProviderStatus =
  (typeof ORGANIZATION_ENTERPRISE_PROVIDER_STATUS_VALUES)[number];
export type OrganizationSupportAccessScope = 'read_only' | 'read_write';
export type OrganizationLegalHoldStatus = 'active' | 'released';
export type RetentionDeletionJobKind = 'temporary_artifact_purge';

export type OrganizationEnterpriseProviderOption = {
  key: OrganizationEnterpriseProviderKey;
  label: string;
  protocol: OrganizationEnterpriseAuthProtocol;
  status: OrganizationEnterpriseProviderStatus;
  selectable: boolean;
};

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
  verificationToken: string | null;
  verificationRecordName: string | null;
  verificationRecordValue: string | null;
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

export type OrganizationEnterpriseAccessResult = {
  allowed: boolean;
  enterpriseAuthMode: OrganizationEnterpriseAuthMode;
  providerKey: OrganizationEnterpriseProviderKey | null;
  reason: string | null;
  requiresEnterpriseAuth: boolean;
  status: OrganizationEnterpriseAccessStatus;
  supportGrant: {
    expiresAt: number;
    id: Id<'organizationSupportAccessGrants'>;
    reason: string;
    scope: OrganizationSupportAccessScope;
    ticketId: string;
  } | null;
};

export type OrganizationSupportAccessGrantRow = {
  id: Id<'organizationSupportAccessGrants'>;
  createdAt: number;
  expiresAt: number;
  grantedByEmail: string | null;
  grantedByName: string | null;
  grantedByUserId: string;
  reason: string;
  revokedAt: number | null;
  revokedByEmail: string | null;
  revokedByName: string | null;
  revokedByUserId: string | null;
  scope: OrganizationSupportAccessScope;
  siteAdminEmail: string;
  siteAdminName: string | null;
  siteAdminUserId: string;
  ticketId: string;
};

export type OrganizationLegalHoldSummary = {
  id: Id<'organizationLegalHolds'>;
  openedAt: number;
  openedByUserId: string;
  organizationId: string;
  reason: string;
  releasedAt: number | null;
  releasedByUserId: string | null;
  status: OrganizationLegalHoldStatus;
};

export type RetentionDeletionBatch = {
  id: Id<'retentionDeletionBatches'>;
  organizationId: string;
  jobKind: RetentionDeletionJobKind;
  policySnapshotJson: string;
  startedAt: number;
  completedAt: number;
  status: 'failure' | 'success';
  deletedCount: number;
  skippedOnHoldCount: number;
  failedCount: number;
  detailsJson: string;
  createdAt: number;
};

export type OrganizationSupportAccessSiteAdminOption = {
  authUserId: string;
  email: string;
  name: string | null;
};

export type OrganizationAuditEventType = (typeof ORGANIZATION_AUDIT_EVENT_TYPES)[number];
