type OrganizationAuditEventSource = {
  id: string;
  eventType: string;
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
  metadata?: string;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
};

type OrganizationAuditProjectedRecord = {
  auditEventId: string;
  eventType: string;
  label: string;
  actorLabel: string | null;
  targetLabel: string | null;
  summary: string | null;
  userId: string | null;
  actorUserId: string | null;
  targetUserId: string | null;
  organizationId: string;
  identifier: string | null;
  sessionId: string | null;
  requestId: string | null;
  outcome: 'success' | 'failure' | null;
  severity: 'info' | 'warning' | 'critical' | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceLabel: string | null;
  sourceSurface: string | null;
  eventHash: string | null;
  previousEventHash: string | null;
  metadata: string | null;
  createdAt: number;
  ipAddress: string | null;
  userAgent: string | null;
};

const ENTERPRISE_PROVIDER_LABELS = {
  'google-workspace': 'Google Workspace',
  entra: 'Microsoft Entra ID',
  okta: 'Okta',
} as const;

export function getOrganizationAuditEventLabel(eventType: string) {
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
    case 'support_access_granted':
      return 'Support access granted';
    case 'support_access_revoked':
      return 'Support access revoked';
    case 'support_access_used':
      return 'Support access used';
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
    case 'file_access_ticket_issued':
      return 'File access ticket issued';
    case 'file_access_redeemed':
      return 'File access redeemed';
    case 'file_access_redeem_failed':
      return 'File access redeem failed';
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
    case 'security_control_evidence_created':
      return 'Security control evidence added';
    case 'security_control_evidence_reviewed':
      return 'Security control evidence approved';
    case 'security_control_evidence_archived':
      return 'Security control evidence archived';
    case 'security_control_evidence_renewed':
      return 'Security control evidence renewed';
    case 'backup_restore_drill_completed':
      return 'Backup restore drill completed';
    case 'backup_restore_drill_failed':
      return 'Backup restore drill failed';
    case 'admin_step_up_challenged':
      return 'Admin step-up challenged';
    case 'step_up_challenge_required':
      return 'Step-up challenge required';
    case 'step_up_challenge_completed':
      return 'Step-up challenge completed';
    case 'step_up_challenge_failed':
      return 'Step-up challenge failed';
    case 'step_up_consumed':
      return 'Step-up consumed';
    default:
      return eventType;
  }
}

export function parseAuditMetadata(metadata: string | undefined | null) {
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
    return ENTERPRISE_PROVIDER_LABELS['google-workspace'];
  }

  if (providerValue === 'entra' || providerValue.startsWith('entra--')) {
    return ENTERPRISE_PROVIDER_LABELS.entra;
  }

  if (providerValue === 'okta' || providerValue.startsWith('okta--')) {
    return ENTERPRISE_PROVIDER_LABELS.okta;
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
    case 'support_access_granted':
    case 'support_access_revoked':
      return 'Organization admin';
    default:
      return undefined;
  }
}

function getAuditActorLabel(event: OrganizationAuditEventSource, metadata: unknown) {
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

function getAuditTargetLabel(event: OrganizationAuditEventSource, metadata: unknown) {
  const metadataRecord = getAuditMetadataRecord(metadata);

  if (event.eventType === 'organization_policy_updated') {
    return 'Organization policies';
  }

  if (event.eventType === 'enterprise_auth_mode_updated') {
    return 'Enterprise auth settings';
  }

  if (
    event.eventType === 'support_access_granted' ||
    event.eventType === 'support_access_revoked' ||
    event.eventType === 'support_access_used'
  ) {
    return 'Provider support access';
  }

  if (
    event.eventType === 'enterprise_scim_token_generated' ||
    event.eventType === 'enterprise_scim_token_deleted'
  ) {
    return 'SCIM token';
  }

  return (
    toAuditMetadataDisplayValue(metadataRecord?.siteAdminEmail) ??
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
    eventType === 'support_access_granted' ||
    eventType === 'support_access_revoked' ||
    eventType === 'support_access_used'
  ) {
    const scope = toAuditMetadataDisplayValue(metadataRecord?.scope);
    const permission = toAuditMetadataDisplayValue(metadataRecord?.permission);
    const reason = toAuditMetadataDisplayValue(metadataRecord?.reason);

    if (eventType === 'support_access_used') {
      return [permission ? `Permission: ${permission}` : null, scope ? `Scope: ${scope}` : null]
        .filter((value): value is string => value !== null)
        .join(' · ');
    }

    return [scope ? `Scope: ${scope}` : null, reason]
      .filter((value): value is string => !!value)
      .join(' · ');
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

export function buildOrganizationAuditProjection(
  event: OrganizationAuditEventSource,
): OrganizationAuditProjectedRecord | null {
  if (!event.organizationId) {
    return null;
  }

  const metadata = parseAuditMetadata(event.metadata);

  return {
    auditEventId: event.id,
    eventType: event.eventType,
    label: getOrganizationAuditEventLabel(event.eventType),
    actorLabel: getAuditActorLabel(event, metadata) ?? null,
    targetLabel: getAuditTargetLabel(event, metadata) ?? null,
    summary: getAuditSummary(event.eventType, metadata) ?? null,
    userId: event.userId ?? null,
    actorUserId: event.actorUserId ?? null,
    targetUserId: event.targetUserId ?? null,
    organizationId: event.organizationId,
    identifier: event.identifier ?? null,
    sessionId: event.sessionId ?? null,
    requestId: event.requestId ?? null,
    outcome: event.outcome ?? null,
    severity: event.severity ?? null,
    resourceType: event.resourceType ?? null,
    resourceId: event.resourceId ?? null,
    resourceLabel: event.resourceLabel ?? null,
    sourceSurface: event.sourceSurface ?? null,
    eventHash: event.eventHash ?? null,
    previousEventHash: event.previousEventHash ?? null,
    metadata: event.metadata ?? null,
    createdAt: event.createdAt,
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
  };
}
