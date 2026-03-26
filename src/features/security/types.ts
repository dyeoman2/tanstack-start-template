import type { Id } from '@convex/_generated/dataModel';
import type {
  ActiveControlRecord,
  ControlChecklistEvidenceType,
} from '~/lib/shared/compliance/control-register';
import type {
  EVIDENCE_REVIEW_DUE_OPTIONS,
  EVIDENCE_SOURCE_OPTIONS,
} from '~/features/security/constants';

export type EvidenceReviewDueIntervalMonths = (typeof EVIDENCE_REVIEW_DUE_OPTIONS)[number];
export type EvidenceSource = (typeof EVIDENCE_SOURCE_OPTIONS)[number];
export type ReviewOriginEvidenceSource =
  | 'review_attestation'
  | 'review_document'
  | 'automated_review_result'
  | 'follow_up_resolution'
  | 'review_exception';
export type StoredEvidenceSource = EvidenceSource | ReviewOriginEvidenceSource;
export type EvidenceExpiryStatus = 'current' | 'expiring_soon' | 'expired' | 'none';
export type EvidenceSufficiency = 'missing' | 'partial' | 'sufficient';
export type SecuritySupport = 'missing' | 'partial' | 'complete';
export type SecurityPolicySupport = SecuritySupport;
export type SecurityEvidenceType =
  | 'file'
  | 'link'
  | 'note'
  | 'system_snapshot'
  | 'review_attestation'
  | 'review_document'
  | 'automated_review_result'
  | 'follow_up_resolution'
  | 'exception_record';
export type EvidenceReportKind =
  | 'security_posture'
  | 'audit_integrity'
  | 'audit_readiness'
  | 'annual_review'
  | 'findings_snapshot'
  | 'vendor_posture_snapshot'
  | 'control_workspace_snapshot';
export type VendorKey = 'openrouter' | 'resend' | 'sentry';
export type SecurityScopeType = 'provider_global';
export type SecurityScope = {
  scopeId: string;
  scopeType: SecurityScopeType;
};

export type LinkedEntitySummary = {
  entityId: string;
  entityType:
    | 'policy'
    | 'control'
    | 'checklist_item'
    | 'evidence'
    | 'finding'
    | 'vendor'
    | 'review_run'
    | 'review_task'
    | 'evidence_report';
  label: string;
  relationshipType:
    | 'follow_up_for'
    | 'has_evidence'
    | 'has_report'
    | 'has_review_task'
    | 'related_control'
    | 'satisfies'
    | 'supports'
    | 'tracks_finding'
    | 'tracks_vendor';
  status: string | null;
};

export type SecurityChecklistEvidence = {
  archivedAt: number | null;
  archivedByDisplay: string | null;
  createdAt: number;
  description: string | null;
  evidenceDate: number | null;
  evidenceType: SecurityEvidenceType;
  expiryStatus: EvidenceExpiryStatus;
  fileName: string | null;
  id: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded';
  mimeType: string | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths | null;
  reviewOriginReviewAttestationId: Id<'reviewAttestations'> | null;
  reviewOriginReviewRunId: Id<'reviewRuns'> | null;
  reviewOriginReviewTaskId: Id<'reviewTasks'> | null;
  reviewOriginReviewTaskResultId: Id<'reviewTaskResults'> | null;
  reviewOriginSourceId: string | null;
  reviewOriginSourceLabel: string | null;
  reviewOriginSourceType:
    | 'security_control_evidence'
    | 'evidence_report'
    | 'security_finding'
    | 'backup_verification_report'
    | 'external_document'
    | 'review_task'
    | 'vendor'
    | null;
  reviewStatus: 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
  validUntil: number | null;
  sizeBytes: number | null;
  source: StoredEvidenceSource | null;
  storageId: string | null;
  sufficiency: EvidenceSufficiency;
  title: string;
  uploadedByDisplay: string | null;
  url: string | null;
};

export type SecurityPostureSummary = {
  audit: {
    integrityFailures: number;
    lastEventAt: number | null;
    lastImmutableExportAt: number | null;
  };
  auth: {
    emailVerificationRequired: boolean;
    mfaCoveragePercent: number;
    mfaEnabledUsers: number;
    passkeyEnabledUsers: number;
    totalUsers: number;
  };
  backups: {
    lastCheckedAt: number | null;
    lastStatus: 'failure' | 'success' | null;
  };
  retention: {
    lastJobAt: number | null;
    lastJobStatus: 'failure' | 'success' | null;
  };
  scanner: {
    lastScanAt: number | null;
    quarantinedCount: number;
    rejectedCount: number;
    totalScans: number;
  };
  sessions: {
    freshWindowMinutes: number;
    sessionExpiryHours: number;
    temporaryLinkTtlMinutes: number;
  };
  telemetry: {
    sentryApproved: boolean;
    sentryEnabled: boolean;
  };
  vendors: Array<{
    allowedDataClasses: string[];
    allowedEnvironments: Array<'development' | 'production' | 'test'>;
    approvalEnvVar: string | null;
    approved: boolean;
    approvedByDefault: boolean;
    displayName: string;
    vendor: string;
  }>;
};

export type SecurityChecklistEvidenceActivity = {
  actorDisplay: string | null;
  createdAt: number;
  evidenceId: string;
  evidenceTitle: string;
  eventType:
    | 'security_control_evidence_created'
    | 'security_control_evidence_reviewed'
    | 'security_control_evidence_archived'
    | 'security_control_evidence_renewed';
  id: string;
  internalControlId: string;
  itemId: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded' | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewStatus: 'pending' | 'reviewed' | null;
};

export type SecurityChecklistItem = {
  completedAt: number | null;
  description: string;
  evidence: SecurityChecklistEvidence[];
  hasExpiringSoonEvidence: boolean;
  itemId: string;
  label: string;
  lastReviewedAt: number | null;
  owner: string | null;
  operatorNotes: string | null;
  required: boolean;
  reviewArtifact: {
    evidenceId: string;
    evidenceType: SecurityEvidenceType;
    relatedReports: Array<{
      id: Id<'evidenceReports'>;
      label: string;
      reportKind: EvidenceReportKind;
    }>;
    reviewRunId: string;
    reviewRunKind: 'annual' | 'triggered';
    reviewRunStatus: 'ready' | 'needs_attention' | 'completed';
    reviewRunTitle: string;
    reviewTaskId: string;
    reviewTaskTitle: string;
    satisfiedAt: number;
    satisfiedByDisplay: string | null;
    validUntil: number | null;
  } | null;
  support: SecuritySupport;
  suggestedEvidenceTypes: ControlChecklistEvidenceType[];
  verificationMethod: string;
};

export type SecurityControlWorkspaceDetail = Omit<
  ActiveControlRecord,
  'mappings' | 'platformChecklistItems'
> & {
  support: SecuritySupport;
  hasExpiringSoonEvidence: boolean;
  lastReviewedAt: number | null;
  linkedEntities: LinkedEntitySummary[];
  mappings: {
    csf20: Array<{
      label: string | null;
      subcategoryId: string;
    }>;
    hipaa: Array<{
      citation: string;
      implementationSpecification: 'addressable' | 'required' | null;
      text: string | null;
      title: string | null;
      type: 'implementation_specification' | 'section' | 'standard' | 'subsection' | null;
    }>;
    nist80066: Array<{
      label: string | null;
      mappingType: 'key-activity' | 'relationship' | 'sample-question' | null;
      referenceId: string;
    }>;
    soc2: Array<{
      criterionId: string;
      group:
        | 'availability'
        | 'common-criteria'
        | 'confidentiality'
        | 'privacy'
        | 'processing-integrity';
      label: string | null;
      trustServiceCategory:
        | 'availability'
        | 'confidentiality'
        | 'privacy'
        | 'processing-integrity'
        | 'security';
    }>;
  };
  platformChecklist: SecurityChecklistItem[];
} & SecurityScope;
export type SecurityControlWorkspaceExport = Omit<SecurityControlWorkspaceDetail, 'linkedEntities'>;
export type SecurityControlWorkspace = SecurityControlWorkspaceDetail;

export type SecurityControlWorkspaceSummary = Omit<
  ActiveControlRecord,
  'mappings' | 'platformChecklistItems'
> & {
  checklistStats: {
    completeCount: number;
    totalCount: number;
  };
  support: SecuritySupport;
  hasExpiringSoonEvidence: boolean;
  lastReviewedAt: number | null;
  mappings: SecurityControlWorkspaceDetail['mappings'];
  searchableText: string;
} & SecurityScope;

export type AuditReadinessOverview = {
  currentHead: {
    headHash: string | null;
    headSequence: number;
    updatedAt: number;
  } | null;
  latestBackupDrill: {
    artifactHash: string | null;
    checkedAt: number;
    drillId: string;
    drillType: 'operator_recorded' | 'restore_verification';
    failureReason: string | null;
    initiatedByKind: 'system' | 'user';
    initiatedByUserId: string | null;
    restoredItemCount: number;
    sourceDataset: string;
    status: 'failure' | 'success';
    targetEnvironment: 'development' | 'production' | 'test';
    verificationMethod: string;
  } | null;
  latestCheckpoint: {
    checkedAt: number;
    endSequence: number;
    headHash: string | null;
    startSequence: number;
    status: 'failed' | 'ok';
    verifiedEventCount: number;
  } | null;
  latestRetentionJob: {
    createdAt: number;
    details?: string;
    jobKind:
      | 'attachment_purge'
      | 'quarantine_cleanup'
      | 'temporary_artifact_purge'
      | 'phi_record_purge';
    processedCount: number;
    status: 'failure' | 'success';
  } | null;
  latestVerifiedCheckpoint: {
    checkedAt: number;
    endSequence: number;
    headHash: string | null;
    startSequence: number;
    verifiedEventCount: number;
  } | null;
  latestImmutableExport: {
    endSequence: number;
    exportedAt: number;
    headHash: string | null;
    objectKey: string;
  } | null;
  archiveStatus: {
    required: boolean;
    configured: boolean;
    exporterEnabled: boolean;
    latestSealEndSequence: number | null;
    latestExportEndSequence: number | null;
    lagCount: number;
    driftDetected: boolean;
    lastVerifiedAt: number | null;
    lastVerifiedSealEndSequence: number | null;
    lastVerificationStatus:
      | 'verified'
      | 'missing_object'
      | 'hash_mismatch'
      | 'no_seal'
      | 'disabled';
    latestManifestObjectKey: string | null;
    latestPayloadObjectKey: string | null;
    failureReason: string | null;
  };
  lastIntegrityFailure: {
    checkedAt: number;
    eventId: string;
    expectedSequence: number;
  } | null;
  lastSealAt: number | null;
  immutableExportHealthy: boolean;
  immutableExportLagCount: number;
  metadataGaps: Array<{
    createdAt: number;
    eventType: string;
    id: string;
    resourceId: string | null;
  }>;
  recentDeniedActions: Array<{
    createdAt: number;
    eventType: string;
    id: string;
    metadata: string | null;
    organizationId: string | null;
  }>;
  recentExports: Array<{
    artifactType: 'audit_csv' | 'directory_csv' | 'evidence_report_export';
    exportedAt: number;
    manifestHash: string;
    sourceReportId: Id<'evidenceReports'> | null;
  }>;
  sealCount: number;
  unverifiedTailCount: number;
};

export type EvidenceReportListItem = {
  id: Id<'evidenceReports'>;
  createdAt: number;
  generatedByUserId: string;
  customerSummary: string | null;
  internalNotes: string | null;
  reportKind: EvidenceReportKind;
  contentHash: string;
  latestExport: {
    exportHash: string;
    exportedAt: number;
    exportedByUserId: string;
    id: Id<'exportArtifacts'>;
    manifestHash: string;
  } | null;
  reviewStatus: 'needs_follow_up' | 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByUserId: string | null;
} & SecurityScope;

export type EvidenceReportDetail = {
  contentHash: string;
  contentJson: string;
  createdAt: number;
  generatedByUserId: string;
  id: Id<'evidenceReports'>;
  latestExport: {
    exportHash: string;
    exportedAt: number;
    exportedByUserId: string;
    id: Id<'exportArtifacts'>;
    integritySummary: {
      checkedAt: string | null;
      failureCount: number;
      verified: boolean;
    } | null;
    manifestHash: string;
    manifestJson: string;
    schemaVersion: string;
  } | null;
  linkedTasks: Array<{
    controlLinks: Array<{
      controlTitle: string | null;
      internalControlId: string;
      itemId: string;
      itemLabel: string | null;
      nist80053Id: string | null;
    }>;
    reviewRunId: Id<'reviewRuns'>;
    reviewRunKind: 'annual' | 'triggered';
    reviewRunStatus: 'ready' | 'needs_attention' | 'completed';
    reviewRunTitle: string;
    taskId: Id<'reviewTasks'>;
    taskStatus: 'ready' | 'completed' | 'exception' | 'blocked';
    taskTitle: string;
  }>;
  organizationId: string | null;
  reportKind: EvidenceReportKind;
  customerSummary: string | null;
  internalNotes: string | null;
  reviewStatus: 'needs_follow_up' | 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
} & SecurityScope;

export type SecurityFindingListItem = {
  customerSummary: string | null;
  description: string;
  disposition: 'accepted_risk' | 'false_positive' | 'investigating' | 'pending_review' | 'resolved';
  findingKey: string;
  findingType:
    | 'audit_integrity_failures'
    | 'audit_archive_health'
    | 'audit_request_context_gaps'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation';
  firstObservedAt: number;
  internalNotes: string | null;
  lastObservedAt: number;
  latestLinkedReviewRun: {
    id: Id<'reviewRuns'>;
    status: 'ready' | 'needs_attention' | 'completed';
    title: string;
  } | null;
  relatedControls: Array<{
    internalControlId: string;
    itemId: string | null;
    itemLabel: string | null;
    nist80053Id: string;
    title: string;
  }>;
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
  severity: 'critical' | 'info' | 'warning';
  sourceLabel: string;
  sourceRecordId: string | null;
  sourceType: 'audit_log' | 'security_control_evidence' | 'security_metric';
  status: 'open' | 'resolved';
  title: string;
} & SecurityScope;

export type ReviewRunSummary = {
  createdAt: number;
  finalizedAt: number | null;
  id: string;
  kind: 'annual' | 'triggered';
  status: 'ready' | 'needs_attention' | 'completed';
  taskCounts: {
    blocked: number;
    completed: number;
    exception: number;
    ready: number;
    total: number;
  };
  title: string;
  triggerType: string | null;
  year: number | null;
} & SecurityScope;

export type ReviewTaskEvidenceLink = {
  freshAt: number | null;
  id: string;
  linkedAt: number;
  linkedByDisplay: string | null;
  role: 'primary' | 'supporting' | 'blocking';
  sourceId: string;
  sourceLabel: string;
  sourceType:
    | 'security_control_evidence'
    | 'evidence_report'
    | 'security_finding'
    | 'backup_verification_report'
    | 'external_document'
    | 'review_task'
    | 'vendor';
};

export type ReviewTaskDetail = {
  allowException: boolean;
  controlLinks: Array<{
    controlTitle: string | null;
    internalControlId: string;
    itemId: string;
    itemLabel: string | null;
    nist80053Id: string | null;
  }>;
  description: string;
  evidenceLinks: ReviewTaskEvidenceLink[];
  freshnessWindowDays: number | null;
  id: string;
  latestAttestation: {
    documentLabel: string | null;
    documentUrl: string | null;
    documentVersion: string | null;
    statementKey: string;
    statementText: string;
    attestedAt: number;
    attestedByDisplay: string | null;
  } | null;
  latestNote: string | null;
  policy: {
    policyId: string;
    sourcePath: string;
    support: SecurityPolicySupport;
    title: string;
  } | null;
  policyControls: Array<{
    familyId: string;
    familyTitle: string;
    implementationSummary?: string;
    internalControlId: string;
    isPrimary: boolean;
    nist80053Id: string;
    platformChecklist: SecurityPolicyControlChecklistItem[];
    responsibility: 'customer' | 'platform' | 'shared-responsibility' | null;
    support: SecuritySupport;
    title: string;
  }>;
  vendor: {
    reviewStatus: 'current' | 'due_soon' | 'overdue';
    title: string;
    vendorKey: VendorKey;
  } | null;
  findingsSummary: {
    criticalOpenCount: number;
    lowerSeverityOpenCount: number;
    totalOpenCount: number;
    undispositionedCount: number;
  } | null;
  required: boolean;
  satisfiedAt: number | null;
  satisfiedThroughAt: number | null;
  status: 'ready' | 'completed' | 'exception' | 'blocked';
  taskType: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up';
  templateKey: string;
  title: string;
};

export type ReviewRunDetail = {
  createdAt: number;
  finalReportId: Id<'evidenceReports'> | null;
  finalizedAt: number | null;
  id: string;
  kind: 'annual' | 'triggered';
  sourceRecordId: string | null;
  sourceRecordType: string | null;
  status: 'ready' | 'needs_attention' | 'completed';
  tasks: ReviewTaskDetail[];
  title: string;
  triggerType: string | null;
  year: number | null;
} & SecurityScope;

export type VendorWorkspace = {
  allowedDataClasses: string[];
  allowedEnvironments: Array<'development' | 'production' | 'test'>;
  approvalEnvVar: string | null;
  approved: boolean;
  approvedByDefault: boolean;
  title: string;
  summary: string | null;
  linkedEntities: LinkedEntitySummary[];
  linkedAnnualReviewTask: {
    id: Id<'reviewTasks'>;
    status: 'ready' | 'completed' | 'exception' | 'blocked';
    title: string;
  } | null;
  linkedFollowUpRunId: Id<'reviewRuns'> | null;
  owner: string | null;
  relatedControls: Array<{
    internalControlId: string;
    itemId: string | null;
    itemLabel: string | null;
    nist80053Id: string;
    title: string;
  }>;
  reviewStatus: 'current' | 'due_soon' | 'overdue';
  lastReviewedAt: number | null;
  nextReviewAt: number | null;
  vendor: VendorKey;
} & SecurityScope;

export type SecurityWorkspaceOverview = {
  auditReadiness: AuditReadinessOverview;
  controlSummary: {
    bySupport: {
      missing: number;
      partial: number;
      complete: number;
    };
    byResponsibility: {
      customer: number;
      platform: number;
      sharedResponsibility: number;
    };
    totalControls: number;
  };
  currentAnnualReviewRun: ReviewRunSummary | null;
  findingSummary: {
    openCount: number;
    totalCount: number;
    undispositionedCount: number;
  };
  postureSummary: SecurityPostureSummary;
  queues: {
    blockedReviewTasks: number;
    missingSupportControls: number;
    pendingVendorReviews: number;
    undispositionedFindings: number;
  };
  vendorSummary: {
    approvedCount: number;
    dueSoonCount: number;
    overdueCount: number;
    totalCount: number;
  };
} & SecurityScope;

export type SecurityPolicySummary = {
  contentHash: string;
  lastReviewedAt: number | null;
  linkedAnnualReviewTask: {
    id: Id<'reviewTasks'>;
    status: 'ready' | 'completed' | 'exception' | 'blocked';
    title: string;
  } | null;
  mappedControlCount: number;
  mappedControlCountsBySupport: {
    complete: number;
    missing: number;
    partial: number;
  };
  nextReviewAt: number | null;
  owner: string;
  policyId: string;
  sourcePath: string;
  summary: string;
  support: SecurityPolicySupport;
  title: string;
} & SecurityScope;

export type SecurityPolicyControlChecklistItem = Pick<
  SecurityChecklistItem,
  'itemId' | 'label' | 'required' | 'support'
>;

export type SecurityPolicyControlMapping = {
  familyId: string;
  familyTitle: string;
  implementationSummary?: string;
  internalControlId: string;
  isPrimary: boolean;
  nist80053Id: string;
  platformChecklist: SecurityPolicyControlChecklistItem[];
  responsibility: 'customer' | 'platform' | 'shared-responsibility' | null;
  support: SecuritySupport;
  title: string;
};

export type SecurityPolicyDetail = {
  contentHash: string;
  lastReviewedAt: number | null;
  linkedAnnualReviewTask: SecurityPolicySummary['linkedAnnualReviewTask'];
  mappedControls: SecurityPolicyControlMapping[];
  nextReviewAt: number | null;
  owner: string;
  policyId: string;
  sourcePath: string;
  sourceMarkdown: string | null;
  summary: string;
  support: SecurityPolicySupport;
  title: string;
} & SecurityScope;

export type SecurityFindingsBoard = {
  findings: SecurityFindingListItem[];
  summary: {
    openCount: number;
    reviewPendingCount: number;
    totalCount: number;
  };
} & SecurityScope;

export type SecurityReportsBoard = {
  auditReadiness: AuditReadinessOverview;
  evidenceReports: EvidenceReportListItem[];
} & SecurityScope;
