export const ORGANIZATION_LEGAL_HOLD_STATUS_VALUES = ['active', 'released'] as const;
export type OrganizationLegalHoldStatus = (typeof ORGANIZATION_LEGAL_HOLD_STATUS_VALUES)[number];

export const RETENTION_SCOPE_VERSION_VALUES = [
  'temporary_artifacts_only_v1',
  'full_phi_record_set_v2',
] as const;
export type RetentionScopeVersion = (typeof RETENTION_SCOPE_VERSION_VALUES)[number];

export const RETENTION_OPERATION_VALUES = ['delete', 'purge', 'cleanup', 'export'] as const;
export type RetentionOperation = (typeof RETENTION_OPERATION_VALUES)[number];

export const RETENTION_RESOURCE_TYPE_VALUES = [
  'audit_export',
  'chat_attachment',
  'chat_run',
  'chat_thread',
  'chat_thread_record_set',
  'chat_usage_event',
  'directory_export',
  'evidence_report_export',
  'organization_cleanup',
  'pdf_parse_job',
  'stored_file',
] as const;
export type RetentionResourceType = (typeof RETENTION_RESOURCE_TYPE_VALUES)[number];

export type HoldAwareOperationDecision = {
  allowed: boolean;
  legalHoldActive: boolean;
  legalHoldId: string | null;
  legalHoldReason: string | null;
  normalizedLegalHoldReason: string | null;
  operation: RetentionOperation;
  resourceId: string | null;
  resourceType: RetentionResourceType;
  retentionScopeVersion: RetentionScopeVersion;
};

export const RETENTION_DELETION_JOB_KIND_VALUES = [
  'temporary_artifact_purge',
  'phi_record_purge',
] as const;
export type RetentionDeletionJobKind = (typeof RETENTION_DELETION_JOB_KIND_VALUES)[number];

export const RETENTION_EVENT_TYPES = {
  holdApplied: 'retention_hold_applied',
  holdReleased: 'retention_hold_released',
  purgeCompleted: 'retention_purge_completed',
  purgeFailed: 'retention_purge_failed',
  purgeSkippedOnHold: 'retention_purge_skipped_on_hold',
} as const;

export const FULL_PHI_RETENTION_RESOURCE_CLASSIFICATION: Record<
  RetentionResourceType,
  {
    scopeVersion: RetentionScopeVersion;
    supportsExportDuringHold: boolean;
  }
> = {
  audit_export: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: true,
  },
  chat_attachment: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  chat_run: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  chat_thread: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  chat_thread_record_set: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  chat_usage_event: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  directory_export: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: true,
  },
  evidence_report_export: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: true,
  },
  organization_cleanup: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  pdf_parse_job: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
  stored_file: {
    scopeVersion: 'full_phi_record_set_v2',
    supportsExportDuringHold: false,
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeLegalHoldReason(_reason: string | null | undefined) {
  return 'active_legal_hold';
}

export function buildHoldAwareOperationDecision(args: {
  allowExportDuringHold?: boolean;
  legalHold: {
    id: string;
    reason: string;
    status: OrganizationLegalHoldStatus;
  } | null;
  operation: RetentionOperation;
  resourceId?: string | null;
  resourceType: RetentionResourceType;
}): HoldAwareOperationDecision {
  const classification = FULL_PHI_RETENTION_RESOURCE_CLASSIFICATION[args.resourceType];
  const legalHoldActive = args.legalHold?.status === 'active';
  const supportsExportDuringHold =
    classification.supportsExportDuringHold && args.allowExportDuringHold === true;
  const allowed = !legalHoldActive || (args.operation === 'export' && supportsExportDuringHold);

  return {
    allowed,
    legalHoldActive,
    legalHoldId: legalHoldActive ? (args.legalHold?.id ?? null) : null,
    legalHoldReason: legalHoldActive ? (args.legalHold?.reason ?? null) : null,
    normalizedLegalHoldReason: legalHoldActive
      ? normalizeLegalHoldReason(args.legalHold?.reason)
      : null,
    operation: args.operation,
    resourceId: args.resourceId ?? null,
    resourceType: args.resourceType,
    retentionScopeVersion: classification.scopeVersion,
  };
}

export function getTemporaryArtifactRetentionMs(dataRetentionDays: number) {
  return Math.max(1, Math.floor(dataRetentionDays)) * DAY_MS;
}

export function getTemporaryArtifactPurgeEligibleAt(args: {
  createdAt: number;
  dataRetentionDays: number;
}) {
  return args.createdAt + getTemporaryArtifactRetentionMs(args.dataRetentionDays);
}

export function getFullPhiRecordSetPurgeEligibleAt(args: {
  dataRetentionDays: number;
  lastActivityAt: number;
}) {
  return args.lastActivityAt + getTemporaryArtifactRetentionMs(args.dataRetentionDays);
}

export function chooseEarlierPurgeEligibleAt(
  left: number | null | undefined,
  right: number | null | undefined,
) {
  if (left === null || left === undefined) {
    return right ?? undefined;
  }
  if (right === null || right === undefined) {
    return left;
  }
  return Math.min(left, right);
}
