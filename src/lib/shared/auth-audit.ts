export const AUTH_AUDIT_EVENT_TYPES = [
  'user_signed_up',
  'user_profile_updated',
  'user_profile_image_updated',
  'user_email_verified',
  'user_banned',
  'user_unbanned',
  'user_deleted',
  'user_signed_in',
  'user_signed_out',
  'session_created',
  'session_revoked',
  'sessions_revoked_all',
  'user_impersonated',
  'user_impersonation_stopped',
  'account_linked',
  'account_unlinked',
  'password_changed',
  'password_reset_requested',
  'password_reset_completed',
  'email_verification_sent',
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
] as const;

export type AuthAuditEventType = (typeof AUTH_AUDIT_EVENT_TYPES)[number];
export const AUTH_AUDIT_HANDLER_OWNERS = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
] as const;
export type AuthAuditHandlerOwner = (typeof AUTH_AUDIT_HANDLER_OWNERS)[number];

export type AuthAuditEvent = {
  id: string;
  eventType: AuthAuditEventType;
  userId?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  identifier?: string;
  sessionId?: string;
  requestId?: string;
  outcome?: 'success' | 'failure';
  severity?: 'info' | 'warning' | 'critical';
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  sourceSurface?: string;
  eventHash?: string;
  previousEventHash?: string;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
};

const AUTH_AUDIT_EVENT_TYPE_SET = new Set<string>(AUTH_AUDIT_EVENT_TYPES);
const AUTH_AUDIT_HANDLER_OWNER_SET = new Set<string>(AUTH_AUDIT_HANDLER_OWNERS);

export const AUTH_AUDIT_EVENT_OWNERS = {
  user_signed_up: ['user'],
  user_profile_updated: ['user'],
  user_profile_image_updated: ['user'],
  user_email_verified: ['verification', 'user'],
  user_banned: ['user'],
  user_unbanned: ['user'],
  user_deleted: ['user'],
  user_signed_in: ['session'],
  user_signed_out: ['session'],
  session_created: ['session'],
  session_revoked: ['session'],
  sessions_revoked_all: ['session'],
  user_impersonated: ['session'],
  user_impersonation_stopped: ['session'],
  account_linked: ['account'],
  account_unlinked: ['account'],
  password_changed: ['account'],
  password_reset_requested: ['verification'],
  password_reset_completed: ['verification'],
  email_verification_sent: ['verification'],
  organization_created: ['organization'],
  organization_updated: ['organization'],
  member_added: ['organization'],
  member_removed: ['organization'],
  member_role_updated: ['organization'],
  member_suspended: ['organization'],
  member_deactivated: ['organization'],
  member_reactivated: ['organization'],
  member_invited: ['organization'],
  invite_accepted: ['organization'],
  invite_rejected: ['organization'],
  invite_cancelled: ['organization'],
  domain_added: ['organization'],
  domain_verification_succeeded: ['organization'],
  domain_verification_failed: ['organization'],
  domain_verification_token_regenerated: ['organization'],
  domain_removed: ['organization'],
  organization_policy_updated: ['organization'],
  enterprise_auth_mode_updated: ['organization'],
  enterprise_login_succeeded: ['organization'],
  enterprise_scim_token_generated: ['organization'],
  enterprise_scim_token_deleted: ['organization'],
  scim_member_deprovisioned: ['organization'],
  scim_member_reactivated: ['organization'],
  scim_member_deprovision_failed: ['organization'],
  bulk_invite_revoked: ['organization'],
  bulk_invite_resent: ['organization'],
  bulk_member_removed: ['organization'],
  authorization_denied: ['organization'],
  admin_user_sessions_viewed: ['session'],
  directory_exported: ['organization'],
  audit_log_exported: ['organization'],
  chat_thread_created: ['organization'],
  chat_thread_deleted: ['organization'],
  chat_attachment_uploaded: ['organization'],
  chat_attachment_scan_passed: ['organization'],
  chat_attachment_scan_failed: ['organization'],
  chat_attachment_quarantined: ['organization'],
  chat_attachment_deleted: ['organization'],
  attachment_access_url_issued: ['organization'],
  pdf_parse_requested: ['organization'],
  pdf_parse_succeeded: ['organization'],
  pdf_parse_failed: ['organization'],
  chat_run_completed: ['organization'],
  chat_run_failed: ['organization'],
  chat_web_search_used: ['organization'],
  audit_integrity_check_failed: ['organization'],
} as const satisfies Record<AuthAuditEventType, readonly AuthAuditHandlerOwner[]>;

export function isAuthAuditEventType(value: string): value is AuthAuditEventType {
  return AUTH_AUDIT_EVENT_TYPE_SET.has(value);
}

export function isAuthAuditHandlerOwner(value: string): value is AuthAuditHandlerOwner {
  return AUTH_AUDIT_HANDLER_OWNER_SET.has(value);
}

export function normalizeAuditIdentifier(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
}
