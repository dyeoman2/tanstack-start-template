type EvidenceActivityAuditEvent = {
  id: string;
  actorUserId?: string;
  eventType: string;
  metadata?: string;
  resourceId?: string;
  resourceLabel?: string;
  createdAt: number;
};

export type SecurityEvidenceActivityProjection = {
  actorUserId: string | null;
  auditEventId: string;
  createdAt: number;
  eventType:
    | 'security_control_evidence_created'
    | 'security_control_evidence_reviewed'
    | 'security_control_evidence_archived'
    | 'security_control_evidence_renewed';
  evidenceId: string;
  evidenceTitle: string;
  internalControlId: string;
  itemId: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded' | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewStatus: 'pending' | 'reviewed' | null;
};

export const SECURITY_CONTROL_EVIDENCE_AUDIT_EVENT_TYPES = [
  'security_control_evidence_created',
  'security_control_evidence_reviewed',
  'security_control_evidence_archived',
  'security_control_evidence_renewed',
] as const;

export function parseSecurityEvidenceAuditMetadata(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function buildSecurityEvidenceActivityProjection(
  event: EvidenceActivityAuditEvent,
): SecurityEvidenceActivityProjection | null {
  if (!SECURITY_CONTROL_EVIDENCE_AUDIT_EVENT_TYPES.includes(event.eventType as never)) {
    return null;
  }

  const metadata = parseSecurityEvidenceAuditMetadata(event.metadata);
  const internalControlId =
    typeof metadata?.internalControlId === 'string' ? metadata.internalControlId : null;
  const itemId = typeof metadata?.itemId === 'string' ? metadata.itemId : null;
  const evidenceId =
    typeof event.resourceId === 'string' && event.resourceId.length > 0 ? event.resourceId : null;

  if (!internalControlId || !itemId || !evidenceId) {
    return null;
  }

  return {
    actorUserId: event.actorUserId ?? null,
    auditEventId: event.id,
    createdAt: event.createdAt,
    eventType: event.eventType as SecurityEvidenceActivityProjection['eventType'],
    evidenceId,
    evidenceTitle:
      typeof event.resourceLabel === 'string' && event.resourceLabel.length > 0
        ? event.resourceLabel
        : 'Evidence',
    internalControlId,
    itemId,
    lifecycleStatus:
      metadata?.lifecycleStatus === 'active' ||
      metadata?.lifecycleStatus === 'archived' ||
      metadata?.lifecycleStatus === 'superseded'
        ? metadata.lifecycleStatus
        : null,
    renewedFromEvidenceId:
      typeof metadata?.renewedFromEvidenceId === 'string' ? metadata.renewedFromEvidenceId : null,
    replacedByEvidenceId:
      typeof metadata?.replacedByEvidenceId === 'string' ? metadata.replacedByEvidenceId : null,
    reviewStatus:
      metadata?.reviewStatus === 'pending' || metadata?.reviewStatus === 'reviewed'
        ? metadata.reviewStatus
        : null,
  };
}
