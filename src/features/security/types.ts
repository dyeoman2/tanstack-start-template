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
export type EvidenceExpiryStatus = 'current' | 'expiring_soon' | 'none';
export type EvidenceSufficiency = 'missing' | 'partial' | 'sufficient';
export type EvidenceReportKind =
  | 'security_posture'
  | 'audit_integrity'
  | 'audit_readiness'
  | 'annual_review'
  | 'findings_snapshot'
  | 'vendor_posture_snapshot'
  | 'control_workspace_snapshot';
export type VendorKey = 'openrouter' | 'resend' | 'sentry';

export type LinkedEntitySummary = {
  entityId: string;
  entityType:
    | 'control'
    | 'checklist_item'
    | 'evidence'
    | 'finding'
    | 'vendor_review'
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
    | 'tracks_vendor_review';
  status: string | null;
};

export type SecurityChecklistEvidence = {
  archivedAt: number | null;
  archivedByDisplay: string | null;
  createdAt: number;
  description: string | null;
  evidenceDate: number | null;
  evidenceType: 'file' | 'link' | 'note' | 'system_snapshot';
  expiryStatus: EvidenceExpiryStatus;
  fileName: string | null;
  id: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded';
  mimeType: string | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewDueAt: number | null;
  reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths | null;
  reviewStatus: 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
  sizeBytes: number | null;
  source: EvidenceSource | null;
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
  evidenceSufficiency: 'missing' | 'partial' | 'sufficient';
  hasExpiringSoonEvidence: boolean;
  itemId: string;
  label: string;
  lastReviewedAt: number | null;
  owner: string | null;
  operatorNotes: string | null;
  required: boolean;
  reviewSatisfaction: {
    mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
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
    satisfiedThroughAt: number;
  } | null;
  status: 'done' | 'in_progress' | 'not_applicable' | 'not_started';
  suggestedEvidenceTypes: ControlChecklistEvidenceType[];
  verificationMethod: string;
};

export type SecurityControlWorkspace = Omit<
  ActiveControlRecord,
  'mappings' | 'platformChecklistItems'
> & {
  evidenceReadiness: 'missing' | 'partial' | 'ready';
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
  scopeId: string;
  scopeType: 'provider_global';
};

export type SecurityControlWorkspaceSummary = Omit<
  ActiveControlRecord,
  'mappings' | 'platformChecklistItems'
> & {
  checklistStats: {
    completeCount: number;
    totalCount: number;
  };
  evidenceReadiness: 'missing' | 'partial' | 'ready';
  hasExpiringSoonEvidence: boolean;
  lastReviewedAt: number | null;
  mappings: SecurityControlWorkspace['mappings'];
  searchableText: string;
};

export type AuditReadinessOverview = {
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
  latestRetentionJob: {
    createdAt: number;
    details?: string;
    jobKind: 'attachment_purge' | 'audit_export_cleanup' | 'quarantine_cleanup';
    processedCount: number;
    status: 'failure' | 'success';
  } | null;
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
};

export type EvidenceReportListItem = {
  id: Id<'evidenceReports'>;
  createdAt: number;
  generatedByUserId: string;
  internalReviewNotes: string | null;
  scopeId: string;
  scopeType: 'provider_global';
  reportKind: EvidenceReportKind;
  contentHash: string;
  exportHash: string | null;
  exportManifestHash: string | null;
  exportedAt: number | null;
  exportedByUserId: string | null;
  reviewStatus: 'needs_follow_up' | 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByUserId: string | null;
};

export type EvidenceReportDetail = {
  contentHash: string;
  contentJson: string;
  createdAt: number;
  exportBundleJson: string | null;
  exportHash: string | null;
  exportIntegritySummary: string | null;
  exportManifestHash: string | null;
  exportManifestJson: string | null;
  exportedAt: number | null;
  exportedByUserId: string | null;
  generatedByUserId: string;
  id: Id<'evidenceReports'>;
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
  scopeId: string;
  scopeType: 'provider_global';
  reportKind: EvidenceReportKind;
  internalReviewNotes: string | null;
  reviewStatus: 'needs_follow_up' | 'pending' | 'reviewed';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
};

export type SecurityFindingListItem = {
  customerSummary: string | null;
  description: string;
  disposition: 'accepted_risk' | 'false_positive' | 'investigating' | 'pending_review' | 'resolved';
  findingKey: string;
  findingType:
    | 'audit_integrity_failures'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation';
  firstObservedAt: number;
  internalReviewNotes: string | null;
  lastObservedAt: number;
  scopeId: string;
  scopeType: 'provider_global';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
  severity: 'critical' | 'info' | 'warning';
  sourceLabel: string;
  sourceRecordId: string | null;
  sourceType: 'audit_log' | 'security_control_evidence' | 'security_metric';
  status: 'open' | 'resolved';
  title: string;
};

export type ReviewRunSummary = {
  createdAt: number;
  finalizedAt: number | null;
  id: string;
  kind: 'annual' | 'triggered';
  scopeId: string;
  scopeType: 'provider_global';
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
};

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
    | 'vendor_review';
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
  scopeId: string;
  scopeType: 'provider_global';
  sourceRecordId: string | null;
  sourceRecordType: string | null;
  status: 'ready' | 'needs_attention' | 'completed';
  tasks: ReviewTaskDetail[];
  title: string;
  triggerType: string | null;
  year: number | null;
};

export type VendorWorkspace = {
  allowedDataClasses: string[];
  allowedEnvironments: Array<'development' | 'production' | 'test'>;
  approvalEnvVar: string | null;
  approved: boolean;
  approvedByDefault: boolean;
  customerSummary: string | null;
  displayName: string;
  linkedEntities: LinkedEntitySummary[];
  linkedFollowUpRunId: Id<'reviewRuns'> | null;
  owner: string | null;
  relatedControls: Array<{
    internalControlId: string;
    itemId: string | null;
    itemLabel: string | null;
    nist80053Id: string;
    title: string;
  }>;
  internalReviewNotes: string | null;
  reviewStatus: 'pending' | 'reviewed' | 'needs_follow_up';
  reviewedAt: number | null;
  reviewedByDisplay: string | null;
  scopeId: string;
  scopeType: 'provider_global';
  vendor: VendorKey;
};

export type SecurityWorkspaceOverview = {
  auditReadiness: AuditReadinessOverview;
  controlSummary: {
    byEvidence: {
      missing: number;
      partial: number;
      ready: number;
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
    missingEvidenceControls: number;
    pendingVendorReviews: number;
    undispositionedFindings: number;
  };
  scopeId: string;
  scopeType: 'provider_global';
  vendorSummary: {
    approvedCount: number;
    needsFollowUpCount: number;
    totalCount: number;
  };
};
