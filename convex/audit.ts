import { anyApi, type PaginationResult } from 'convex/server';
import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  type AuditProvenance,
  type AuthAuditEvent,
  isAuthAuditEventType,
  normalizeAuditIdentifier,
} from '../src/lib/shared/auth-audit';
import { STEP_UP_REQUIREMENTS } from '../src/lib/shared/auth-policy';
import { assertUserId } from '../src/lib/shared/user-id';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from './_generated/server';
import {
  getVerifiedCurrentAuthUserOrNull,
  requireFreshStepUpSessionFromMutationOrActionOrThrow,
  getVerifiedCurrentUserFromActionOrThrow,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import {
  auditLedgerArchiveVerificationDocValidator,
  auditLedgerEventDocValidator,
  auditLedgerEventsResponseValidator,
  auditLedgerExportValidator,
  auditLedgerCheckpointDocValidator,
  auditLedgerImmutableExportDocValidator,
  auditLedgerIntegrityResultValidator,
  auditLedgerSealDocValidator,
} from './lib/returnValidators';

type AuditLedgerEventDoc = Doc<'auditLedgerEvents'>;
type AuditLedgerCheckpointDoc = Doc<'auditLedgerCheckpoints'>;
const AUDIT_FETCH_BATCH_SIZE = 128;
const SECURITY_EXPORT_BATCH_SIZE = 100;
const AUDIT_LEDGER_CHAIN_ID = 'primary';
const AUDIT_SEVERITY_VALUES = ['info', 'warning', 'critical'] as const;
const AUDIT_OUTCOME_VALUES = ['success', 'failure'] as const;
const auditProvenanceValidator = v.object({
  kind: v.union(
    v.literal('user'),
    v.literal('site_admin'),
    v.literal('system'),
    v.literal('scim_service'),
  ),
  emitter: v.string(),
  actorUserId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  identifier: v.optional(v.string()),
  initiatedByUserId: v.optional(v.string()),
  scimProviderId: v.optional(v.string()),
});
type AuditLedgerStateSnapshot = {
  chainId: string;
  chainVersion: number;
  headSequence: number;
  headEventHash: string | null;
  startedAt: number;
  updatedAt: number;
};
type AuditLedgerVerificationFailure = {
  actualEventHash: string | null;
  actualPreviousEventHash: string | null;
  eventId: string;
  expectedPreviousEventHash: string | null;
  expectedSequence: number;
  recomputedEventHash: string;
};
type AuditLedgerIntegrityResult = {
  chainId: string;
  checkedAt: number;
  checkedFromSequence: number;
  checkedToSequence: number;
  headHash: string | null;
  headSequence: number;
  ok: boolean;
  verifiedEventCount: number;
  failure: AuditLedgerVerificationFailure | null;
};
type AuditLedgerExportResult = {
  filename: string;
  jsonl: string;
  manifest: {
    chainId: string;
    chainVersion: number;
    firstSequence: number | null;
    lastSequence: number | null;
    rowCount: number;
    headHash: string | null;
    exportedAt: number;
  };
};
const REGULATED_BASELINE_REQUIRED_FIELDS = new Map<
  string,
  Array<
    | 'actorUserId'
    | 'organizationId'
    | 'outcome'
    | 'resourceType'
    | 'resourceId'
    | 'severity'
    | 'sourceSurface'
  >
>([
  [
    'organization_policy_updated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'enterprise_auth_mode_updated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'enterprise_break_glass_used',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'support_access_granted',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'support_access_revoked',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'support_access_used',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'directory_exported',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'audit_log_exported',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'audit_ledger_viewed',
    ['actorUserId', 'organizationId', 'outcome', 'severity', 'sourceSurface'],
  ],
  [
    'audit_ledger_segment_archived',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'audit_archive_verification_failed',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'audit_archive_verification_recovered',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_generated',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_exported',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_reviewed',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'enterprise_scim_token_generated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'enterprise_scim_token_deleted',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'authorization_denied',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'attachment_access_url_issued',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'file_access_ticket_issued',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'file_access_redeemed',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'file_access_redeem_failed',
    ['organizationId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'retention_purge_completed',
    ['organizationId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'chat_attachment_uploaded',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'chat_run_completed',
    ['organizationId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'chat_web_search_used',
    ['organizationId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'outbound_vendor_access_used',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'outbound_vendor_access_denied',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'admin_step_up_challenged',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'admin_user_sessions_viewed',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'backup_restore_drill_completed',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'backup_restore_drill_failed',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'chat_attachment_quarantined',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'chat_attachment_scan_failed',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
]);

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOutcome(value: string | undefined) {
  return AUDIT_OUTCOME_VALUES.includes(value as (typeof AUDIT_OUTCOME_VALUES)[number])
    ? (value as (typeof AUDIT_OUTCOME_VALUES)[number])
    : undefined;
}

function normalizeSeverity(value: string | undefined) {
  return AUDIT_SEVERITY_VALUES.includes(value as (typeof AUDIT_SEVERITY_VALUES)[number])
    ? (value as (typeof AUDIT_SEVERITY_VALUES)[number])
    : undefined;
}

function parseMetadata(metadata: string | undefined) {
  if (!metadata) {
    return undefined;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

function requireMetadataObject(eventType: string, metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Audit event ${eventType} requires structured metadata`);
  }

  return metadata as Record<string, unknown>;
}

function requireMetadataKey(
  eventType: string,
  metadata: Record<string, unknown>,
  key: string,
  kind: 'string' | 'number' | 'object' | 'array' | 'boolean',
) {
  const value = metadata[key];
  if (kind === 'string') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Audit event ${eventType} metadata is missing required string key: ${key}`);
    }
    return;
  }
  if (kind === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Audit event ${eventType} metadata is missing required number key: ${key}`);
    }
    return;
  }
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`Audit event ${eventType} metadata is missing required boolean key: ${key}`);
    }
    return;
  }
  if (kind === 'array') {
    if (!Array.isArray(value)) {
      throw new Error(`Audit event ${eventType} metadata is missing required array key: ${key}`);
    }
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Audit event ${eventType} metadata is missing required object key: ${key}`);
  }
}

function requireMetadataNullableKey(
  eventType: string,
  metadata: Record<string, unknown>,
  key: string,
  kind: 'number' | 'string',
) {
  const value = metadata[key];
  if (value === null) {
    return;
  }
  if (kind === 'string') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `Audit event ${eventType} metadata is missing required string|null key: ${key}`,
      );
    }
    return;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(
      `Audit event ${eventType} metadata is missing required number|null key: ${key}`,
    );
  }
}

/**
 * Validates a metadata key only when it is present. If the key is missing or
 * undefined the check is silently skipped, making the field genuinely optional.
 */
function optionalMetadataKey(
  eventType: string,
  metadata: Record<string, unknown>,
  key: string,
  kind: 'number' | 'string',
) {
  const value = metadata[key];
  if (value === undefined) {
    return;
  }
  if (kind === 'string') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Audit event ${eventType} metadata has invalid optional string key: ${key}`);
    }
    return;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Audit event ${eventType} metadata has invalid optional number key: ${key}`);
  }
}

function validateEventSpecificMetadata(record: { eventType: string; metadata?: string }) {
  const metadata = parseMetadata(record.metadata);
  switch (record.eventType) {
    case 'chat_attachment_uploaded': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'attachmentId', 'string');
      requireMetadataKey(record.eventType, parsed, 'kind', 'string');
      requireMetadataKey(record.eventType, parsed, 'mimeType', 'string');
      requireMetadataKey(record.eventType, parsed, 'sizeBytes', 'number');
      return;
    }
    case 'audit_log_exported':
    case 'directory_exported': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'exportHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'exportId', 'string');
      requireMetadataKey(record.eventType, parsed, 'manifestHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'rowCount', 'number');
      requireMetadataKey(record.eventType, parsed, 'scope', 'string');
      requireMetadataKey(record.eventType, parsed, 'filters', 'object');
      return;
    }
    case 'audit_ledger_segment_archived': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'startSequence', 'number');
      requireMetadataKey(record.eventType, parsed, 'endSequence', 'number');
      requireMetadataKey(record.eventType, parsed, 'headHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'bucket', 'string');
      requireMetadataKey(record.eventType, parsed, 'objectKey', 'string');
      requireMetadataKey(record.eventType, parsed, 'manifestSha256', 'string');
      return;
    }
    case 'audit_archive_verification_failed':
    case 'audit_archive_verification_recovered': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'verificationStatus', 'string');
      requireMetadataKey(record.eventType, parsed, 'latestSealEndSequence', 'number');
      requireMetadataKey(record.eventType, parsed, 'lagCount', 'number');
      requireMetadataKey(record.eventType, parsed, 'driftDetected', 'string');
      return;
    }
    case 'evidence_report_generated': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'contentHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'filters', 'object');
      return;
    }
    case 'evidence_report_exported': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'exportHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'exportId', 'string');
      requireMetadataKey(record.eventType, parsed, 'manifestHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'rowCount', 'number');
      requireMetadataKey(record.eventType, parsed, 'scope', 'string');
      requireMetadataKey(record.eventType, parsed, 'filters', 'object');
      return;
    }
    case 'evidence_report_reviewed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'reviewStatus', 'string');
      return;
    }
    case 'enterprise_scim_token_generated':
    case 'enterprise_scim_token_deleted': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'organizationId', 'string');
      requireMetadataKey(record.eventType, parsed, 'providerKey', 'string');
      return;
    }
    case 'authorization_denied': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'permission', 'string');
      requireMetadataKey(record.eventType, parsed, 'reason', 'string');
      return;
    }
    case 'enterprise_break_glass_used': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'permission', 'string');
      requireMetadataKey(record.eventType, parsed, 'satisfactionPath', 'string');
      return;
    }
    case 'support_access_granted':
    case 'support_access_revoked': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'grantId', 'string');
      requireMetadataKey(record.eventType, parsed, 'siteAdminUserId', 'string');
      requireMetadataKey(record.eventType, parsed, 'scope', 'string');
      return;
    }
    case 'support_access_used': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'grantId', 'string');
      requireMetadataKey(record.eventType, parsed, 'permission', 'string');
      requireMetadataKey(record.eventType, parsed, 'scope', 'string');
      return;
    }
    case 'attachment_access_url_issued': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'attachmentId', 'string');
      requireMetadataKey(record.eventType, parsed, 'expiresInMinutes', 'number');
      requireMetadataKey(record.eventType, parsed, 'purpose', 'string');
      return;
    }
    case 'file_access_ticket_issued': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'expiresInMinutes', 'number');
      requireMetadataKey(record.eventType, parsed, 'issuedIpAddress', 'string');
      requireMetadataKey(record.eventType, parsed, 'issuedUserAgent', 'string');
      requireMetadataKey(record.eventType, parsed, 'purpose', 'string');
      requireMetadataKey(record.eventType, parsed, 'ticketId', 'string');
      return;
    }
    case 'file_access_redeemed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataNullableKey(record.eventType, parsed, 'ipAddress', 'string');
      requireMetadataKey(record.eventType, parsed, 'purpose', 'string');
      requireMetadataKey(record.eventType, parsed, 'sourceSurface', 'string');
      requireMetadataKey(record.eventType, parsed, 'ticketId', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'userAgent', 'string');
      return;
    }
    case 'file_access_redeem_failed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataNullableKey(record.eventType, parsed, 'attemptedSessionId', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'attemptedUserId', 'string');
      requireMetadataKey(record.eventType, parsed, 'error', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'expiresAt', 'number');
      requireMetadataNullableKey(record.eventType, parsed, 'ipAddress', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'sourceSurface', 'string');
      requireMetadataKey(record.eventType, parsed, 'ticketId', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'userAgent', 'string');
      return;
    }
    case 'admin_user_sessions_viewed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'targetUserId', 'string');
      requireMetadataKey(record.eventType, parsed, 'sessionCount', 'number');
      return;
    }
    case 'organization_policy_updated': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'changedKeys', 'array');
      requireMetadataKey(record.eventType, parsed, 'changes', 'object');
      return;
    }
    case 'enterprise_auth_mode_updated': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'nextMode', 'string');
      requireMetadataKey(record.eventType, parsed, 'previousMode', 'string');
      return;
    }
    case 'backup_restore_drill_completed':
    case 'backup_restore_drill_failed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'drillType', 'string');
      requireMetadataKey(record.eventType, parsed, 'verificationMethod', 'string');
      requireMetadataKey(record.eventType, parsed, 'restoredItemCount', 'number');
      return;
    }
    case 'chat_run_completed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'runId', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'model', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'provider', 'string');
      requireMetadataKey(record.eventType, parsed, 'useWebSearch', 'boolean');
      return;
    }
    case 'chat_web_search_used': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'runId', 'string');
      requireMetadataNullableKey(record.eventType, parsed, 'model', 'string');
      requireMetadataKey(record.eventType, parsed, 'fetchedDomains', 'array');
      requireMetadataKey(record.eventType, parsed, 'sourceCount', 'number');
      return;
    }
    case 'outbound_vendor_access_used': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'vendor', 'string');
      requireMetadataKey(record.eventType, parsed, 'operation', 'string');
      requireMetadataKey(record.eventType, parsed, 'sourceSurface', 'string');
      requireMetadataKey(record.eventType, parsed, 'dataClasses', 'array');
      requireMetadataKey(record.eventType, parsed, 'context', 'object');
      return;
    }
    case 'outbound_vendor_access_denied': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'vendor', 'string');
      requireMetadataKey(record.eventType, parsed, 'operation', 'string');
      requireMetadataKey(record.eventType, parsed, 'sourceSurface', 'string');
      requireMetadataKey(record.eventType, parsed, 'dataClasses', 'array');
      requireMetadataKey(record.eventType, parsed, 'context', 'object');
      return;
    }
    case 'retention_purge_completed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'batchId', 'string');
      requireMetadataKey(record.eventType, parsed, 'deletedCount', 'number');
      requireMetadataKey(record.eventType, parsed, 'failedCount', 'number');
      return;
    }
    case 'audit_ledger_viewed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'surface', 'string');
      requireMetadataKey(record.eventType, parsed, 'resultCount', 'number');
      optionalMetadataKey(record.eventType, parsed, 'organizationId', 'string');
      return;
    }
    default:
      return;
  }
}

export function validateRegulatedAuditFields(record: {
  provenance: AuditProvenance;
  actorUserId?: string;
  eventType: string;
  metadata?: string;
  organizationId?: string;
  outcome?: string;
  resourceId?: string;
  resourceType?: string;
  severity?: string;
  sourceSurface?: string;
}) {
  if (!record.provenance.emitter.trim()) {
    throw new Error(`Audit event ${record.eventType} is missing provenance emitter`);
  }

  const requiredFields = REGULATED_BASELINE_REQUIRED_FIELDS.get(record.eventType);
  if (!requiredFields) {
    return;
  }

  const missingFields = requiredFields.filter((field) => {
    const value = record[field];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missingFields.length > 0) {
    throw new Error(
      `Audit event ${record.eventType} is missing required baseline fields: ${missingFields.join(', ')}`,
    );
  }

  validateEventSpecificMetadata(record);
}

function toAuditEvent(log: AuditLedgerEventDoc): AuthAuditEvent | null {
  if (!isAuthAuditEventType(log.eventType)) {
    return null;
  }

  return {
    id: log.id,
    sequence: log.sequence,
    eventType: log.eventType,
    provenance: log.provenance,
    ...(log.userId ? { userId: log.userId } : {}),
    ...(log.actorUserId ? { actorUserId: log.actorUserId } : {}),
    ...(log.targetUserId ? { targetUserId: log.targetUserId } : {}),
    ...(log.organizationId ? { organizationId: log.organizationId } : {}),
    ...(log.identifier ? { identifier: log.identifier } : {}),
    ...(log.sessionId ? { sessionId: log.sessionId } : {}),
    ...(log.requestId ? { requestId: log.requestId } : {}),
    ...(log.outcome ? { outcome: log.outcome } : {}),
    ...(log.severity ? { severity: log.severity } : {}),
    ...(log.resourceType ? { resourceType: log.resourceType } : {}),
    ...(log.resourceId ? { resourceId: log.resourceId } : {}),
    ...(log.resourceLabel ? { resourceLabel: log.resourceLabel } : {}),
    ...(log.sourceSurface ? { sourceSurface: log.sourceSurface } : {}),
    ...(log.eventHash ? { eventHash: log.eventHash } : {}),
    ...(log.previousEventHash ? { previousEventHash: log.previousEventHash } : {}),
    recordedAt: log.recordedAt,
    ...(log.ipAddress ? { ipAddress: log.ipAddress } : {}),
    ...(log.userAgent ? { userAgent: log.userAgent } : {}),
    ...(log.metadata ? { metadata: parseMetadata(log.metadata) } : {}),
  };
}

async function hashAuditPayload(payload: string) {
  const encodedPayload = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', encodedPayload);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function buildAuditHashPayload(input: {
  chainId: string;
  id: string;
  sequence: number;
  eventType: string;
  recordedAt: number;
  provenance: AuditProvenance;
  userId?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  identifier?: string;
  sessionId?: string;
  requestId?: string;
  outcome?: string;
  severity?: string;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  sourceSurface?: string;
  metadata?: string;
  ipAddress?: string;
  userAgent?: string;
  previousEventHash?: string | null;
}) {
  return JSON.stringify({
    chainId: input.chainId,
    id: input.id,
    sequence: input.sequence,
    eventType: input.eventType,
    recordedAt: input.recordedAt,
    provenance: input.provenance,
    userId: input.userId ?? null,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    organizationId: input.organizationId ?? null,
    identifier: input.identifier ?? null,
    sessionId: input.sessionId ?? null,
    requestId: input.requestId ?? null,
    outcome: input.outcome ?? null,
    severity: input.severity ?? null,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    resourceLabel: input.resourceLabel ?? null,
    sourceSurface: input.sourceSurface ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    previousEventHash: input.previousEventHash ?? null,
  });
}

async function getAuditLedgerState(ctx: QueryCtx | MutationCtx) {
  return (
    (await ctx.db
      .query('auditLedgerState')
      .withIndex('by_chain_id', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
      .unique()) ?? null
  );
}

async function ensureAuditLedgerState(ctx: MutationCtx) {
  const existing = await getAuditLedgerState(ctx);
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const stateId = await ctx.db.insert('auditLedgerState', {
    chainId: AUDIT_LEDGER_CHAIN_ID,
    chainVersion: 1,
    headSequence: 0,
    headEventHash: null,
    startedAt: now,
    updatedAt: now,
  });
  const state = await ctx.db.get(stateId);
  if (!state) {
    throw new Error('Failed to initialize audit ledger state');
  }

  return state;
}

function compareBySequenceDesc(left: AuthAuditEvent, right: AuthAuditEvent) {
  if (left.sequence !== right.sequence) {
    return right.sequence - left.sequence;
  }

  return right.id.localeCompare(left.id);
}

function dedupeEvents(events: AuthAuditEvent[]) {
  const uniqueEvents = new Map<string, AuthAuditEvent>();

  for (const event of events) {
    if (!uniqueEvents.has(event.id)) {
      uniqueEvents.set(event.id, event);
    }
  }

  return Array.from(uniqueEvents.values());
}

async function collectAuditLedgerPageForAdmin(
  ctx: QueryCtx,
  filters: {
    eventType?: string;
    identifier?: string;
    organizationId?: string;
    userId?: string;
    cursor: string | null;
  },
) {
  const { eventType, identifier, organizationId, userId, cursor } = filters;

  if (userId) {
    return await ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_userId_and_sequence', (q) => q.eq('userId', userId))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  if (identifier) {
    return await ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_identifier_and_sequence', (q) => q.eq('identifier', identifier))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  if (organizationId) {
    return await ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_organizationId_and_sequence', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  if (eventType) {
    return await ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_eventType_and_sequence', (q) =>
        q.eq('chainId', AUDIT_LEDGER_CHAIN_ID).eq('eventType', eventType),
      )
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  return await ctx.db
    .query('auditLedgerEvents')
    .withIndex('by_sequence', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
    .order('desc')
    .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
}

async function collectAuditLedgerPageForUser(
  ctx: QueryCtx,
  currentUserId: string,
  cursor: string | null,
) {
  return await ctx.db
    .query('auditLedgerEvents')
    .withIndex('by_userId_and_sequence', (q) => q.eq('userId', currentUserId))
    .order('desc')
    .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
}

const appendAuditLedgerEventArgs = {
  eventType: v.string(),
  provenance: auditProvenanceValidator,
  userId: v.optional(v.string()),
  actorUserId: v.optional(v.string()),
  targetUserId: v.optional(v.string()),
  organizationId: v.optional(v.string()),
  identifier: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  requestId: v.optional(v.string()),
  outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
  severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
  resourceType: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  resourceLabel: v.optional(v.string()),
  sourceSurface: v.optional(v.string()),
  metadata: v.optional(v.string()),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
} as const;

async function appendAuditLedgerEvent(
  ctx: MutationCtx,
  args: {
    provenance: AuditProvenance;
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
    metadata?: string;
    ipAddress?: string;
    userAgent?: string;
  },
) {
  if (!isAuthAuditEventType(args.eventType)) {
    throw new Error(`Unsupported audit event type: ${args.eventType}`);
  }

  const state = await ensureAuditLedgerState(ctx);
  // The state head is the single ordering source for the next append.
  const sequence = state.headSequence + 1;
  const recordedAt = Date.now();
  const previousEventHash = state.headEventHash;
  if (sequence <= state.headSequence) {
    throw new Error('Audit ledger sequence must advance monotonically');
  }
  const record = {
    chainId: AUDIT_LEDGER_CHAIN_ID,
    id: crypto.randomUUID(),
    sequence,
    eventType: args.eventType,
    provenance: args.provenance,
    ...(normalizeOptionalString(args.userId)
      ? { userId: normalizeOptionalString(args.userId) }
      : {}),
    ...(normalizeOptionalString(args.actorUserId)
      ? { actorUserId: normalizeOptionalString(args.actorUserId) }
      : {}),
    ...(normalizeOptionalString(args.targetUserId)
      ? { targetUserId: normalizeOptionalString(args.targetUserId) }
      : {}),
    ...(normalizeOptionalString(args.organizationId)
      ? { organizationId: normalizeOptionalString(args.organizationId) }
      : {}),
    ...(normalizeAuditIdentifier(args.identifier)
      ? { identifier: normalizeAuditIdentifier(args.identifier) }
      : {}),
    ...(normalizeOptionalString(args.sessionId)
      ? { sessionId: normalizeOptionalString(args.sessionId) }
      : {}),
    ...(normalizeOptionalString(args.requestId)
      ? { requestId: normalizeOptionalString(args.requestId) }
      : {}),
    ...(normalizeOutcome(args.outcome) ? { outcome: normalizeOutcome(args.outcome) } : {}),
    ...(normalizeSeverity(args.severity) ? { severity: normalizeSeverity(args.severity) } : {}),
    ...(normalizeOptionalString(args.resourceType)
      ? { resourceType: normalizeOptionalString(args.resourceType) }
      : {}),
    ...(normalizeOptionalString(args.resourceId)
      ? { resourceId: normalizeOptionalString(args.resourceId) }
      : {}),
    ...(normalizeOptionalString(args.resourceLabel)
      ? { resourceLabel: normalizeOptionalString(args.resourceLabel) }
      : {}),
    ...(normalizeOptionalString(args.sourceSurface)
      ? { sourceSurface: normalizeOptionalString(args.sourceSurface) }
      : {}),
    ...(normalizeOptionalString(args.metadata) ? { metadata: args.metadata } : {}),
    ...(normalizeOptionalString(args.ipAddress)
      ? { ipAddress: normalizeOptionalString(args.ipAddress) }
      : {}),
    ...(normalizeOptionalString(args.userAgent)
      ? { userAgent: normalizeOptionalString(args.userAgent) }
      : {}),
    recordedAt,
  };
  validateRegulatedAuditFields(record);

  const eventHash = await hashAuditPayload(
    buildAuditHashPayload({
      ...record,
      previousEventHash,
    }),
  );

  await ctx.db.insert('auditLedgerEvents', {
    ...record,
    eventHash,
    previousEventHash,
  });
  await ctx.db.patch(state._id, {
    headSequence: sequence,
    headEventHash: eventHash,
    updatedAt: recordedAt,
  });

  return null;
}

export const appendAuditLedgerEventInternal = internalMutation({
  args: {
    ...appendAuditLedgerEventArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => await appendAuditLedgerEvent(ctx, args),
});

export const getAuditLedgerStateInternal = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      chainId: v.string(),
      chainVersion: v.number(),
      headSequence: v.number(),
      headEventHash: v.union(v.string(), v.null()),
      startedAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const state = await getAuditLedgerState(ctx);
    if (!state) {
      return null;
    }

    return {
      chainId: state.chainId,
      chainVersion: state.chainVersion,
      headSequence: state.headSequence,
      headEventHash: state.headEventHash,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
    };
  },
});

export const getRecentAuditLedgerEventsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(auditLedgerEventDocValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 500, 2_000));
    return await ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_sequence', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
      .order('desc')
      .take(limit);
  },
});

export const listAuditLedgerEvents = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    eventType: v.optional(v.string()),
    userId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    sourceSurface: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  returns: auditLedgerEventsResponseValidator,
  handler: async (ctx, args) => {
    const authUser = await getVerifiedCurrentAuthUserOrNull(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const currentUserId = assertUserId(authUser, 'Better Auth user missing id');
    const isSiteAdmin = deriveIsSiteAdmin(normalizeUserRole(authUser.role ?? undefined));
    const requestedUserId = normalizeOptionalString(args.userId);
    const requestedIdentifier = normalizeAuditIdentifier(args.identifier);
    const currentIdentifier = normalizeAuditIdentifier(
      typeof authUser.email === 'string' ? authUser.email : undefined,
    );

    if (args.eventType && !isAuthAuditEventType(args.eventType)) {
      throwConvexError('VALIDATION', `Unsupported audit event type: ${args.eventType}`);
    }

    if (!isSiteAdmin && requestedUserId && requestedUserId !== currentUserId) {
      throwConvexError('FORBIDDEN', 'You can only query your own audit ledger');
    }

    if (!isSiteAdmin && requestedIdentifier && requestedIdentifier !== currentIdentifier) {
      throwConvexError('FORBIDDEN', 'You can only query your own audit ledger');
    }

    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const organizationId = normalizeOptionalString(args.organizationId);
    const filterEvent = (event: AuthAuditEvent) => {
      if (!isSiteAdmin) {
        const matchesUserId = event.userId === currentUserId;
        const matchesIdentifier = currentIdentifier
          ? event.identifier === currentIdentifier
          : false;

        if (!matchesUserId && !matchesIdentifier) {
          return false;
        }
      }

      if (requestedUserId && event.userId !== requestedUserId) {
        return false;
      }

      if (args.eventType && event.eventType !== args.eventType) {
        return false;
      }

      if (organizationId && event.organizationId !== organizationId) {
        return false;
      }

      if (requestedIdentifier && event.identifier !== requestedIdentifier) {
        return false;
      }

      if (args.outcome && event.outcome !== args.outcome) {
        return false;
      }

      if (args.severity && event.severity !== args.severity) {
        return false;
      }

      if (args.sourceSurface && event.sourceSurface !== args.sourceSurface) {
        return false;
      }

      if (args.resourceType && event.resourceType !== args.resourceType) {
        return false;
      }

      return true;
    };

    const events: AuthAuditEvent[] = [];
    let cursor = normalizeOptionalString(args.cursor) ?? null;
    let isDone = false;

    while (events.length < limit && !isDone) {
      const result: PaginationResult<AuditLedgerEventDoc> = isSiteAdmin
        ? await collectAuditLedgerPageForAdmin(ctx, {
            eventType: args.eventType,
            identifier: requestedIdentifier,
            organizationId,
            userId: requestedUserId,
            cursor,
          })
        : await collectAuditLedgerPageForUser(ctx, currentUserId, cursor);

      const nextEvents = dedupeEvents(
        result.page
          .map((log) => toAuditEvent(log))
          .filter((event): event is AuthAuditEvent => event !== null),
      )
        .filter(filterEvent)
        .sort(compareBySequenceDesc);

      events.push(...nextEvents);
      isDone = result.isDone;
      cursor = result.isDone ? null : result.continueCursor;
    }

    return {
      events: events.slice(0, limit),
      limit,
      continueCursor: events.length >= limit ? cursor : null,
      isDone: isDone && events.length < limit,
    };
  },
});

export const recordAuditLedgerViewed = action({
  args: {
    organizationId: v.optional(v.string()),
    resultCount: v.number(),
    surface: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    const actorUserId = user.authUserId;

    await ctx.runMutation(internal.audit.appendAuditLedgerEventInternal, {
      eventType: 'audit_ledger_viewed',
      provenance: {
        kind: user.isSiteAdmin ? 'site_admin' : 'user',
        emitter: 'audit.ledger_view',
        actorUserId,
      },
      actorUserId,
      userId: actorUserId,
      organizationId: args.organizationId,
      outcome: 'success',
      severity: 'info',
      sourceSurface: args.surface,
      metadata: JSON.stringify({
        surface: args.surface,
        resultCount: args.resultCount,
        ...(args.organizationId ? { organizationId: args.organizationId } : {}),
      }),
    });

    return null;
  },
});

export const exportAuditLedgerJsonl = action({
  args: {
    organizationId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    sourceSurface: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  returns: auditLedgerExportValidator,
  handler: async (ctx, args): Promise<AuditLedgerExportResult> => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    if (!user.isSiteAdmin) {
      throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
    }
    await requireFreshStepUpSessionFromMutationOrActionOrThrow(ctx, {
      currentUser: user,
      forbiddenImpersonationMessage: 'Impersonated sessions cannot export the audit ledger.',
      requirement: STEP_UP_REQUIREMENTS.auditExport,
      stepUpRequiredMessage: 'Step-up authentication is required to export the audit ledger.',
    });

    const events: AuthAuditEvent[] = [];
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const page: {
        events: AuthAuditEvent[];
        continueCursor: string | null;
        isDone: boolean;
        limit: number;
      } = await ctx.runQuery(anyApi.audit.listAuditLedgerEvents, {
        limit: SECURITY_EXPORT_BATCH_SIZE,
        cursor: cursor ?? undefined,
        organizationId: args.organizationId,
        outcome: args.outcome,
        severity: args.severity,
        sourceSurface: args.sourceSurface,
        resourceType: args.resourceType,
      });

      events.push(...page.events);

      cursor = page.continueCursor;
      isDone = page.isDone || cursor === null;
    }

    const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
    const state: AuditLedgerStateSnapshot | null = await ctx.runQuery(
      anyApi.audit.getAuditLedgerStateInternal,
      {},
    );
    const lastEvent =
      orderedEvents.length > 0 ? orderedEvents[orderedEvents.length - 1] : undefined;
    const exportedAt = Date.now();
    const manifest = {
      chainId: AUDIT_LEDGER_CHAIN_ID,
      chainVersion: state?.chainVersion ?? 1,
      firstSequence: orderedEvents[0]?.sequence ?? null,
      lastSequence: lastEvent?.sequence ?? null,
      rowCount: orderedEvents.length,
      headHash: state?.headEventHash ?? null,
      exportedAt,
    };
    const jsonl = orderedEvents.map((event) => JSON.stringify(event)).join('\n');
    const exportId = crypto.randomUUID();
    const exportHash = await hashAuditPayload(jsonl);
    const manifestHash = await hashAuditPayload(JSON.stringify(manifest));

    await ctx.runMutation(internal.audit.appendAuditLedgerEventInternal, {
      eventType: 'audit_log_exported',
      provenance: {
        kind: 'site_admin',
        emitter: 'audit.ledger_export',
        actorUserId: user.authUserId,
        sessionId: user.authSession?.id ?? undefined,
      },
      actorUserId: user.authUserId,
      userId: user.authUserId,
      organizationId: args.organizationId,
      outcome: 'success',
      resourceId: args.organizationId ?? 'global-audit-ledger',
      resourceLabel: 'security-audit-events',
      resourceType: 'audit_export',
      severity: 'info',
      sessionId: user.authSession?.id ?? undefined,
      sourceSurface: 'admin.audit_ledger_export',
      metadata: JSON.stringify({
        exportHash,
        exportId,
        filters: {
          organizationId: args.organizationId ?? null,
          outcome: args.outcome ?? null,
          severity: args.severity ?? null,
          sourceSurface: args.sourceSurface ?? null,
          resourceType: args.resourceType ?? null,
        },
        manifestHash,
        rowCount: manifest.rowCount,
        scope: args.organizationId ?? 'global',
      }),
    });

    return {
      filename: `security-audit-events-${new Date(exportedAt).toISOString().slice(0, 10)}.jsonl`,
      jsonl,
      manifest,
    };
  },
});

export const getLatestAuditLedgerCheckpointInternal = internalQuery({
  args: {},
  returns: v.union(auditLedgerCheckpointDocValidator, v.null()),
  handler: async (ctx) => {
    return (
      (await ctx.db
        .query('auditLedgerCheckpoints')
        .withIndex('by_chain_id_and_checked_at', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
        .order('desc')
        .first()) ?? null
    );
  },
});

export const getLatestSuccessfulAuditLedgerCheckpointInternal = internalQuery({
  args: {},
  returns: v.union(auditLedgerCheckpointDocValidator, v.null()),
  handler: async (ctx) => {
    return (
      (await ctx.db
        .query('auditLedgerCheckpoints')
        .withIndex('by_chain_id_and_status_and_checked_at', (q) =>
          q.eq('chainId', AUDIT_LEDGER_CHAIN_ID).eq('status', 'ok'),
        )
        .order('desc')
        .first()) ?? null
    );
  },
});

export const getLatestFailedAuditLedgerCheckpointInternal = internalQuery({
  args: {},
  returns: v.union(auditLedgerCheckpointDocValidator, v.null()),
  handler: async (ctx) => {
    return (
      (await ctx.db
        .query('auditLedgerCheckpoints')
        .withIndex('by_chain_id_and_status_and_checked_at', (q) =>
          q.eq('chainId', AUDIT_LEDGER_CHAIN_ID).eq('status', 'failed'),
        )
        .order('desc')
        .first()) ?? null
    );
  },
});

export const getLatestAuditLedgerSealInternal = internalQuery({
  args: {},
  returns: v.union(auditLedgerSealDocValidator, v.null()),
  handler: async (ctx) => {
    return (
      (await ctx.db
        .query('auditLedgerSeals')
        .withIndex('by_chain_id_and_sealed_at', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
        .order('desc')
        .first()) ?? null
    );
  },
});

export const getLatestImmutableAuditExportInternal = internalQuery({
  args: {},
  returns: v.union(auditLedgerImmutableExportDocValidator, v.null()),
  handler: async (ctx) => {
    return (
      (await ctx.db
        .query('auditLedgerImmutableExports')
        .withIndex('by_chain_id_and_end_sequence', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
        .order('desc')
        .first()) ?? null
    );
  },
});

export const getLatestAuditLedgerArchiveVerificationInternal = internalQuery({
  args: {},
  returns: v.union(auditLedgerArchiveVerificationDocValidator, v.null()),
  handler: async (ctx) => {
    return (
      (await ctx.db
        .query('auditLedgerArchiveVerifications')
        .withIndex('by_chain_id_and_checked_at', (q) => q.eq('chainId', AUDIT_LEDGER_CHAIN_ID))
        .order('desc')
        .first()) ?? null
    );
  },
});

export const listAuditLedgerEventsForVerificationInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    endSequence: v.number(),
    startSequence: v.number(),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    page: v.array(auditLedgerEventDocValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('auditLedgerEvents')
      .withIndex('by_sequence', (q) =>
        q
          .eq('chainId', AUDIT_LEDGER_CHAIN_ID)
          .gte('sequence', args.startSequence)
          .lte('sequence', args.endSequence),
      )
      .order('asc')
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.max(1, Math.min(args.numItems ?? AUDIT_FETCH_BATCH_SIZE, 256)),
      });

    return {
      page: result.page,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const createAuditLedgerCheckpointInternal = internalMutation({
  args: {
    chainId: v.string(),
    startSequence: v.number(),
    endSequence: v.number(),
    headHash: v.union(v.string(), v.null()),
    status: v.union(v.literal('ok'), v.literal('failed')),
    checkedAt: v.number(),
    verifiedEventCount: v.number(),
    verifiedHeadHash: v.optional(v.union(v.string(), v.null())),
    failure: v.optional(
      v.object({
        actualEventHash: v.union(v.string(), v.null()),
        actualPreviousEventHash: v.union(v.string(), v.null()),
        eventId: v.string(),
        expectedPreviousEventHash: v.union(v.string(), v.null()),
        expectedSequence: v.number(),
        recomputedEventHash: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.status === 'ok') {
      const latestSuccessfulCheckpoint = await ctx.db
        .query('auditLedgerCheckpoints')
        .withIndex('by_chain_id_and_status_and_checked_at', (q) =>
          q.eq('chainId', args.chainId).eq('status', 'ok'),
        )
        .order('desc')
        .first();

      if (args.headHash !== (args.verifiedHeadHash ?? null)) {
        throw new Error('Audit checkpoint head hash must match the verified ledger head');
      }

      if (latestSuccessfulCheckpoint) {
        if (args.endSequence < latestSuccessfulCheckpoint.endSequence) {
          throw new Error('Audit checkpoint end sequence cannot regress');
        }

        if (
          args.endSequence === latestSuccessfulCheckpoint.endSequence &&
          args.headHash === latestSuccessfulCheckpoint.headHash
        ) {
          return null;
        }
      }
    }

    const { verifiedHeadHash: _verifiedHeadHash, ...checkpoint } = args;
    await ctx.db.insert('auditLedgerCheckpoints', checkpoint);
    return null;
  },
});

export const createAuditLedgerSealInternal = internalMutation({
  args: {
    chainId: v.string(),
    startSequence: v.number(),
    endSequence: v.number(),
    headHash: v.union(v.string(), v.null()),
    eventCount: v.number(),
    sealedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const latestSeal = await ctx.db
      .query('auditLedgerSeals')
      .withIndex('by_chain_id_and_end_sequence', (q) => q.eq('chainId', args.chainId))
      .order('desc')
      .first();

    if (latestSeal) {
      if (args.endSequence < latestSeal.endSequence) {
        throw new Error('Audit ledger seal end sequence cannot regress');
      }

      if (args.endSequence === latestSeal.endSequence && args.headHash === latestSeal.headHash) {
        return null;
      }
    }

    await ctx.db.insert('auditLedgerSeals', args);
    return null;
  },
});

export const recordImmutableAuditExportInternal = internalMutation({
  args: {
    chainId: v.string(),
    startSequence: v.number(),
    endSequence: v.number(),
    headHash: v.union(v.string(), v.null()),
    eventCount: v.number(),
    sealedAt: v.number(),
    exportedAt: v.number(),
    bucket: v.string(),
    objectKey: v.string(),
    manifestObjectKey: v.string(),
    payloadSha256: v.string(),
    manifestSha256: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const latestExport = await ctx.db
      .query('auditLedgerImmutableExports')
      .withIndex('by_chain_id_and_end_sequence', (q) => q.eq('chainId', args.chainId))
      .order('desc')
      .first();

    if (latestExport) {
      if (args.endSequence < latestExport.endSequence) {
        throw new Error('Audit immutable export end sequence cannot regress');
      }

      if (
        args.endSequence === latestExport.endSequence &&
        args.headHash === latestExport.headHash &&
        args.objectKey === latestExport.objectKey
      ) {
        return null;
      }
    }

    await ctx.db.insert('auditLedgerImmutableExports', args);
    return null;
  },
});

export const createAuditLedgerArchiveVerificationInternal = internalMutation({
  args: {
    chainId: v.string(),
    checkedAt: v.number(),
    required: v.boolean(),
    configured: v.boolean(),
    exporterEnabled: v.boolean(),
    latestSealEndSequence: v.union(v.number(), v.null()),
    latestExportEndSequence: v.union(v.number(), v.null()),
    lagCount: v.number(),
    driftDetected: v.boolean(),
    lastVerificationStatus: v.union(
      v.literal('verified'),
      v.literal('missing_object'),
      v.literal('hash_mismatch'),
      v.literal('no_seal'),
      v.literal('disabled'),
    ),
    lastVerifiedSealEndSequence: v.union(v.number(), v.null()),
    latestManifestObjectKey: v.union(v.string(), v.null()),
    latestPayloadObjectKey: v.union(v.string(), v.null()),
    payloadSha256: v.union(v.string(), v.null()),
    manifestSha256: v.union(v.string(), v.null()),
    failureReason: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const latestVerification = await ctx.db
      .query('auditLedgerArchiveVerifications')
      .withIndex('by_chain_id_and_checked_at', (q) => q.eq('chainId', args.chainId))
      .order('desc')
      .first();

    if (
      latestVerification &&
      latestVerification.checkedAt === args.checkedAt &&
      latestVerification.lastVerificationStatus === args.lastVerificationStatus &&
      latestVerification.latestSealEndSequence === args.latestSealEndSequence &&
      latestVerification.latestExportEndSequence === args.latestExportEndSequence &&
      latestVerification.manifestSha256 === args.manifestSha256 &&
      latestVerification.payloadSha256 === args.payloadSha256
    ) {
      return null;
    }

    await ctx.db.insert('auditLedgerArchiveVerifications', args);
    return null;
  },
});

export const verifyAuditLedgerIntegrityInternal = internalAction({
  args: {},
  returns: auditLedgerIntegrityResultValidator,
  handler: async (ctx): Promise<AuditLedgerIntegrityResult> => {
    const checkedAt = Date.now();
    const state: AuditLedgerStateSnapshot | null = await ctx.runQuery(
      internal.audit.getAuditLedgerStateInternal,
      {},
    );
    const latestCheckpoint: AuditLedgerCheckpointDoc | null = await ctx.runQuery(
      internal.audit.getLatestAuditLedgerCheckpointInternal,
      {},
    );
    const latestSuccessfulCheckpoint: AuditLedgerCheckpointDoc | null = await ctx.runQuery(
      internal.audit.getLatestSuccessfulAuditLedgerCheckpointInternal,
      {},
    );
    const checkedFromSequence = latestSuccessfulCheckpoint
      ? latestSuccessfulCheckpoint.endSequence + 1
      : 1;
    const headSequence = state?.headSequence ?? 0;
    const headHash = state?.headEventHash ?? null;

    const persistResult = async (input: {
      failure: AuditLedgerVerificationFailure | null;
      verifiedEventCount: number;
      verifiedHeadHash: string | null;
    }) => {
      await ctx.runMutation(internal.audit.createAuditLedgerCheckpointInternal, {
        chainId: AUDIT_LEDGER_CHAIN_ID,
        startSequence: checkedFromSequence,
        endSequence: headSequence,
        headHash,
        status: input.failure ? 'failed' : 'ok',
        checkedAt,
        verifiedEventCount: input.verifiedEventCount,
        verifiedHeadHash: input.verifiedHeadHash,
        ...(input.failure ? { failure: input.failure } : {}),
      });

      if (!input.failure && input.verifiedEventCount > 0) {
        await ctx.runMutation(internal.audit.createAuditLedgerSealInternal, {
          chainId: AUDIT_LEDGER_CHAIN_ID,
          startSequence: checkedFromSequence,
          endSequence: headSequence,
          headHash,
          eventCount: input.verifiedEventCount,
          sealedAt: checkedAt,
        });
      }

      await ctx.runMutation(internal.securityOps.syncCurrentSecurityFindingsInternal, {
        actorUserId: 'system:audit-ledger',
      });

      return {
        chainId: AUDIT_LEDGER_CHAIN_ID,
        checkedAt,
        checkedFromSequence,
        checkedToSequence: headSequence,
        headHash,
        headSequence,
        ok: input.failure === null,
        verifiedEventCount: input.verifiedEventCount,
        failure: input.failure,
      };
    };

    if (!state || headSequence === 0) {
      return await persistResult({
        failure: null,
        verifiedEventCount: 0,
        verifiedHeadHash: headHash,
      });
    }

    if (latestSuccessfulCheckpoint) {
      if (latestSuccessfulCheckpoint.endSequence > headSequence) {
        return await persistResult({
          failure: {
            actualEventHash: headHash,
            actualPreviousEventHash: latestSuccessfulCheckpoint.headHash,
            eventId: latestSuccessfulCheckpoint._id,
            expectedPreviousEventHash: latestSuccessfulCheckpoint.headHash,
            expectedSequence: latestSuccessfulCheckpoint.endSequence,
            recomputedEventHash: latestSuccessfulCheckpoint.headHash ?? '',
          },
          verifiedEventCount: 0,
          verifiedHeadHash: latestSuccessfulCheckpoint.headHash,
        });
      }

      if (
        checkedFromSequence > headSequence &&
        latestSuccessfulCheckpoint.endSequence === headSequence &&
        latestSuccessfulCheckpoint.headHash !== headHash
      ) {
        return await persistResult({
          failure: {
            actualEventHash: headHash,
            actualPreviousEventHash: latestSuccessfulCheckpoint.headHash,
            eventId: latestSuccessfulCheckpoint._id,
            expectedPreviousEventHash: latestSuccessfulCheckpoint.headHash,
            expectedSequence: headSequence,
            recomputedEventHash: latestSuccessfulCheckpoint.headHash ?? '',
          },
          verifiedEventCount: 0,
          verifiedHeadHash: latestSuccessfulCheckpoint.headHash,
        });
      }
    }

    if (checkedFromSequence > headSequence) {
      return await persistResult({
        failure: null,
        verifiedEventCount: 0,
        verifiedHeadHash: headHash,
      });
    }

    let cursor: string | undefined;
    let expectedSequence = checkedFromSequence;
    let previousEventHash = latestSuccessfulCheckpoint?.headHash ?? null;
    let verifiedEventCount = 0;
    let failure: AuditLedgerVerificationFailure | null = null;
    let isDone = false;

    while (!isDone) {
      const page: {
        page: AuditLedgerEventDoc[];
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.audit.listAuditLedgerEventsForVerificationInternal, {
        cursor,
        endSequence: headSequence,
        startSequence: checkedFromSequence,
        numItems: AUDIT_FETCH_BATCH_SIZE,
      });

      for (const event of page.page) {
        const recomputedEventHash = await hashAuditPayload(
          buildAuditHashPayload({
            chainId: event.chainId,
            id: event.id,
            sequence: event.sequence,
            eventType: event.eventType,
            recordedAt: event.recordedAt,
            provenance: event.provenance,
            userId: event.userId,
            actorUserId: event.actorUserId,
            targetUserId: event.targetUserId,
            organizationId: event.organizationId,
            identifier: event.identifier,
            sessionId: event.sessionId,
            requestId: event.requestId,
            outcome: event.outcome,
            severity: event.severity,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            resourceLabel: event.resourceLabel,
            sourceSurface: event.sourceSurface,
            metadata: event.metadata,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            previousEventHash,
          }),
        );

        if (
          event.sequence !== expectedSequence ||
          event.previousEventHash !== previousEventHash ||
          event.eventHash !== recomputedEventHash
        ) {
          failure = {
            actualEventHash: event.eventHash,
            actualPreviousEventHash: event.previousEventHash,
            eventId: event.id,
            expectedPreviousEventHash: previousEventHash,
            expectedSequence,
            recomputedEventHash,
          };
          break;
        }

        previousEventHash = event.eventHash;
        expectedSequence += 1;
        verifiedEventCount += 1;
      }

      if (failure) {
        break;
      }

      cursor = page.isDone ? undefined : page.continueCursor;
      isDone = page.isDone || cursor === undefined;
    }

    if (!failure && previousEventHash !== headHash) {
      failure = {
        actualEventHash: headHash,
        actualPreviousEventHash:
          latestCheckpoint?.headHash ?? latestSuccessfulCheckpoint?.headHash ?? null,
        eventId: latestCheckpoint?._id ?? 'audit-ledger-head',
        expectedPreviousEventHash: previousEventHash,
        expectedSequence: headSequence,
        recomputedEventHash: previousEventHash ?? '',
      };
    }

    return await persistResult({
      failure,
      verifiedEventCount,
      verifiedHeadHash: previousEventHash,
    });
  },
});
