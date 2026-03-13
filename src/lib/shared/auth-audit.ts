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
  'member_invited',
  'invite_accepted',
  'invite_rejected',
  'invite_cancelled',
  'team_created',
  'team_updated',
  'team_deleted',
  'team_member_added',
  'team_member_removed',
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
  organizationId?: string;
  identifier?: string;
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
  member_invited: ['organization'],
  invite_accepted: ['organization'],
  invite_rejected: ['organization'],
  invite_cancelled: ['organization'],
  team_created: ['organization'],
  team_updated: ['organization'],
  team_deleted: ['organization'],
  team_member_added: ['organization'],
  team_member_removed: ['organization'],
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
