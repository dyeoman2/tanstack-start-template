import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import { getE2ETestSecret } from '../src/lib/server/env.server';
import { getRetentionPolicyConfig } from '../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';
import {
  ALWAYS_ON_REGULATED_BASELINE,
  REGULATED_ORGANIZATION_POLICY_DEFAULTS,
} from '../src/lib/shared/security-baseline';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
} from './auth/access';
import { fetchAllBetterAuthPasskeys, fetchAllBetterAuthUsers } from './lib/betterAuth';
import { createUploadTargetWithMode } from './storagePlatform';

const SECURITY_METRICS_KEY = 'global';
const MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const SECURITY_EVIDENCE_UPLOAD_RATE_LIMIT = {
  bucket: 'security:evidence-upload-target',
  config: {
    kind: 'token bucket' as const,
    rate: 12,
    period: 15 * 60 * 1000,
    capacity: 12,
  },
};

const securityPostureSummaryValidator = v.object({
  audit: v.object({
    integrityFailures: v.number(),
    lastEventAt: v.union(v.number(), v.null()),
  }),
  auth: v.object({
    emailVerificationRequired: v.boolean(),
    mfaCoveragePercent: v.number(),
    mfaEnabledUsers: v.number(),
    passkeyEnabledUsers: v.number(),
    totalUsers: v.number(),
  }),
  backups: v.object({
    lastCheckedAt: v.union(v.number(), v.null()),
    lastStatus: v.union(v.literal('success'), v.literal('failure'), v.null()),
  }),
  retention: v.object({
    lastJobAt: v.union(v.number(), v.null()),
    lastJobStatus: v.union(v.literal('success'), v.literal('failure'), v.null()),
  }),
  scanner: v.object({
    lastScanAt: v.union(v.number(), v.null()),
    quarantinedCount: v.number(),
    rejectedCount: v.number(),
    totalScans: v.number(),
  }),
  sessions: v.object({
    freshWindowMinutes: v.number(),
    sessionExpiryHours: v.number(),
    temporaryLinkTtlMinutes: v.number(),
  }),
  telemetry: v.object({
    sentryApproved: v.boolean(),
    sentryEnabled: v.boolean(),
  }),
  vendors: v.array(
    v.object({
      allowedDataClasses: v.array(v.string()),
      allowedEnvironments: v.array(
        v.union(v.literal('development'), v.literal('production'), v.literal('test')),
      ),
      approvalEnvVar: v.union(v.string(), v.null()),
      approved: v.boolean(),
      approvedByDefault: v.boolean(),
      displayName: v.string(),
      vendor: v.string(),
    }),
  ),
});

const securityFindingTypeValidator = v.union(
  v.literal('audit_integrity_failures'),
  v.literal('document_scan_quarantines'),
  v.literal('document_scan_rejections'),
  v.literal('release_security_validation'),
);
const securityFindingSeverityValidator = v.union(
  v.literal('info'),
  v.literal('warning'),
  v.literal('critical'),
);
const securityFindingStatusValidator = v.union(v.literal('open'), v.literal('resolved'));
const securityFindingDispositionValidator = v.union(
  v.literal('pending_review'),
  v.literal('investigating'),
  v.literal('accepted_risk'),
  v.literal('false_positive'),
  v.literal('resolved'),
);
const securityFindingSourceTypeValidator = v.union(
  v.literal('audit_log'),
  v.literal('security_metric'),
  v.literal('security_control_evidence'),
);
const securityFindingListItemValidator = v.object({
  description: v.string(),
  disposition: securityFindingDispositionValidator,
  findingKey: v.string(),
  findingType: securityFindingTypeValidator,
  firstObservedAt: v.number(),
  lastObservedAt: v.number(),
  reviewNotes: v.union(v.string(), v.null()),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByDisplay: v.union(v.string(), v.null()),
  severity: securityFindingSeverityValidator,
  sourceLabel: v.string(),
  sourceRecordId: v.union(v.string(), v.null()),
  sourceType: securityFindingSourceTypeValidator,
  status: securityFindingStatusValidator,
  title: v.string(),
});
const securityFindingListValidator = v.array(securityFindingListItemValidator);

const SECURITY_EVIDENCE_ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/markdown',
  'text/plain',
]);

const SECURITY_EVIDENCE_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.pdf',
  '.png',
  '.txt',
  '.webp',
  '.xlsx',
]);

function getLowercaseFileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const extensionIndex = normalized.lastIndexOf('.');
  return extensionIndex === -1 ? '' : normalized.slice(extensionIndex);
}

function validateSecurityEvidenceUploadInput(args: {
  contentType: string;
  fileName: string;
  fileSize: number;
}) {
  const normalizedName = args.fileName.trim();
  if (!normalizedName) {
    throw new Error('Evidence file name is required.');
  }

  if (!Number.isFinite(args.fileSize) || args.fileSize <= 0) {
    throw new Error('Evidence file must be larger than 0 bytes.');
  }

  if (args.fileSize > MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES) {
    throw new Error('Evidence file exceeds the 25MB server-side limit.');
  }

  const normalizedMimeType = args.contentType.trim().toLowerCase();
  const extension = getLowercaseFileExtension(normalizedName);
  const allowedByMime =
    normalizedMimeType.length > 0 && SECURITY_EVIDENCE_ALLOWED_MIME_TYPES.has(normalizedMimeType);
  const allowedByExtension =
    extension.length > 0 && SECURITY_EVIDENCE_ALLOWED_EXTENSIONS.has(extension);

  if (!allowedByMime && !allowedByExtension) {
    throw new Error('Evidence file type is not allowed for this workflow.');
  }
}

async function enforceSecurityEvidenceUploadRateLimit(
  ctx:
    | Pick<MutationCtx, 'runMutation'>
    | {
        runMutation: (
          ...args: Parameters<MutationCtx['runMutation']>
        ) => ReturnType<MutationCtx['runMutation']>;
      },
  actorUserId: string,
) {
  const result = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
    name: SECURITY_EVIDENCE_UPLOAD_RATE_LIMIT.bucket,
    key: actorUserId,
    config: SECURITY_EVIDENCE_UPLOAD_RATE_LIMIT.config,
  });

  if (!result.ok) {
    throw new Error('Too many evidence upload requests. Please try again later.');
  }
}

const evidenceReportValidator = v.object({
  createdAt: v.number(),
  exportHash: v.union(v.string(), v.null()),
  id: v.id('evidenceReports'),
  report: v.string(),
  reportKind: v.union(
    v.literal('security_posture'),
    v.literal('audit_integrity'),
    v.literal('audit_readiness'),
    v.literal('annual_review'),
    v.literal('findings_snapshot'),
    v.literal('vendor_posture_snapshot'),
    v.literal('control_workspace_snapshot'),
  ),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
});

const evidenceReportRecordValidator = v.object({
  _id: v.id('evidenceReports'),
  _creationTime: v.number(),
  organizationId: v.optional(v.string()),
  generatedByUserId: v.string(),
  reportKind: v.union(
    v.literal('security_posture'),
    v.literal('audit_integrity'),
    v.literal('audit_readiness'),
    v.literal('annual_review'),
    v.literal('findings_snapshot'),
    v.literal('vendor_posture_snapshot'),
    v.literal('control_workspace_snapshot'),
  ),
  contentJson: v.string(),
  contentHash: v.string(),
  exportBundleJson: v.optional(v.string()),
  exportHash: v.optional(v.string()),
  exportIntegritySummary: v.optional(v.string()),
  exportManifestJson: v.optional(v.string()),
  exportManifestHash: v.optional(v.string()),
  latestExportArtifactId: v.optional(v.id('exportArtifacts')),
  exportedAt: v.union(v.number(), v.null()),
  exportedByUserId: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByUserId: v.union(v.string(), v.null()),
  reviewNotes: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

const evidenceReportListItemValidator = v.object({
  id: v.id('evidenceReports'),
  createdAt: v.number(),
  generatedByUserId: v.string(),
  reportKind: v.union(
    v.literal('security_posture'),
    v.literal('audit_integrity'),
    v.literal('audit_readiness'),
    v.literal('annual_review'),
    v.literal('findings_snapshot'),
    v.literal('vendor_posture_snapshot'),
    v.literal('control_workspace_snapshot'),
  ),
  contentHash: v.string(),
  exportHash: v.union(v.string(), v.null()),
  exportManifestHash: v.union(v.string(), v.null()),
  exportedAt: v.union(v.number(), v.null()),
  exportedByUserId: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByUserId: v.union(v.string(), v.null()),
  reviewNotes: v.union(v.string(), v.null()),
});

const evidenceReportListValidator = v.array(evidenceReportListItemValidator);
const checklistStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('in_progress'),
  v.literal('done'),
  v.literal('not_applicable'),
);
const evidenceSufficiencyValidator = v.union(
  v.literal('missing'),
  v.literal('partial'),
  v.literal('sufficient'),
);
const evidenceReviewDueIntervalValidator = v.union(v.literal(3), v.literal(6), v.literal(12));
const evidenceSourceValidator = v.union(
  v.literal('manual_upload'),
  v.literal('internal_review'),
  v.literal('automated_system_check'),
  v.literal('external_report'),
  v.literal('vendor_attestation'),
);
const evidenceExpiryStatusValidator = v.union(
  v.literal('none'),
  v.literal('current'),
  v.literal('expiring_soon'),
);
const evidenceTypeValidator = v.union(
  v.literal('file'),
  v.literal('link'),
  v.literal('note'),
  v.literal('system_snapshot'),
);
const securityControlEvidenceAuditEventTypeValidator = v.union(
  v.literal('security_control_evidence_created'),
  v.literal('security_control_evidence_reviewed'),
  v.literal('security_control_evidence_archived'),
  v.literal('security_control_evidence_renewed'),
);
const evidenceLifecycleStatusValidator = v.union(
  v.literal('active'),
  v.literal('archived'),
  v.literal('superseded'),
);
const suggestedEvidenceTypeValidator = v.union(
  v.literal('file'),
  v.literal('link'),
  v.literal('note'),
  v.literal('system'),
);
const controlEvidenceValidator = v.object({
  createdAt: v.number(),
  description: v.union(v.string(), v.null()),
  evidenceType: evidenceTypeValidator,
  fileName: v.union(v.string(), v.null()),
  id: v.string(),
  lifecycleStatus: evidenceLifecycleStatusValidator,
  mimeType: v.union(v.string(), v.null()),
  archivedAt: v.union(v.number(), v.null()),
  archivedByDisplay: v.union(v.string(), v.null()),
  evidenceDate: v.union(v.number(), v.null()),
  expiryStatus: evidenceExpiryStatusValidator,
  renewedFromEvidenceId: v.union(v.string(), v.null()),
  replacedByEvidenceId: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed')),
  reviewDueAt: v.union(v.number(), v.null()),
  reviewDueIntervalMonths: v.union(evidenceReviewDueIntervalValidator, v.null()),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByDisplay: v.union(v.string(), v.null()),
  sizeBytes: v.union(v.number(), v.null()),
  source: v.union(evidenceSourceValidator, v.null()),
  storageId: v.union(v.string(), v.null()),
  sufficiency: evidenceSufficiencyValidator,
  title: v.string(),
  uploadedByDisplay: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
});
const controlChecklistItemValidator = v.object({
  completedAt: v.union(v.number(), v.null()),
  description: v.string(),
  evidence: v.array(controlEvidenceValidator),
  evidenceSufficiency: evidenceSufficiencyValidator,
  hasExpiringSoonEvidence: v.boolean(),
  itemId: v.string(),
  label: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  notes: v.union(v.string(), v.null()),
  owner: v.union(v.string(), v.null()),
  required: v.boolean(),
  reviewSatisfaction: v.union(
    v.object({
      mode: v.union(
        v.literal('automated_check'),
        v.literal('attestation'),
        v.literal('document_upload'),
        v.literal('follow_up'),
        v.literal('exception'),
      ),
      reviewRunId: v.id('reviewRuns'),
      reviewTaskId: v.id('reviewTasks'),
      satisfiedAt: v.number(),
      satisfiedByDisplay: v.union(v.string(), v.null()),
      satisfiedThroughAt: v.number(),
    }),
    v.null(),
  ),
  status: checklistStatusValidator,
  suggestedEvidenceTypes: v.array(suggestedEvidenceTypeValidator),
  verificationMethod: v.string(),
});
const securityControlEvidenceActivityEventValidator = v.object({
  id: v.string(),
  eventType: securityControlEvidenceAuditEventTypeValidator,
  actorDisplay: v.union(v.string(), v.null()),
  createdAt: v.number(),
  evidenceId: v.string(),
  evidenceTitle: v.string(),
  itemId: v.string(),
  internalControlId: v.string(),
  lifecycleStatus: v.union(evidenceLifecycleStatusValidator, v.null()),
  renewedFromEvidenceId: v.union(v.string(), v.null()),
  replacedByEvidenceId: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.null()),
});
const securityControlWorkspaceValidator = v.object({
  controlStatement: v.string(),
  customerResponsibilityNotes: v.union(v.string(), v.null()),
  evidenceReadiness: v.union(v.literal('ready'), v.literal('partial'), v.literal('missing')),
  familyId: v.string(),
  familyTitle: v.string(),
  hasExpiringSoonEvidence: v.boolean(),
  implementationSummary: v.string(),
  internalControlId: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  mappings: v.object({
    csf20: v.array(
      v.object({
        label: v.union(v.string(), v.null()),
        subcategoryId: v.string(),
      }),
    ),
    hipaa: v.array(
      v.object({
        citation: v.string(),
        implementationSpecification: v.union(
          v.literal('addressable'),
          v.literal('required'),
          v.null(),
        ),
        text: v.union(v.string(), v.null()),
        title: v.union(v.string(), v.null()),
        type: v.union(
          v.literal('implementation_specification'),
          v.literal('section'),
          v.literal('standard'),
          v.literal('subsection'),
          v.null(),
        ),
      }),
    ),
    nist80066: v.array(
      v.object({
        label: v.union(v.string(), v.null()),
        mappingType: v.union(
          v.literal('key-activity'),
          v.literal('relationship'),
          v.literal('sample-question'),
          v.null(),
        ),
        referenceId: v.string(),
      }),
    ),
    soc2: v.array(
      v.object({
        criterionId: v.string(),
        group: v.union(
          v.literal('availability'),
          v.literal('common-criteria'),
          v.literal('confidentiality'),
          v.literal('privacy'),
          v.literal('processing-integrity'),
        ),
        label: v.union(v.string(), v.null()),
        trustServiceCategory: v.union(
          v.literal('availability'),
          v.literal('confidentiality'),
          v.literal('privacy'),
          v.literal('processing-integrity'),
          v.literal('security'),
        ),
      }),
    ),
  }),
  nist80053Id: v.string(),
  owner: v.string(),
  platformChecklist: v.array(controlChecklistItemValidator),
  priority: v.union(v.literal('p0'), v.literal('p1'), v.literal('p2')),
  responsibility: v.union(
    v.literal('platform'),
    v.literal('shared-responsibility'),
    v.literal('customer'),
    v.null(),
  ),
  title: v.string(),
});
const securityControlWorkspaceListValidator = v.array(securityControlWorkspaceValidator);
const securityControlEvidenceActivityListValidator = v.array(
  securityControlEvidenceActivityEventValidator,
);
const evidenceReportKindValidator = v.union(
  v.literal('security_posture'),
  v.literal('audit_integrity'),
  v.literal('audit_readiness'),
  v.literal('annual_review'),
  v.literal('findings_snapshot'),
  v.literal('vendor_posture_snapshot'),
  v.literal('control_workspace_snapshot'),
);
const reviewRunKindValidator = v.union(v.literal('annual'), v.literal('triggered'));
const reviewRunStatusValidator = v.union(
  v.literal('ready'),
  v.literal('needs_attention'),
  v.literal('completed'),
);
const reviewTaskTypeValidator = v.union(
  v.literal('automated_check'),
  v.literal('attestation'),
  v.literal('document_upload'),
  v.literal('follow_up'),
);
const reviewTaskStatusValidator = v.union(
  v.literal('ready'),
  v.literal('completed'),
  v.literal('exception'),
  v.literal('blocked'),
);
const reviewTaskResultTypeValidator = v.union(
  v.literal('automated_check'),
  v.literal('attested'),
  v.literal('document_linked'),
  v.literal('exception_marked'),
  v.literal('follow_up_opened'),
  v.literal('resolved'),
);
const reviewSatisfactionModeValidator = v.union(reviewTaskTypeValidator, v.literal('exception'));
const reviewTaskEvidenceSourceTypeValidator = v.union(
  v.literal('security_control_evidence'),
  v.literal('evidence_report'),
  v.literal('security_finding'),
  v.literal('backup_verification_report'),
  v.literal('external_document'),
);
const reviewTaskEvidenceRoleValidator = v.union(
  v.literal('primary'),
  v.literal('supporting'),
  v.literal('blocking'),
);
const reviewTaskControlLinkValidator = v.object({
  internalControlId: v.string(),
  itemId: v.string(),
});
const reviewTaskEvidenceLinkValidator = v.object({
  id: v.id('reviewTaskEvidenceLinks'),
  freshAt: v.union(v.number(), v.null()),
  linkedAt: v.number(),
  linkedByDisplay: v.union(v.string(), v.null()),
  role: reviewTaskEvidenceRoleValidator,
  sourceId: v.string(),
  sourceLabel: v.string(),
  sourceType: reviewTaskEvidenceSourceTypeValidator,
});
const reviewAttestationValidator = v.object({
  documentLabel: v.union(v.string(), v.null()),
  documentUrl: v.union(v.string(), v.null()),
  documentVersion: v.union(v.string(), v.null()),
  statementKey: v.string(),
  statementText: v.string(),
  attestedAt: v.number(),
  attestedByDisplay: v.union(v.string(), v.null()),
});
const reviewTaskValidator = v.object({
  allowException: v.boolean(),
  controlLinks: v.array(reviewTaskControlLinkValidator),
  description: v.string(),
  evidenceLinks: v.array(reviewTaskEvidenceLinkValidator),
  freshnessWindowDays: v.union(v.number(), v.null()),
  id: v.id('reviewTasks'),
  latestAttestation: v.union(reviewAttestationValidator, v.null()),
  latestNote: v.union(v.string(), v.null()),
  required: v.boolean(),
  satisfiedAt: v.union(v.number(), v.null()),
  satisfiedThroughAt: v.union(v.number(), v.null()),
  status: reviewTaskStatusValidator,
  taskType: reviewTaskTypeValidator,
  templateKey: v.string(),
  title: v.string(),
});
const reviewRunSummaryValidator = v.object({
  createdAt: v.number(),
  finalizedAt: v.union(v.number(), v.null()),
  id: v.id('reviewRuns'),
  kind: reviewRunKindValidator,
  status: reviewRunStatusValidator,
  taskCounts: v.object({
    blocked: v.number(),
    completed: v.number(),
    exception: v.number(),
    ready: v.number(),
    total: v.number(),
  }),
  title: v.string(),
  triggerType: v.union(v.string(), v.null()),
  year: v.union(v.number(), v.null()),
});
const reviewRunDetailValidator = v.object({
  createdAt: v.number(),
  finalReportId: v.union(v.id('evidenceReports'), v.null()),
  finalizedAt: v.union(v.number(), v.null()),
  id: v.id('reviewRuns'),
  kind: reviewRunKindValidator,
  sourceRecordId: v.union(v.string(), v.null()),
  sourceRecordType: v.union(v.string(), v.null()),
  status: reviewRunStatusValidator,
  tasks: v.array(reviewTaskValidator),
  title: v.string(),
  triggerType: v.union(v.string(), v.null()),
  year: v.union(v.number(), v.null()),
});
const reviewRunSummaryListValidator = v.array(reviewRunSummaryValidator);
const exportArtifactTypeValidator = v.union(
  v.literal('audit_csv'),
  v.literal('directory_csv'),
  v.literal('evidence_report_export'),
);
const backupVerificationTargetEnvironmentValidator = v.union(
  v.literal('development'),
  v.literal('production'),
  v.literal('test'),
);
const backupVerificationDrillTypeValidator = v.union(
  v.literal('operator_recorded'),
  v.literal('restore_verification'),
);
const backupVerificationInitiatedByKindValidator = v.union(v.literal('system'), v.literal('user'));
const auditReadinessSnapshotValidator = v.object({
  latestBackupDrill: v.union(
    v.object({
      artifactHash: v.union(v.string(), v.null()),
      checkedAt: v.number(),
      drillId: v.string(),
      drillType: backupVerificationDrillTypeValidator,
      failureReason: v.union(v.string(), v.null()),
      initiatedByKind: backupVerificationInitiatedByKindValidator,
      initiatedByUserId: v.union(v.string(), v.null()),
      restoredItemCount: v.number(),
      sourceDataset: v.string(),
      status: v.union(v.literal('success'), v.literal('failure')),
      targetEnvironment: backupVerificationTargetEnvironmentValidator,
      verificationMethod: v.string(),
    }),
    v.null(),
  ),
  latestRetentionJob: v.union(
    v.object({
      createdAt: v.number(),
      details: v.optional(v.string()),
      jobKind: v.union(
        v.literal('attachment_purge'),
        v.literal('quarantine_cleanup'),
        v.literal('audit_export_cleanup'),
      ),
      processedCount: v.number(),
      status: v.union(v.literal('success'), v.literal('failure')),
    }),
    v.null(),
  ),
  metadataGaps: v.array(
    v.object({
      createdAt: v.number(),
      eventType: v.string(),
      id: v.string(),
      resourceId: v.union(v.string(), v.null()),
    }),
  ),
  recentDeniedActions: v.array(
    v.object({
      createdAt: v.number(),
      eventType: v.string(),
      id: v.string(),
      metadata: v.union(v.string(), v.null()),
      organizationId: v.union(v.string(), v.null()),
    }),
  ),
  recentExports: v.array(
    v.object({
      artifactType: exportArtifactTypeValidator,
      exportedAt: v.number(),
      manifestHash: v.string(),
      sourceReportId: v.union(v.id('evidenceReports'), v.null()),
    }),
  ),
});
const EXPORT_ARTIFACT_SCHEMA_VERSION = '2026-03-18.audit-evidence.v1';
const BACKUP_DRILL_STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RELEASE_PROVENANCE_CONTROL_ID = 'CTRL-CM-003';
const RELEASE_PROVENANCE_ITEM_ID = 'controlled-change-path';
const REVIEW_RUN_EXPORT_SCHEMA_VERSION = '2026-03-22.review-runs.v1';
const REVIEW_RUN_SOURCE_SURFACE = 'admin.security.reviews';
const ANNUAL_REVIEW_TASK_FRESHNESS_DAYS = 365;

type ReviewTaskBlueprint = {
  allowException: boolean;
  controlLinks: Array<{
    internalControlId: string;
    itemId: string;
  }>;
  description: string;
  freshnessWindowDays: number | null;
  required: boolean;
  statementKey: string | null;
  statementText: string | null;
  taskType: 'automated_check' | 'attestation' | 'document_upload';
  templateKey: string;
  title: string;
  automationKind?:
    | 'audit_readiness'
    | 'backup_verification'
    | 'control_workspace_snapshot'
    | 'findings_snapshot'
    | 'release_provenance'
    | 'security_posture'
    | 'vendor_posture_snapshot';
};

const ANNUAL_REVIEW_TASK_BLUEPRINTS: ReviewTaskBlueprint[] = [
  {
    allowException: false,
    automationKind: 'security_posture',
    controlLinks: [
      { internalControlId: 'CTRL-CA-007', itemId: 'posture-signals-collected' },
      { internalControlId: 'CTRL-CA-007', itemId: 'evidence-report-from-monitoring-state' },
    ],
    description: 'Generate and retain the current security posture summary for annual review.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:security-posture',
    title: 'Security posture summary is current',
  },
  {
    allowException: false,
    automationKind: 'audit_readiness',
    controlLinks: [
      { internalControlId: 'CTRL-CA-007', itemId: 'evidence-report-from-monitoring-state' },
      { internalControlId: 'CTRL-CA-005', itemId: 'follow-up-findings-can-be-surfaced' },
    ],
    description: 'Generate the current audit readiness report and retain it for annual review.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:audit-readiness',
    title: 'Audit readiness report is current',
  },
  {
    allowException: true,
    automationKind: 'findings_snapshot',
    controlLinks: [
      {
        internalControlId: 'CTRL-RA-005',
        itemId: 'security-findings-can-be-reviewed-and-prioritized',
      },
      { internalControlId: 'CTRL-CA-005', itemId: 'follow-up-findings-can-be-surfaced' },
    ],
    description:
      'Capture the current findings snapshot and verify any follow-up items are tracked.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:findings-snapshot',
    title: 'Security findings snapshot is current',
  },
  {
    allowException: false,
    automationKind: 'vendor_posture_snapshot',
    controlLinks: [
      {
        internalControlId: 'CTRL-SA-009',
        itemId: 'external-service-approval-state-can-be-reviewed',
      },
      {
        internalControlId: 'CTRL-CM-008',
        itemId: 'component-posture-can-be-reviewed-in-site-admin',
      },
    ],
    description: 'Capture the current vendor posture and approval state used for annual review.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:vendor-posture',
    title: 'Vendor posture snapshot is current',
  },
  {
    allowException: false,
    automationKind: 'control_workspace_snapshot',
    controlLinks: [
      { internalControlId: 'CTRL-AU-006', itemId: 'provider-review-procedure' },
      { internalControlId: 'CTRL-CA-007', itemId: 'evidence-report-from-monitoring-state' },
    ],
    description: 'Capture the current control workspace state for the annual review record.',
    freshnessWindowDays: 30,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:control-workspace',
    title: 'Control workspace snapshot is current',
  },
  {
    allowException: true,
    automationKind: 'backup_verification',
    controlLinks: [
      { internalControlId: 'CTRL-CP-009', itemId: 'backup-verification-records-maintained' },
      { internalControlId: 'CTRL-CP-009', itemId: 'restore-testing-recorded' },
    ],
    description: 'Link the latest backup verification and restore evidence into the annual review.',
    freshnessWindowDays: 90,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:backup-verification',
    title: 'Backup verification evidence is current',
  },
  {
    allowException: true,
    automationKind: 'release_provenance',
    controlLinks: [
      { internalControlId: 'CTRL-CM-003', itemId: 'automated-guardrail-checks' },
      { internalControlId: 'CTRL-CM-003', itemId: 'controlled-change-path' },
    ],
    description:
      'Link the latest release provenance and guardrail evidence into the annual review.',
    freshnessWindowDays: 90,
    required: true,
    statementKey: null,
    statementText: null,
    taskType: 'automated_check',
    templateKey: 'annual:auto:release-provenance',
    title: 'Release provenance evidence is current',
  },
  {
    allowException: false,
    controlLinks: [
      {
        internalControlId: 'CTRL-AT-002',
        itemId: 'provider-security-awareness-program-documented',
      },
    ],
    description:
      'Review the provider security-awareness training program and confirm it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'security-awareness-program-current',
    statementText:
      'I reviewed the provider security-awareness training program and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:security-awareness-program',
    title: 'Security awareness training program reviewed',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-IR-004', itemId: 'provider-incident-response-procedure' },
    ],
    description: 'Review the incident response procedure and attest that it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'incident-response-procedure-current',
    statementText: 'I reviewed the provider incident response procedure and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:incident-response-procedure',
    title: 'Incident response procedure reviewed',
  },
  {
    allowException: false,
    controlLinks: [{ internalControlId: 'CTRL-AU-006', itemId: 'provider-review-procedure' }],
    description: 'Review the audit review procedure and attest that it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'audit-review-procedure-current',
    statementText: 'I reviewed the provider audit review procedure and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:audit-review-procedure',
    title: 'Audit review procedure reviewed',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-CM-002', itemId: 'provider-baseline-review-procedure-documented' },
    ],
    description: 'Review the baseline review procedure and confirm current baseline expectations.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'baseline-review-procedure-current',
    statementText:
      'I reviewed the provider baseline review procedure and the current baseline remains appropriate.',
    taskType: 'attestation',
    templateKey: 'annual:attest:baseline-review',
    title: 'Baseline review completed',
  },
  {
    allowException: true,
    controlLinks: [
      {
        internalControlId: 'CTRL-CM-003',
        itemId: 'provider-change-approval-and-rollback-procedure-documented',
      },
    ],
    description:
      'Review the change approval and rollback procedure and confirm it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'change-procedure-current',
    statementText:
      'I reviewed the provider change approval and rollback procedure and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:change-procedure',
    title: 'Change procedure reviewed',
  },
  {
    allowException: true,
    controlLinks: [
      {
        internalControlId: 'CTRL-CM-008',
        itemId: 'provider-component-inventory-review-procedure-documented',
      },
    ],
    description:
      'Review the managed-component inventory review procedure and confirm it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'component-inventory-review-current',
    statementText:
      'I reviewed the managed-component inventory review procedure and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:inventory-review',
    title: 'Component inventory review completed',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-CP-004', itemId: 'provider-contingency-test-plan-documented' },
    ],
    description:
      'Review the contingency test plan and confirm the current cadence and expectations remain appropriate.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'contingency-test-plan-current',
    statementText: 'I reviewed the contingency test plan and its cadence and they remain current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:contingency-test-plan',
    title: 'Contingency test plan reviewed',
  },
  {
    allowException: true,
    controlLinks: [
      {
        internalControlId: 'CTRL-SC-013',
        itemId: 'provider-cryptography-standard-selection-documented',
      },
    ],
    description:
      'Review the provider cryptography standard selection and confirm it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'cryptography-standard-current',
    statementText:
      'I reviewed the provider cryptography standard selection and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:cryptography-standard',
    title: 'Cryptography standard reviewed',
  },
  {
    allowException: true,
    controlLinks: [{ internalControlId: 'CTRL-SI-004', itemId: 'provider-alert-procedure' }],
    description: 'Review the monitoring response procedure and confirm it remains current.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'monitoring-procedure-current',
    statementText: 'I reviewed the provider monitoring response procedure and it remains current.',
    taskType: 'attestation',
    templateKey: 'annual:attest:monitoring-procedure',
    title: 'Monitoring procedure reviewed',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-CA-002', itemId: 'provider-assessment-plan-documented' },
    ],
    description: 'Attach or link the current control assessment plan and confirm its version.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'assessment-plan-current',
    statementText: 'I linked the current control assessment plan used for the annual review.',
    taskType: 'document_upload',
    templateKey: 'annual:document:assessment-plan',
    title: 'Control assessment plan linked',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-CA-005', itemId: 'provider-poam-workflow-documented' },
    ],
    description:
      'Attach or link the current plan-of-action workflow artifact and confirm its version.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'poam-workflow-current',
    statementText:
      'I linked the current plan-of-action workflow artifact used for the annual review.',
    taskType: 'document_upload',
    templateKey: 'annual:document:poam-workflow',
    title: 'Plan-of-action workflow linked',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-CP-002', itemId: 'provider-contingency-plan-documented' },
    ],
    description: 'Attach or link the current contingency plan and confirm its version.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'contingency-plan-current',
    statementText: 'I linked the current contingency plan used for the annual review.',
    taskType: 'document_upload',
    templateKey: 'annual:document:contingency-plan',
    title: 'Contingency plan linked',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-IR-008', itemId: 'provider-incident-response-plan-documented' },
      {
        internalControlId: 'CTRL-IR-008',
        itemId: 'provider-incident-response-plan-review-cadence-documented',
      },
    ],
    description: 'Attach or link the current incident response plan and confirm its version.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'incident-response-plan-current',
    statementText: 'I linked the current incident response plan used for the annual review.',
    taskType: 'document_upload',
    templateKey: 'annual:document:incident-response-plan',
    title: 'Incident response plan linked',
  },
  {
    allowException: true,
    controlLinks: [
      { internalControlId: 'CTRL-PL-002', itemId: 'provider-plan-review-and-approval-documented' },
    ],
    description:
      'Attach or link the current system security and privacy plan artifact and confirm its version.',
    freshnessWindowDays: ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    required: true,
    statementKey: 'security-privacy-plan-current',
    statementText:
      'I linked the current system security and privacy plan artifact used for the annual review.',
    taskType: 'document_upload',
    templateKey: 'annual:document:security-privacy-plan',
    title: 'Security and privacy plan linked',
  },
];

function stringifyStable(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function hashContent(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

function addDays(timestamp: number, days: number) {
  return timestamp + days * 24 * 60 * 60 * 1000;
}

function getCurrentAnnualReviewYear() {
  return new Date().getUTCFullYear();
}

function getAnnualReviewRunKey(year: number) {
  return `annual:${year}`;
}

function getAnnualReviewRunTitle(year: number) {
  return `Annual Security Review ${year}`;
}

function isReviewSatisfactionCurrent(input: { satisfiedAt: number; satisfiedThroughAt: number }) {
  const now = Date.now();
  return input.satisfiedAt <= now && input.satisfiedThroughAt >= now;
}

type ExportManifest = {
  actorUserId: string;
  contentHash: string;
  exactFilters: Record<string, unknown>;
  exportHash: string;
  exportId: string;
  exportedAt: string;
  integritySummary: {
    checkedAt: string | null;
    failureCount: number;
    limit: number;
    verified: boolean;
  };
  organizationScope: string | null;
  reviewStatusAtExport: 'pending' | 'reviewed' | 'needs_follow_up' | null;
  rowCount: number;
  schemaVersion: string;
  sourceReportId: string | null;
};

export function buildExportManifest(input: {
  actorUserId: string;
  contentHash: string;
  exactFilters: Record<string, unknown>;
  exportHash: string;
  exportId: string;
  exportedAt: number;
  integritySummary: {
    checkedAt: number | null;
    failureCount: number;
    limit: number;
    verified: boolean;
  };
  organizationScope: string | null;
  reviewStatusAtExport: 'pending' | 'reviewed' | 'needs_follow_up' | null;
  rowCount: number;
  sourceReportId: string | null;
}): ExportManifest {
  return {
    actorUserId: input.actorUserId,
    contentHash: input.contentHash,
    exactFilters: input.exactFilters,
    exportHash: input.exportHash,
    exportId: input.exportId,
    exportedAt: new Date(input.exportedAt).toISOString(),
    integritySummary: {
      checkedAt:
        input.integritySummary.checkedAt === null
          ? null
          : new Date(input.integritySummary.checkedAt).toISOString(),
      failureCount: input.integritySummary.failureCount,
      limit: input.integritySummary.limit,
      verified: input.integritySummary.verified,
    },
    organizationScope: input.organizationScope,
    reviewStatusAtExport: input.reviewStatusAtExport,
    rowCount: input.rowCount,
    schemaVersion: EXPORT_ARTIFACT_SCHEMA_VERSION,
    sourceReportId: input.sourceReportId,
  };
}

export function summarizeIntegrityCheck(integrityCheck: {
  checkedAt?: number;
  failures?: unknown[];
  limit?: number;
  verified?: boolean;
}) {
  return {
    checkedAt: typeof integrityCheck.checkedAt === 'number' ? integrityCheck.checkedAt : null,
    failureCount: Array.isArray(integrityCheck.failures) ? integrityCheck.failures.length : 0,
    limit: typeof integrityCheck.limit === 'number' ? integrityCheck.limit : 0,
    verified: integrityCheck.verified === true,
  };
}

function deriveItemEvidenceSufficiency(
  evidence: Array<{
    lifecycleStatus: 'active' | 'archived' | 'superseded';
    reviewStatus: 'pending' | 'reviewed';
    sufficiency: 'missing' | 'partial' | 'sufficient';
  }>,
) {
  const reviewedEvidence = evidence.filter(
    (item) => item.lifecycleStatus === 'active' && item.reviewStatus === 'reviewed',
  );

  if (reviewedEvidence.some((item) => item.sufficiency === 'sufficient')) {
    return 'sufficient' as const;
  }
  if (reviewedEvidence.some((item) => item.sufficiency === 'partial')) {
    return 'partial' as const;
  }
  return 'missing' as const;
}

function deriveChecklistItemStatus(
  evidence: Array<{
    lifecycleStatus: 'active' | 'archived' | 'superseded';
    reviewStatus: 'pending' | 'reviewed';
  }>,
) {
  const activeEvidence = evidence.filter((item) => item.lifecycleStatus === 'active');
  if (activeEvidence.length === 0) {
    return 'not_started' as const;
  }
  if (activeEvidence.every((item) => item.reviewStatus === 'reviewed')) {
    return 'done' as const;
  }
  return 'in_progress' as const;
}

function addMonths(timestamp: number, months: 3 | 6 | 12): number {
  const date = new Date(timestamp);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}

function deriveEvidenceExpiryStatus(input: {
  reviewDueAt: number | null;
  reviewedAt: number | null;
}) {
  if (input.reviewDueAt === null || input.reviewedAt === null) {
    return 'none' as const;
  }

  const now = Date.now();
  if (input.reviewDueAt <= now) {
    return 'current' as const;
  }

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (input.reviewDueAt - now <= thirtyDaysMs) {
    return 'expiring_soon' as const;
  }

  return 'current' as const;
}

function getActorDisplayName(
  actorDisplayById: Map<string, string | null>,
  authUserId: string | undefined,
) {
  if (!authUserId) {
    return null;
  }
  if (authUserId.startsWith('system:')) {
    return 'System automation';
  }
  return actorDisplayById.get(authUserId) ?? 'Unknown';
}

async function resolveSeedSiteAdminActor(
  ctx: QueryCtx,
  preferredAuthUserId?: string,
): Promise<{ authUserId: string | null; displayName: string }> {
  if (preferredAuthUserId) {
    const preferredProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', preferredAuthUserId))
      .first();

    if (preferredProfile) {
      return {
        authUserId: preferredAuthUserId,
        displayName:
          preferredProfile.name?.trim() || preferredProfile.email?.trim() || 'Site admin',
      };
    }
  }

  const adminProfiles = await ctx.db
    .query('userProfiles')
    .withIndex('by_role_and_created_at', (q) => q.eq('role', 'admin'))
    .collect();
  const siteAdminProfile = adminProfiles.find((profile) => profile.isSiteAdmin);

  if (!siteAdminProfile) {
    return {
      authUserId: null,
      displayName: 'Site admin',
    };
  }

  return {
    authUserId: siteAdminProfile.authUserId,
    displayName: siteAdminProfile.name?.trim() || siteAdminProfile.email?.trim() || 'Site admin',
  };
}

async function recordSecurityControlEvidenceAuditEvent(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    evidenceId: string;
    evidenceTitle: string;
    eventType:
      | 'security_control_evidence_created'
      | 'security_control_evidence_reviewed'
      | 'security_control_evidence_archived'
      | 'security_control_evidence_renewed';
    evidenceType: 'file' | 'link' | 'note' | 'system_snapshot';
    internalControlId: string;
    itemId: string;
    lifecycleStatus?: 'active' | 'archived' | 'superseded';
    organizationId?: string;
    replacedByEvidenceId?: string;
    reviewStatus?: 'pending' | 'reviewed';
    renewedFromEvidenceId?: string;
  },
) {
  const auditEventId = crypto.randomUUID();
  const createdAt = Date.now();

  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    createdAt,
    actorUserId: args.actorUserId,
    userId: args.actorUserId,
    organizationId: args.organizationId,
    requestId: auditEventId,
    outcome: 'success',
    severity: 'info',
    eventType: args.eventType,
    resourceType: 'security_control_evidence',
    resourceId: args.evidenceId,
    resourceLabel: args.evidenceTitle,
    sourceSurface: 'security_admin_controls',
    metadata: stringifyStable({
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: args.evidenceType,
      lifecycleStatus: args.lifecycleStatus ?? null,
      reviewStatus: args.reviewStatus ?? null,
      renewedFromEvidenceId: args.renewedFromEvidenceId ?? null,
      replacedByEvidenceId: args.replacedByEvidenceId ?? null,
    }),
  });

  await upsertSecurityControlEvidenceActivity(ctx, {
    actorUserId: args.actorUserId,
    auditEventId,
    createdAt,
    eventType: args.eventType,
    evidenceId: args.evidenceId,
    evidenceTitle: args.evidenceTitle,
    internalControlId: args.internalControlId,
    itemId: args.itemId,
    lifecycleStatus: args.lifecycleStatus ?? null,
    renewedFromEvidenceId: args.renewedFromEvidenceId ?? null,
    replacedByEvidenceId: args.replacedByEvidenceId ?? null,
    reviewStatus: args.reviewStatus ?? null,
  });
}

async function updateSecurityMetrics(
  ctx: MutationCtx,
  args: {
    resultStatus: 'accepted' | 'inspection_failed' | 'quarantined' | 'rejected';
    scannedAt: number;
  },
) {
  const existing = await ctx.db
    .query('securityMetrics')
    .withIndex('by_key', (q) => q.eq('key', SECURITY_METRICS_KEY))
    .first();
  const now = Date.now();

  if (!existing) {
    await ctx.db.insert('securityMetrics', {
      key: SECURITY_METRICS_KEY,
      totalDocumentScans: 1,
      quarantinedDocumentScans: args.resultStatus === 'quarantined' ? 1 : 0,
      rejectedDocumentScans: args.resultStatus === 'rejected' ? 1 : 0,
      lastDocumentScanAt: args.scannedAt,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    totalDocumentScans: existing.totalDocumentScans + 1,
    quarantinedDocumentScans:
      existing.quarantinedDocumentScans + (args.resultStatus === 'quarantined' ? 1 : 0),
    rejectedDocumentScans:
      existing.rejectedDocumentScans + (args.resultStatus === 'rejected' ? 1 : 0),
    lastDocumentScanAt:
      existing.lastDocumentScanAt === null
        ? args.scannedAt
        : Math.max(existing.lastDocumentScanAt, args.scannedAt),
    updatedAt: now,
  });
}

async function _getSecurityMetricsSnapshot(ctx: QueryCtx) {
  const existing = await ctx.db
    .query('securityMetrics')
    .withIndex('by_key', (q) => q.eq('key', SECURITY_METRICS_KEY))
    .first();

  if (existing) {
    return existing;
  }

  const [latestScan, totalScans, quarantinedScans, rejectedScans] = await Promise.all([
    ctx.db.query('documentScanEvents').withIndex('by_created_at').order('desc').first(),
    countQueryResults(ctx.db.query('documentScanEvents').withIndex('by_created_at')),
    countQueryResults(
      ctx.db
        .query('documentScanEvents')
        .withIndex('by_result_status_and_created_at', (q) => q.eq('resultStatus', 'quarantined')),
    ),
    countQueryResults(
      ctx.db
        .query('documentScanEvents')
        .withIndex('by_result_status_and_created_at', (q) => q.eq('resultStatus', 'rejected')),
    ),
  ]);

  return {
    _id: null,
    totalDocumentScans: totalScans,
    quarantinedDocumentScans: quarantinedScans,
    rejectedDocumentScans: rejectedScans,
    lastDocumentScanAt: latestScan?.createdAt ?? null,
    updatedAt: latestScan?.createdAt ?? null,
    key: SECURITY_METRICS_KEY,
  };
}

type SecurityFindingSnapshot = {
  description: string;
  findingKey: string;
  findingType:
    | 'audit_integrity_failures'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation';
  firstObservedAt: number;
  lastObservedAt: number;
  severity: 'info' | 'warning' | 'critical';
  sourceLabel: string;
  sourceRecordId: string | null;
  sourceType: 'audit_log' | 'security_metric' | 'security_control_evidence';
  status: 'open' | 'resolved';
  title: string;
};

function compareSecurityFindingSeverity(
  severity: 'info' | 'warning' | 'critical',
  other: 'info' | 'warning' | 'critical',
) {
  const rank = {
    info: 0,
    warning: 1,
    critical: 2,
  } as const;

  return rank[other] - rank[severity];
}

async function buildCurrentSecurityFindings(ctx: QueryCtx): Promise<SecurityFindingSnapshot[]> {
  const metrics = await _getSecurityMetricsSnapshot(ctx);
  const referenceTime = Date.now();
  const [integrityFailures, latestIntegrityFailure, releaseEvidenceRows] = await Promise.all([
    countQueryResults(
      ctx.db
        .query('auditLogs')
        .withIndex('by_eventType_and_createdAt', (q) =>
          q.eq('eventType', 'audit_integrity_check_failed'),
        ),
    ),
    ctx.db
      .query('auditLogs')
      .withIndex('by_eventType_and_createdAt', (q) =>
        q.eq('eventType', 'audit_integrity_check_failed'),
      )
      .order('desc')
      .first(),
    ctx.db
      .query('securityControlEvidence')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q
          .eq('internalControlId', RELEASE_PROVENANCE_CONTROL_ID)
          .eq('itemId', RELEASE_PROVENANCE_ITEM_ID),
      )
      .collect(),
  ]);

  const findings: SecurityFindingSnapshot[] = [
    {
      findingKey: 'audit_integrity_failures',
      findingType: 'audit_integrity_failures',
      title: 'Audit integrity monitoring',
      description:
        integrityFailures > 0
          ? `${integrityFailures} audit integrity failure signal${integrityFailures === 1 ? '' : 's'} recorded in the current audit log review set.`
          : 'No audit integrity failures are present in the current review set.',
      severity: integrityFailures > 0 ? 'critical' : 'info',
      status: integrityFailures > 0 ? 'open' : 'resolved',
      sourceType: 'audit_log',
      sourceLabel: 'Audit log integrity verification',
      sourceRecordId: latestIntegrityFailure?._id ?? null,
      firstObservedAt: latestIntegrityFailure?.createdAt ?? referenceTime,
      lastObservedAt: latestIntegrityFailure?.createdAt ?? referenceTime,
    },
    {
      findingKey: 'document_scan_quarantines',
      findingType: 'document_scan_quarantines',
      title: 'Document scan quarantine monitoring',
      description:
        metrics.quarantinedDocumentScans > 0
          ? `${metrics.quarantinedDocumentScans} quarantined document scan finding${metrics.quarantinedDocumentScans === 1 ? '' : 's'} are retained for provider review.`
          : 'No quarantined document scan findings are present in the current metrics snapshot.',
      severity: metrics.quarantinedDocumentScans > 0 ? 'warning' : 'info',
      status: metrics.quarantinedDocumentScans > 0 ? 'open' : 'resolved',
      sourceType: 'security_metric',
      sourceLabel: 'Document scan metrics snapshot',
      sourceRecordId: null,
      firstObservedAt: metrics.lastDocumentScanAt ?? referenceTime,
      lastObservedAt: metrics.lastDocumentScanAt ?? referenceTime,
    },
    {
      findingKey: 'document_scan_rejections',
      findingType: 'document_scan_rejections',
      title: 'Document scan rejection monitoring',
      description:
        metrics.rejectedDocumentScans > 0
          ? `${metrics.rejectedDocumentScans} rejected document scan finding${metrics.rejectedDocumentScans === 1 ? '' : 's'} are retained for provider review.`
          : 'No rejected document scan findings are present in the current metrics snapshot.',
      severity: metrics.rejectedDocumentScans > 0 ? 'warning' : 'info',
      status: metrics.rejectedDocumentScans > 0 ? 'open' : 'resolved',
      sourceType: 'security_metric',
      sourceLabel: 'Document scan metrics snapshot',
      sourceRecordId: null,
      firstObservedAt: metrics.lastDocumentScanAt ?? referenceTime,
      lastObservedAt: metrics.lastDocumentScanAt ?? referenceTime,
    },
  ];

  const latestReleaseEvidence = [...releaseEvidenceRows]
    .filter(
      (row) =>
        row.lifecycleStatus !== 'archived' &&
        row.lifecycleStatus !== 'superseded' &&
        row.source === 'automated_system_check',
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];

  if (latestReleaseEvidence) {
    findings.push({
      findingKey: 'release_security_validation',
      findingType: 'release_security_validation',
      title: 'Release security validation monitoring',
      description:
        latestReleaseEvidence.sufficiency === 'partial'
          ? 'The latest retained release validation evidence includes a partial security outcome that still requires provider follow-up.'
          : 'The latest retained release validation evidence shows a sufficient security outcome for the monitored release path.',
      severity: latestReleaseEvidence.sufficiency === 'partial' ? 'warning' : 'info',
      status: latestReleaseEvidence.sufficiency === 'partial' ? 'open' : 'resolved',
      sourceType: 'security_control_evidence',
      sourceLabel: latestReleaseEvidence.title,
      sourceRecordId: latestReleaseEvidence._id,
      firstObservedAt: latestReleaseEvidence.evidenceDate ?? latestReleaseEvidence.createdAt,
      lastObservedAt: latestReleaseEvidence.evidenceDate ?? latestReleaseEvidence.createdAt,
    });
  }

  return findings.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'open' ? -1 : 1;
    }

    const severityComparison = compareSecurityFindingSeverity(left.severity, right.severity);
    if (severityComparison !== 0) {
      return severityComparison;
    }

    return right.lastObservedAt - left.lastObservedAt;
  });
}

async function upsertSecurityControlEvidenceActivity(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
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
  },
) {
  const existing = await ctx.db
    .query('securityControlEvidenceActivity')
    .withIndex('by_audit_event_id', (q) => q.eq('auditEventId', args.auditEventId))
    .first();

  const patch = {
    actorUserId: args.actorUserId,
    auditEventId: args.auditEventId,
    createdAt: args.createdAt,
    eventType: args.eventType,
    evidenceId: args.evidenceId,
    evidenceTitle: args.evidenceTitle,
    internalControlId: args.internalControlId,
    itemId: args.itemId,
    lifecycleStatus: args.lifecycleStatus,
    renewedFromEvidenceId: args.renewedFromEvidenceId,
    replacedByEvidenceId: args.replacedByEvidenceId,
    reviewStatus: args.reviewStatus,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }

  await ctx.db.insert('securityControlEvidenceActivity', patch);
}

function getSeededEvidenceEntry(internalControlId: string, itemId: string, evidenceId: string) {
  const control = ACTIVE_CONTROL_REGISTER.controls.find(
    (entry) => entry.internalControlId === internalControlId,
  );
  const item = control?.platformChecklistItems.find((entry) => entry.itemId === itemId);
  if (!item) {
    return null;
  }

  const index = item.seed.evidence.findIndex(
    (_, currentIndex) => `${internalControlId}:${itemId}:seed:${currentIndex}` === evidenceId,
  );

  if (index < 0) {
    return null;
  }

  return {
    entry: item.seed.evidence[index],
    index,
    item,
  };
}

function deriveEvidenceReadiness(
  items: Array<{
    evidence: Array<{
      lifecycleStatus: 'active' | 'archived' | 'superseded';
    }>;
    status: 'done' | 'in_progress' | 'not_applicable' | 'not_started';
  }>,
) {
  const activeEvidenceCount = items.reduce((count, item) => {
    return count + item.evidence.filter((evidence) => evidence.lifecycleStatus === 'active').length;
  }, 0);

  if (activeEvidenceCount === 0) {
    return 'missing' as const;
  }
  if (items.length > 0 && items.every((item) => item.status === 'done')) {
    return 'ready' as const;
  }
  return 'partial' as const;
}

function hasExpiringSoonEvidence(
  evidence: Array<{
    expiryStatus: 'none' | 'current' | 'expiring_soon';
    lifecycleStatus: 'active' | 'archived' | 'superseded';
  }>,
) {
  return evidence.some(
    (entry) => entry.lifecycleStatus === 'active' && entry.expiryStatus === 'expiring_soon',
  );
}

async function countQueryResults(
  query:
    | AsyncIterable<unknown>
    | {
        collect: () => Promise<ArrayLike<unknown>>;
      },
) {
  if ('collect' in query) {
    const entries = await query.collect();
    return entries.length;
  }

  let count = 0;
  for await (const _entry of query) {
    count += 1;
  }
  return count;
}

const documentScanEventArgs = {
  attachmentId: v.optional(v.id('chatAttachments')),
  details: v.optional(v.union(v.string(), v.null())),
  fileName: v.string(),
  mimeType: v.string(),
  organizationId: v.string(),
  requestedByUserId: v.string(),
  resultStatus: v.union(
    v.literal('accepted'),
    v.literal('inspection_failed'),
    v.literal('quarantined'),
    v.literal('rejected'),
  ),
  scannedAt: v.number(),
  scannerEngine: v.string(),
};

export const recordDocumentScanEventInternal = internalMutation({
  args: {
    ...documentScanEventArgs,
  },
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args) => {
    const recordId = await ctx.db.insert('documentScanEvents', {
      ...args,
      createdAt: Date.now(),
      details: args.details ?? null,
    });
    await updateSecurityMetrics(ctx, {
      resultStatus: args.resultStatus,
      scannedAt: args.scannedAt,
    });
    return recordId;
  },
});

export const recordRetentionJob = internalMutation({
  args: {
    details: v.optional(v.string()),
    jobKind: v.union(
      v.literal('attachment_purge'),
      v.literal('quarantine_cleanup'),
      v.literal('audit_export_cleanup'),
    ),
    processedCount: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
  },
  returns: v.id('retentionJobs'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('retentionJobs', {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export async function recordBackupVerificationHandler(
  ctx: MutationCtx,
  args: {
    artifactContentJson?: string | null;
    artifactHash?: string | null;
    checkedAt: number;
    drillId: string;
    drillType: 'operator_recorded' | 'restore_verification';
    evidenceSummary: string;
    failureReason?: string | null;
    initiatedByKind: 'system' | 'user';
    initiatedByUserId?: string | null;
    restoredItemCount: number;
    status: 'success' | 'failure';
    sourceDataset: string;
    summary: string;
    targetEnvironment: 'development' | 'production' | 'test';
    verificationMethod: string;
  },
) {
  const recordId = await ctx.db.insert('backupVerificationReports', {
    ...args,
    artifactContentJson: args.artifactContentJson ?? null,
    artifactHash: args.artifactHash ?? null,
    createdAt: Date.now(),
    failureReason: args.failureReason ?? null,
    initiatedByUserId: args.initiatedByUserId ?? null,
  });

  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    actorUserId: args.initiatedByUserId ?? undefined,
    userId: args.initiatedByUserId ?? undefined,
    eventType:
      args.status === 'success' ? 'backup_restore_drill_completed' : 'backup_restore_drill_failed',
    outcome: args.status === 'success' ? 'success' : 'failure',
    resourceType: 'backup_restore_drill',
    resourceId: args.drillId,
    resourceLabel: args.sourceDataset,
    severity: args.status === 'success' ? 'info' : 'warning',
    sourceSurface: 'admin.security',
    metadata: stringifyStable({
      artifactHash: args.artifactHash ?? null,
      checkedAt: args.checkedAt,
      drillType: args.drillType,
      evidenceSummary: args.evidenceSummary,
      failureReason: args.failureReason ?? null,
      initiatedByKind: args.initiatedByKind,
      restoredItemCount: args.restoredItemCount,
      targetEnvironment: args.targetEnvironment,
      verificationMethod: args.verificationMethod,
    }),
  });

  return recordId;
}

export const recordBackupVerification = internalMutation({
  args: {
    artifactContentJson: v.optional(v.union(v.string(), v.null())),
    artifactHash: v.optional(v.union(v.string(), v.null())),
    checkedAt: v.number(),
    drillId: v.string(),
    drillType: backupVerificationDrillTypeValidator,
    evidenceSummary: v.string(),
    failureReason: v.optional(v.union(v.string(), v.null())),
    initiatedByKind: backupVerificationInitiatedByKindValidator,
    initiatedByUserId: v.optional(v.union(v.string(), v.null())),
    restoredItemCount: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
    sourceDataset: v.string(),
    summary: v.string(),
    targetEnvironment: backupVerificationTargetEnvironmentValidator,
    verificationMethod: v.string(),
  },
  returns: v.id('backupVerificationReports'),
  handler: recordBackupVerificationHandler,
});

async function listSecurityControlWorkspaceRecords(
  ctx: QueryCtx,
  seedActor?: { authUserId: string },
) {
  const perControlRows = await Promise.all(
    ACTIVE_CONTROL_REGISTER.controls.map(async (control) => {
      const [checklistItems, evidenceRows] = await Promise.all([
        ctx.db
          .query('securityControlChecklistItems')
          .withIndex('by_internal_control_id', (q) =>
            q.eq('internalControlId', control.internalControlId),
          )
          .collect(),
        ctx.db
          .query('securityControlEvidence')
          .withIndex('by_internal_control_id', (q) =>
            q.eq('internalControlId', control.internalControlId),
          )
          .collect(),
      ]);

      return {
        internalControlId: control.internalControlId,
        checklistItems,
        evidenceRows,
      };
    }),
  );
  const checklistItems = perControlRows.flatMap((entry) => entry.checklistItems);
  const evidenceRows = perControlRows.flatMap((entry) => entry.evidenceRows);
  const actorIds = Array.from(
    new Set(
      [
        ...evidenceRows.flatMap((row) => [
          row.uploadedByUserId,
          row.reviewedByUserId,
          row.archivedByUserId,
        ]),
        ...checklistItems.flatMap((item) =>
          (item.archivedSeedEvidence ?? []).map((entry) => entry.archivedByUserId),
        ),
        ...checklistItems.flatMap((item) =>
          item.reviewSatisfaction ? [item.reviewSatisfaction.satisfiedByUserId] : [],
        ),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const actorProfiles = await Promise.all(
    actorIds.map(async (authUserId) => {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
      return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
    }),
  );
  const actorDisplayById = new Map(actorProfiles);
  const seededActor = await resolveSeedSiteAdminActor(ctx, seedActor?.authUserId);
  const checklistStateByKey = new Map(
    checklistItems.map((item) => [`${item.internalControlId}:${item.itemId}`, item] as const),
  );
  const evidenceByKey = evidenceRows.reduce<Map<string, Array<(typeof evidenceRows)[number]>>>(
    (accumulator, evidence) => {
      const key = `${evidence.internalControlId}:${evidence.itemId}`;
      const current = accumulator.get(key) ?? [];
      current.push(evidence);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const seededReviewedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);

  return ACTIVE_CONTROL_REGISTER.controls.map((control) => {
    const platformChecklist = control.platformChecklistItems.map((item) => {
      const itemState = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
      const reviewSatisfaction =
        itemState?.reviewSatisfaction && isReviewSatisfactionCurrent(itemState.reviewSatisfaction)
          ? {
              mode: itemState.reviewSatisfaction.mode,
              reviewRunId: itemState.reviewSatisfaction.reviewRunId,
              reviewTaskId: itemState.reviewSatisfaction.reviewTaskId,
              satisfiedAt: itemState.reviewSatisfaction.satisfiedAt,
              satisfiedByDisplay: getActorDisplayName(
                actorDisplayById,
                itemState.reviewSatisfaction.satisfiedByUserId,
              ),
              satisfiedThroughAt: itemState.reviewSatisfaction.satisfiedThroughAt,
            }
          : null;
      const hiddenSeedEvidenceIds = new Set(itemState?.hiddenSeedEvidenceIds ?? []);
      const archivedSeedEvidenceById = new Map(
        (itemState?.archivedSeedEvidence ?? []).map((entry) => [entry.evidenceId, entry] as const),
      );
      const seededEvidence = item.seed.evidence
        .map((entry, index) => ({
          id: `${control.internalControlId}:${item.itemId}:seed:${index}` as Id<'securityControlEvidence'>,
          title: entry.title,
          description: entry.description,
          evidenceType: entry.evidenceType,
          url: entry.url,
          storageId: null,
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          evidenceDate: null,
          reviewDueIntervalMonths: null,
          reviewDueAt: null,
          expiryStatus: 'none' as const,
          source: null,
          sufficiency: entry.sufficiency,
          lifecycleStatus: 'active' as const,
          archivedAt: null,
          archivedByDisplay: null,
          renewedFromEvidenceId: null,
          replacedByEvidenceId: null,
          reviewStatus: 'reviewed' as const,
          reviewedAt: seededReviewedAt,
          reviewedByDisplay: seededActor.displayName,
          createdAt: seededReviewedAt,
          uploadedByDisplay: seededActor.displayName,
        }))
        .filter((entry) => !hiddenSeedEvidenceIds.has(entry.id));
      const archivedSeedEvidence = Array.from(hiddenSeedEvidenceIds)
        .map((evidenceId) => {
          const archivedMetadata = archivedSeedEvidenceById.get(evidenceId);
          const seededEntry = getSeededEvidenceEntry(
            control.internalControlId,
            item.itemId,
            evidenceId,
          );
          if (!seededEntry) {
            return null;
          }
          return {
            id: evidenceId as Id<'securityControlEvidence'>,
            title: seededEntry.entry.title,
            description: seededEntry.entry.description,
            evidenceType: seededEntry.entry.evidenceType,
            url: seededEntry.entry.url,
            storageId: null,
            fileName: null,
            mimeType: null,
            sizeBytes: null,
            evidenceDate: null,
            reviewDueIntervalMonths: null,
            reviewDueAt: null,
            expiryStatus: 'none' as const,
            source: null,
            sufficiency: seededEntry.entry.sufficiency,
            lifecycleStatus: archivedMetadata?.lifecycleStatus ?? ('archived' as const),
            archivedAt: archivedMetadata?.archivedAt ?? null,
            archivedByDisplay: getActorDisplayName(
              actorDisplayById,
              archivedMetadata?.archivedByUserId,
            ),
            renewedFromEvidenceId: null,
            replacedByEvidenceId: archivedMetadata?.replacedByEvidenceId ?? null,
            reviewStatus: 'reviewed' as const,
            reviewedAt: seededReviewedAt,
            reviewedByDisplay: seededActor.displayName,
            createdAt: seededReviewedAt,
            uploadedByDisplay: seededActor.displayName,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const persistedEvidence = (
        evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []
      ).map((entry) => {
        const reviewDueIntervalMonths = entry.reviewDueIntervalMonths ?? null;
        const reviewedAt = entry.reviewedAt ?? null;
        const reviewDueAt =
          reviewedAt !== null && reviewDueIntervalMonths !== null
            ? addMonths(reviewedAt, reviewDueIntervalMonths)
            : null;

        return {
          id: entry._id,
          title: entry.title,
          description: entry.description ?? null,
          evidenceType: entry.evidenceType,
          url: entry.url ?? null,
          storageId: entry.storageId ?? null,
          fileName: entry.fileName ?? null,
          mimeType: entry.mimeType ?? null,
          sizeBytes: entry.sizeBytes ?? null,
          evidenceDate: entry.evidenceDate ?? null,
          reviewDueIntervalMonths,
          reviewDueAt,
          expiryStatus: deriveEvidenceExpiryStatus({
            reviewDueAt,
            reviewedAt,
          }),
          source: entry.source ?? null,
          sufficiency: entry.sufficiency,
          lifecycleStatus: entry.lifecycleStatus ?? ('active' as const),
          archivedAt: entry.archivedAt ?? null,
          archivedByDisplay: getActorDisplayName(actorDisplayById, entry.archivedByUserId),
          renewedFromEvidenceId: entry.renewedFromEvidenceId ?? null,
          replacedByEvidenceId: entry.replacedByEvidenceId ?? null,
          reviewStatus:
            entry.reviewStatus ?? (entry.reviewedAt ? ('reviewed' as const) : ('pending' as const)),
          reviewedAt,
          reviewedByDisplay: getActorDisplayName(actorDisplayById, entry.reviewedByUserId),
          createdAt: entry.createdAt,
          uploadedByDisplay: getActorDisplayName(actorDisplayById, entry.uploadedByUserId),
        };
      });
      const evidence = [...seededEvidence, ...persistedEvidence, ...archivedSeedEvidence];
      const evidenceDerivedStatus = deriveChecklistItemStatus(evidence);
      const derivedStatus =
        evidenceDerivedStatus === 'done' || reviewSatisfaction !== null
          ? ('done' as const)
          : evidenceDerivedStatus;
      const itemHasExpiringSoonEvidence = hasExpiringSoonEvidence(evidence);
      const completedAt =
        derivedStatus === 'done'
          ? [
              reviewSatisfaction?.satisfiedAt ?? null,
              evidence
                .filter(
                  (entry) =>
                    entry.lifecycleStatus === 'active' && entry.reviewStatus === 'reviewed',
                )
                .reduce<number | null>((latest, entry) => {
                  const candidate = entry.reviewedAt ?? entry.createdAt;
                  return latest === null ? candidate : Math.max(latest, candidate);
                }, null),
            ].reduce<number | null>((latest, value) => {
              if (typeof value !== 'number') {
                return latest;
              }
              return latest === null ? value : Math.max(latest, value);
            }, null)
          : null;
      const lastReviewedAtCandidates = [
        item.seed.evidence.length > 0 || derivedStatus !== 'not_started' ? seededReviewedAt : null,
        completedAt,
        reviewSatisfaction?.satisfiedAt ?? null,
        ...evidence.flatMap((entry) => [entry.reviewedAt, entry.createdAt, entry.archivedAt]),
        ...archivedSeedEvidence.map((entry) => entry.archivedAt),
      ];
      const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
        if (typeof value !== 'number') {
          return latest;
        }
        return latest === null ? value : Math.max(latest, value);
      }, null);

      return {
        itemId: item.itemId,
        label: item.label,
        description: item.description,
        verificationMethod: item.verificationMethod,
        required: item.required,
        suggestedEvidenceTypes: item.suggestedEvidenceTypes,
        status: derivedStatus,
        owner: item.seed.owner,
        notes: item.seed.notes,
        completedAt,
        lastReviewedAt,
        evidence,
        evidenceSufficiency: deriveItemEvidenceSufficiency(evidence),
        hasExpiringSoonEvidence: itemHasExpiringSoonEvidence,
        reviewSatisfaction,
      };
    });

    const evidenceReadiness = deriveEvidenceReadiness(platformChecklist);
    const controlHasExpiringSoonEvidence = platformChecklist.some(
      (item) => item.hasExpiringSoonEvidence,
    );
    const lastReviewedAtCandidates = platformChecklist.flatMap((item) => [
      item.lastReviewedAt,
      item.completedAt,
      ...item.evidence.flatMap((evidence) => [
        evidence.reviewedAt,
        evidence.createdAt,
        evidence.archivedAt,
      ]),
    ]);
    const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
      if (typeof value !== 'number') {
        return latest;
      }
      return latest === null ? value : Math.max(latest, value);
    }, null);

    return {
      internalControlId: control.internalControlId,
      nist80053Id: control.nist80053Id,
      title: control.title,
      familyId: control.familyId,
      familyTitle: control.familyTitle,
      owner: control.owner,
      priority: control.priority,
      responsibility: control.responsibility,
      implementationSummary: control.implementationSummary,
      customerResponsibilityNotes: control.customerResponsibilityNotes,
      controlStatement: control.controlStatement,
      mappings: {
        ...control.mappings,
        hipaa: control.mappings.hipaa.map((mapping) => ({
          ...mapping,
          text: null,
        })),
      },
      evidenceReadiness,
      hasExpiringSoonEvidence: controlHasExpiringSoonEvidence,
      lastReviewedAt,
      platformChecklist,
    };
  });
}

type ReviewRunDoc = Doc<'reviewRuns'>;
type ReviewTaskDoc = Doc<'reviewTasks'>;

async function buildReviewRunSnapshot() {
  const snapshotJson = stringifyStable({
    generatedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
    schemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
    controls: ACTIVE_CONTROL_REGISTER.controls,
  });

  return {
    snapshotHash: await hashContent(snapshotJson),
    snapshotJson,
  };
}

function buildReviewRunTaskCounts(tasks: ReviewTaskDoc[]) {
  return tasks.reduce(
    (counts, task) => {
      counts.total += 1;
      counts[task.status] += 1;
      return counts;
    },
    {
      blocked: 0,
      completed: 0,
      exception: 0,
      ready: 0,
      total: 0,
    },
  );
}

function deriveReviewRunStatus(tasks: ReviewTaskDoc[], finalizedAt?: number) {
  if (typeof finalizedAt === 'number') {
    return 'completed' as const;
  }
  if (tasks.some((task) => task.status === 'blocked' || task.status === 'exception')) {
    return 'needs_attention' as const;
  }
  return 'ready' as const;
}

async function listReviewTasksByRunId(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  reviewRunId: Id<'reviewRuns'>,
) {
  return await ctx.db
    .query('reviewTasks')
    .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', reviewRunId))
    .collect();
}

async function upsertAnnualReviewTasks(ctx: MutationCtx, reviewRunId: Id<'reviewRuns'>) {
  const existingTasks = await listReviewTasksByRunId(ctx, reviewRunId);
  const existingByTemplateKey = new Map(
    existingTasks.map((task) => [task.templateKey, task] as const),
  );
  const now = Date.now();

  await Promise.all(
    ANNUAL_REVIEW_TASK_BLUEPRINTS.map(async (blueprint) => {
      const existing = existingByTemplateKey.get(blueprint.templateKey);
      const patch = {
        allowException: blueprint.allowException,
        controlLinks: blueprint.controlLinks,
        description: blueprint.description,
        freshnessWindowDays: blueprint.freshnessWindowDays ?? undefined,
        required: blueprint.required,
        taskType: blueprint.taskType,
        title: blueprint.title,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return;
      }

      await ctx.db.insert('reviewTasks', {
        ...patch,
        latestAttestationId: undefined,
        latestEvidenceLinkedAt: undefined,
        latestNote: undefined,
        latestResultId: undefined,
        reviewRunId,
        satisfiedAt: undefined,
        satisfiedThroughAt: undefined,
        status: 'ready',
        templateKey: blueprint.templateKey,
        createdAt: now,
      });
    }),
  );
}

async function syncReviewRunStatus(ctx: MutationCtx, reviewRunId: Id<'reviewRuns'>) {
  const run = await ctx.db.get(reviewRunId);
  if (!run) {
    throw new Error('Review run not found.');
  }
  const tasks = await listReviewTasksByRunId(ctx, reviewRunId);
  const status = deriveReviewRunStatus(tasks, run.finalizedAt);
  if (status !== run.status) {
    await ctx.db.patch(reviewRunId, {
      status,
      updatedAt: Date.now(),
    });
  }
  return status;
}

async function upsertChecklistReviewSatisfaction(
  ctx: MutationCtx,
  task: ReviewTaskDoc,
  args: {
    mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
    satisfiedAt: number;
    satisfiedByUserId: string;
    satisfiedThroughAt: number;
  },
) {
  const now = Date.now();
  await Promise.all(
    task.controlLinks.map(async (link) => {
      const existing = await ctx.db
        .query('securityControlChecklistItems')
        .withIndex('by_internal_control_id_and_item_id', (q) =>
          q.eq('internalControlId', link.internalControlId).eq('itemId', link.itemId),
        )
        .unique();

      const reviewSatisfaction = {
        mode: args.mode,
        reviewRunId: task.reviewRunId,
        reviewTaskId: task._id,
        satisfiedAt: args.satisfiedAt,
        satisfiedByUserId: args.satisfiedByUserId,
        satisfiedThroughAt: args.satisfiedThroughAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, {
          completedAt: args.satisfiedAt,
          completedByUserId: args.satisfiedByUserId,
          lastReviewedAt: args.satisfiedAt,
          lastReviewedByUserId: args.satisfiedByUserId,
          reviewSatisfaction,
          updatedAt: now,
        });
        return;
      }

      await ctx.db.insert('securityControlChecklistItems', {
        completedAt: args.satisfiedAt,
        completedByUserId: args.satisfiedByUserId,
        createdAt: now,
        internalControlId: link.internalControlId,
        itemId: link.itemId,
        lastReviewedAt: args.satisfiedAt,
        lastReviewedByUserId: args.satisfiedByUserId,
        reviewSatisfaction,
        updatedAt: now,
      });
    }),
  );
}

async function applyReviewTaskState(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
    note?: string;
    reviewTaskId: Id<'reviewTasks'>;
    satisfiedAt?: number | null;
    satisfiedThroughAt?: number | null;
    status: 'ready' | 'completed' | 'exception' | 'blocked';
    resultType:
      | 'automated_check'
      | 'attested'
      | 'document_linked'
      | 'exception_marked'
      | 'follow_up_opened'
      | 'resolved';
    latestAttestationId?: Id<'reviewAttestations'>;
  },
) {
  const task = await ctx.db.get(args.reviewTaskId);
  if (!task) {
    throw new Error('Review task not found.');
  }
  const now = Date.now();
  const trimmedNote = args.note?.trim() || undefined;
  const resultId = await ctx.db.insert('reviewTaskResults', {
    actorUserId: args.actorUserId,
    createdAt: now,
    note: trimmedNote,
    resultType: args.resultType,
    reviewRunId: task.reviewRunId,
    reviewTaskId: task._id,
    statusAfter: args.status,
  });

  await ctx.db.patch(task._id, {
    latestAttestationId: args.latestAttestationId,
    latestNote: trimmedNote,
    latestResultId: resultId,
    satisfiedAt: args.satisfiedAt ?? undefined,
    satisfiedThroughAt: args.satisfiedThroughAt ?? undefined,
    status: args.status,
    updatedAt: now,
  });

  if (
    (args.status === 'completed' || args.status === 'exception') &&
    typeof args.satisfiedAt === 'number' &&
    typeof args.satisfiedThroughAt === 'number'
  ) {
    await upsertChecklistReviewSatisfaction(ctx, task, {
      mode: args.mode,
      satisfiedAt: args.satisfiedAt,
      satisfiedByUserId: args.actorUserId,
      satisfiedThroughAt: args.satisfiedThroughAt,
    });
  }

  await syncReviewRunStatus(ctx, task.reviewRunId);
}

async function upsertReviewTaskEvidenceLinkRecord(
  ctx: MutationCtx,
  args: {
    freshAt?: number;
    linkedByUserId?: string;
    reviewRunId: Id<'reviewRuns'>;
    reviewTaskId: Id<'reviewTasks'>;
    role: 'primary' | 'supporting' | 'blocking';
    sourceId: string;
    sourceLabel: string;
    sourceType:
      | 'security_control_evidence'
      | 'evidence_report'
      | 'security_finding'
      | 'backup_verification_report'
      | 'external_document';
  },
) {
  const now = Date.now();
  const existing = (
    await ctx.db
      .query('reviewTaskEvidenceLinks')
      .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', args.reviewTaskId))
      .collect()
  ).find(
    (link) =>
      link.sourceId === args.sourceId &&
      link.sourceType === args.sourceType &&
      link.role === args.role,
  );

  if (existing) {
    await ctx.db.patch(existing._id, {
      freshAt: args.freshAt,
      linkedAt: now,
      linkedByUserId: args.linkedByUserId,
      sourceLabel: args.sourceLabel,
    });
    return existing._id;
  }

  return await ctx.db.insert('reviewTaskEvidenceLinks', {
    freshAt: args.freshAt,
    linkedAt: now,
    linkedByUserId: args.linkedByUserId,
    reviewRunId: args.reviewRunId,
    reviewTaskId: args.reviewTaskId,
    role: args.role,
    sourceId: args.sourceId,
    sourceLabel: args.sourceLabel,
    sourceType: args.sourceType,
  });
}

async function clearReviewTaskEvidenceLinksBySourceType(
  ctx: MutationCtx,
  reviewTaskId: Id<'reviewTasks'>,
  sourceTypes: Array<
    | 'security_control_evidence'
    | 'evidence_report'
    | 'security_finding'
    | 'backup_verification_report'
    | 'external_document'
  >,
) {
  if (sourceTypes.length === 0) {
    return;
  }

  const existingLinks = await ctx.db
    .query('reviewTaskEvidenceLinks')
    .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', reviewTaskId))
    .collect();

  await Promise.all(
    existingLinks
      .filter((link) => sourceTypes.includes(link.sourceType))
      .map((link) => ctx.db.delete(link._id)),
  );
}

function getAutomationEvidenceLabel(blueprint: ReviewTaskBlueprint) {
  switch (blueprint.automationKind) {
    case 'audit_readiness':
      return 'Audit readiness report';
    case 'backup_verification':
      return 'Backup verification evidence';
    case 'control_workspace_snapshot':
      return 'Control workspace snapshot';
    case 'findings_snapshot':
      return 'Security findings snapshot';
    case 'release_provenance':
      return 'Release provenance evidence';
    case 'security_posture':
      return 'Security posture summary';
    case 'vendor_posture_snapshot':
      return 'Vendor posture snapshot';
    default:
      return blueprint.title;
  }
}

async function buildReviewRunSummary(ctx: QueryCtx, run: ReviewRunDoc) {
  const tasks = await listReviewTasksByRunId(ctx, run._id);
  return {
    createdAt: run.createdAt,
    finalizedAt: run.finalizedAt ?? null,
    id: run._id,
    kind: run.kind,
    status: deriveReviewRunStatus(tasks, run.finalizedAt),
    taskCounts: buildReviewRunTaskCounts(tasks),
    title: run.title,
    triggerType: run.triggerType ?? null,
    year: run.year ?? null,
  };
}

async function buildReviewRunDetail(ctx: QueryCtx, reviewRunId: Id<'reviewRuns'>) {
  const run = await ctx.db.get(reviewRunId);
  if (!run) {
    return null;
  }

  const [tasks, evidenceLinks, attestations] = await Promise.all([
    listReviewTasksByRunId(ctx, reviewRunId),
    ctx.db
      .query('reviewTaskEvidenceLinks')
      .withIndex('by_review_run_id_and_linked_at', (q) => q.eq('reviewRunId', reviewRunId))
      .collect(),
    ctx.db
      .query('reviewAttestations')
      .withIndex('by_review_run_id_and_attested_at', (q) => q.eq('reviewRunId', reviewRunId))
      .collect(),
  ]);

  const actorIds = Array.from(
    new Set([
      ...evidenceLinks
        .map((link) => link.linkedByUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ...attestations
        .map((attestation) => attestation.attestedByUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ]),
  );
  const actorProfiles = await Promise.all(
    actorIds.map(async (authUserId) => {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
      return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
    }),
  );
  const actorDisplayById = new Map(actorProfiles);
  const evidenceLinksByTaskId = evidenceLinks.reduce<Map<string, Doc<'reviewTaskEvidenceLinks'>[]>>(
    (accumulator, link) => {
      const current = accumulator.get(link.reviewTaskId) ?? [];
      current.push(link);
      accumulator.set(link.reviewTaskId, current);
      return accumulator;
    },
    new Map(),
  );
  const attestationByTaskId = new Map(
    attestations.map((attestation) => [attestation.reviewTaskId, attestation] as const),
  );
  const sortedTasks = [...tasks].sort((left, right) =>
    left.templateKey.localeCompare(right.templateKey),
  );

  return {
    createdAt: run.createdAt,
    finalReportId: run.finalReportId ?? null,
    finalizedAt: run.finalizedAt ?? null,
    id: run._id,
    kind: run.kind,
    sourceRecordId: run.sourceRecordId ?? null,
    sourceRecordType: run.sourceRecordType ?? null,
    status: deriveReviewRunStatus(tasks, run.finalizedAt),
    tasks: sortedTasks.map((task) => {
      const latestAttestation = attestationByTaskId.get(task._id);
      return {
        allowException: task.allowException,
        controlLinks: task.controlLinks,
        description: task.description,
        evidenceLinks: (evidenceLinksByTaskId.get(task._id) ?? [])
          .sort((left, right) => right.linkedAt - left.linkedAt)
          .map((link) => ({
            id: link._id,
            freshAt: link.freshAt ?? null,
            linkedAt: link.linkedAt,
            linkedByDisplay: getActorDisplayName(actorDisplayById, link.linkedByUserId),
            role: link.role,
            sourceId: link.sourceId,
            sourceLabel: link.sourceLabel ?? link.sourceId,
            sourceType: link.sourceType,
          })),
        freshnessWindowDays: task.freshnessWindowDays ?? null,
        id: task._id,
        latestAttestation: latestAttestation
          ? {
              documentLabel: latestAttestation.documentLabel ?? null,
              documentUrl: latestAttestation.documentUrl ?? null,
              documentVersion: latestAttestation.documentVersion ?? null,
              statementKey: latestAttestation.statementKey,
              statementText: latestAttestation.statementText,
              attestedAt: latestAttestation.attestedAt,
              attestedByDisplay: getActorDisplayName(
                actorDisplayById,
                latestAttestation.attestedByUserId,
              ),
            }
          : null,
        latestNote: task.latestNote ?? null,
        required: task.required,
        satisfiedAt: task.satisfiedAt ?? null,
        satisfiedThroughAt: task.satisfiedThroughAt ?? null,
        status: task.status,
        taskType: task.taskType,
        templateKey: task.templateKey,
        title: task.title,
      };
    }),
    title: run.title,
    triggerType: run.triggerType ?? null,
    year: run.year ?? null,
  };
}

async function createTriggeredReviewRunRecord(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    controlLinks?: Array<{ internalControlId: string; itemId: string }>;
    dedupeKey?: string;
    sourceRecordId?: string;
    sourceRecordType?: string;
    title: string;
    triggerType: string;
  },
) {
  const existing = args.dedupeKey
    ? await ctx.db
        .query('reviewRuns')
        .withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', args.dedupeKey))
        .unique()
    : null;
  const now = Date.now();

  if (existing) {
    return existing._id;
  }

  const snapshot = await buildReviewRunSnapshot();
  const runId = await ctx.db.insert('reviewRuns', {
    controlRegisterGeneratedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
    controlRegisterSchemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
    createdAt: now,
    createdByUserId: args.actorUserId,
    dedupeKey: args.dedupeKey,
    finalReportId: undefined,
    finalizedAt: undefined,
    finalizedByUserId: undefined,
    kind: 'triggered',
    runKey: `triggered:${args.triggerType}:${crypto.randomUUID()}`,
    snapshotHash: snapshot.snapshotHash,
    snapshotJson: snapshot.snapshotJson,
    sourceRecordId: args.sourceRecordId,
    sourceRecordType: args.sourceRecordType,
    status: 'ready',
    title: args.title.trim(),
    triggerType: args.triggerType.trim(),
    updatedAt: now,
  });

  await ctx.db.insert('reviewTasks', {
    allowException: true,
    controlLinks: args.controlLinks ?? [],
    createdAt: now,
    description: `Follow up on ${args.title.trim().toLowerCase()}.`,
    freshnessWindowDays: undefined,
    latestAttestationId: undefined,
    latestEvidenceLinkedAt: undefined,
    latestNote: undefined,
    latestResultId: undefined,
    required: true,
    reviewRunId: runId,
    satisfiedAt: undefined,
    satisfiedThroughAt: undefined,
    status: 'ready',
    taskType: 'follow_up',
    templateKey: `triggered:${args.triggerType.trim()}`,
    title: args.title.trim(),
    updatedAt: now,
  });

  await syncReviewRunStatus(ctx, runId);
  return runId;
}

export const getCurrentAnnualReviewRun = query({
  args: {},
  returns: v.union(reviewRunSummaryValidator, v.null()),
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('reviewRuns')
      .withIndex('by_run_key', (q) =>
        q.eq('runKey', getAnnualReviewRunKey(getCurrentAnnualReviewYear())),
      )
      .unique();
    if (!existing) {
      return null;
    }
    return await buildReviewRunSummary(ctx, existing);
  },
});

export const ensureCurrentAnnualReviewRun = mutation({
  args: {},
  returns: reviewRunSummaryValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const year = getCurrentAnnualReviewYear();
    const runKey = getAnnualReviewRunKey(year);
    let run = await ctx.db
      .query('reviewRuns')
      .withIndex('by_run_key', (q) => q.eq('runKey', runKey))
      .unique();

    if (!run) {
      const snapshot = await buildReviewRunSnapshot();
      const now = Date.now();
      const runId = await ctx.db.insert('reviewRuns', {
        controlRegisterGeneratedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
        controlRegisterSchemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
        createdAt: now,
        createdByUserId: currentUser.authUserId,
        finalReportId: undefined,
        finalizedAt: undefined,
        finalizedByUserId: undefined,
        kind: 'annual',
        runKey,
        snapshotHash: snapshot.snapshotHash,
        snapshotJson: snapshot.snapshotJson,
        status: 'ready',
        title: getAnnualReviewRunTitle(year),
        updatedAt: now,
        year,
      });
      await upsertAnnualReviewTasks(ctx, runId);
      run = await ctx.db.get(runId);
    } else {
      await upsertAnnualReviewTasks(ctx, run._id);
    }

    if (!run) {
      throw new Error('Failed to ensure current annual review run.');
    }
    await syncReviewRunStatus(ctx, run._id);
    const latestRun = await ctx.db.get(run._id);
    if (!latestRun) {
      throw new Error('Review run not found after ensure.');
    }
    return await buildReviewRunSummary(ctx as unknown as QueryCtx, latestRun);
  },
});

export const listTriggeredReviewRuns = query({
  args: {},
  returns: reviewRunSummaryListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const runs = await ctx.db
      .query('reviewRuns')
      .withIndex('by_kind_and_created_at', (q) => q.eq('kind', 'triggered'))
      .order('desc')
      .collect();
    return await Promise.all(runs.map(async (run) => await buildReviewRunSummary(ctx, run)));
  },
});

export const getReviewRunDetail = query({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await buildReviewRunDetail(ctx, args.reviewRunId);
  },
});

export const upsertReviewTaskEvidenceLinkInternal = internalMutation({
  args: {
    freshAt: v.optional(v.number()),
    linkedByUserId: v.optional(v.string()),
    reviewRunId: v.id('reviewRuns'),
    reviewTaskId: v.id('reviewTasks'),
    role: reviewTaskEvidenceRoleValidator,
    sourceId: v.string(),
    sourceLabel: v.string(),
    sourceType: reviewTaskEvidenceSourceTypeValidator,
  },
  returns: v.id('reviewTaskEvidenceLinks'),
  handler: async (ctx, args) => {
    return await upsertReviewTaskEvidenceLinkRecord(ctx, args);
  },
});

export const replaceReviewTaskEvidenceLinksInternal = internalMutation({
  args: {
    reviewTaskId: v.id('reviewTasks'),
    sourceTypes: v.array(reviewTaskEvidenceSourceTypeValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await clearReviewTaskEvidenceLinksBySourceType(ctx, args.reviewTaskId, args.sourceTypes);
    return null;
  },
});

export const applyReviewTaskStateInternal = internalMutation({
  args: {
    actorUserId: v.string(),
    latestAttestationId: v.optional(v.id('reviewAttestations')),
    mode: reviewSatisfactionModeValidator,
    note: v.optional(v.string()),
    reviewTaskId: v.id('reviewTasks'),
    resultType: reviewTaskResultTypeValidator,
    satisfiedAt: v.optional(v.union(v.number(), v.null())),
    satisfiedThroughAt: v.optional(v.union(v.number(), v.null())),
    status: reviewTaskStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyReviewTaskState(ctx, {
      actorUserId: args.actorUserId,
      latestAttestationId: args.latestAttestationId,
      mode: args.mode,
      note: args.note,
      resultType: args.resultType,
      reviewTaskId: args.reviewTaskId,
      satisfiedAt: args.satisfiedAt ?? null,
      satisfiedThroughAt: args.satisfiedThroughAt ?? null,
      status: args.status,
    });
    return null;
  },
});

export const createTriggeredReviewRun = mutation({
  args: {
    controlLinks: v.optional(v.array(reviewTaskControlLinkValidator)),
    dedupeKey: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
    sourceRecordType: v.optional(v.string()),
    title: v.string(),
    triggerType: v.string(),
  },
  returns: reviewRunSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const runId = await createTriggeredReviewRunRecord(ctx, {
      actorUserId: currentUser.authUserId,
      controlLinks: args.controlLinks,
      dedupeKey: args.dedupeKey,
      sourceRecordId: args.sourceRecordId,
      sourceRecordType: args.sourceRecordType,
      title: args.title,
      triggerType: args.triggerType,
    });
    const latestRun = await ctx.db.get(runId);
    if (!latestRun) {
      throw new Error('Triggered review run not found after create.');
    }
    return await buildReviewRunSummary(ctx as unknown as QueryCtx, latestRun);
  },
});

export const linkReviewTaskEvidence = mutation({
  args: {
    freshAt: v.optional(v.number()),
    reviewTaskId: v.id('reviewTasks'),
    role: v.optional(reviewTaskEvidenceRoleValidator),
    sourceId: v.string(),
    sourceLabel: v.string(),
    sourceType: reviewTaskEvidenceSourceTypeValidator,
  },
  returns: v.id('reviewTaskEvidenceLinks'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    const linkId = await upsertReviewTaskEvidenceLinkRecord(ctx, {
      freshAt: args.freshAt,
      linkedByUserId: currentUser.authUserId,
      reviewRunId: task.reviewRunId,
      reviewTaskId: args.reviewTaskId,
      role: args.role ?? 'primary',
      sourceId: args.sourceId.trim(),
      sourceLabel: args.sourceLabel.trim(),
      sourceType: args.sourceType,
    });
    await ctx.db.patch(task._id, {
      latestEvidenceLinkedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await syncReviewRunStatus(ctx, task.reviewRunId);
    return linkId;
  },
});

export const attestReviewTask = mutation({
  args: {
    documentLabel: v.optional(v.string()),
    documentUrl: v.optional(v.string()),
    documentVersion: v.optional(v.string()),
    note: v.optional(v.string()),
    reviewTaskId: v.id('reviewTasks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    const blueprint = ANNUAL_REVIEW_TASK_BLUEPRINTS.find(
      (entry) => entry.templateKey === task.templateKey,
    );
    if (!blueprint || blueprint.statementKey === null || blueprint.statementText === null) {
      throw new Error('This task does not support attestation.');
    }

    if (task.taskType === 'document_upload') {
      const documentLabel = args.documentLabel?.trim() ?? '';
      const documentUrl = args.documentUrl?.trim() ?? '';
      if (!documentLabel || !documentUrl) {
        throw new Error('Document-upload tasks require both a document label and URL.');
      }
      await upsertReviewTaskEvidenceLinkRecord(ctx, {
        linkedByUserId: currentUser.authUserId,
        reviewRunId: task.reviewRunId,
        reviewTaskId: task._id,
        role: 'primary',
        sourceId: documentUrl,
        sourceLabel: documentLabel,
        sourceType: 'external_document',
      });
    }

    const now = Date.now();
    const attestationId = await ctx.db.insert('reviewAttestations', {
      attestedAt: now,
      attestedByUserId: currentUser.authUserId,
      createdAt: now,
      documentLabel: args.documentLabel?.trim() || undefined,
      documentUrl: args.documentUrl?.trim() || undefined,
      documentVersion: args.documentVersion?.trim() || undefined,
      reviewRunId: task.reviewRunId,
      reviewTaskId: task._id,
      statementKey: blueprint.statementKey,
      statementText: blueprint.statementText,
    });

    const satisfiedThroughAt = addDays(
      now,
      task.freshnessWindowDays ?? ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    );
    await applyReviewTaskState(ctx, {
      actorUserId: currentUser.authUserId,
      latestAttestationId: attestationId,
      mode: task.taskType,
      note: args.note,
      resultType: task.taskType === 'document_upload' ? 'document_linked' : 'attested',
      reviewTaskId: task._id,
      satisfiedAt: now,
      satisfiedThroughAt,
      status: 'completed',
    });
    return null;
  },
});

export const setReviewTaskException = mutation({
  args: {
    note: v.string(),
    reviewTaskId: v.id('reviewTasks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    if (!task.allowException) {
      throw new Error('This task does not allow exceptions.');
    }
    const trimmedNote = args.note.trim();
    if (!trimmedNote) {
      throw new Error('Exception note is required.');
    }
    const now = Date.now();
    await applyReviewTaskState(ctx, {
      actorUserId: currentUser.authUserId,
      mode: 'exception',
      note: trimmedNote,
      resultType: 'exception_marked',
      reviewTaskId: task._id,
      satisfiedAt: now,
      satisfiedThroughAt: addDays(
        now,
        task.freshnessWindowDays ?? ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
      ),
      status: 'exception',
    });
    return null;
  },
});

export const openTriggeredFollowUp = mutation({
  args: {
    note: v.optional(v.string()),
    reviewTaskId: v.id('reviewTasks'),
  },
  returns: reviewRunSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    const runId = await createTriggeredReviewRunRecord(ctx, {
      actorUserId: currentUser.authUserId,
      controlLinks: task.controlLinks,
      dedupeKey: `review-task:${task._id}`,
      sourceRecordId: task._id,
      sourceRecordType: 'review_task',
      title: `${task.title} follow-up`,
      triggerType: 'review_task_follow_up',
    });
    const run = await ctx.db.get(runId);
    if (!run) {
      throw new Error('Follow-up review run not found after create.');
    }
    const summary = await buildReviewRunSummary(ctx as unknown as QueryCtx, run);

    await applyReviewTaskState(ctx, {
      actorUserId: currentUser.authUserId,
      mode: 'follow_up',
      note: args.note,
      resultType: 'follow_up_opened',
      reviewTaskId: task._id,
      satisfiedAt: Date.now(),
      satisfiedThroughAt: addDays(
        Date.now(),
        task.freshnessWindowDays ?? ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
      ),
      status: 'exception',
    });
    return summary;
  },
});

export const createEvidenceReport = internalMutation({
  args: {
    contentJson: v.string(),
    contentHash: v.string(),
    generatedByUserId: v.string(),
    organizationId: v.optional(v.string()),
    reportKind: evidenceReportKindValidator,
  },
  returns: v.id('evidenceReports'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('evidenceReports', {
      ...args,
      exportBundleJson: undefined,
      exportHash: undefined,
      exportIntegritySummary: undefined,
      exportManifestJson: undefined,
      exportManifestHash: undefined,
      latestExportArtifactId: undefined,
      exportedAt: null,
      exportedByUserId: null,
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewedByUserId: null,
      reviewNotes: null,
      createdAt: Date.now(),
    });
  },
});

export async function getSecurityPostureSummaryHandler(ctx: QueryCtx) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

  const metrics = await _getSecurityMetricsSnapshot(ctx);
  const [
    authUsers,
    passkeys,
    latestRetentionJob,
    latestBackupCheck,
    latestAuditEvent,
    integrityFailures,
  ] = await Promise.all([
    fetchAllBetterAuthUsers(ctx),
    fetchAllBetterAuthPasskeys(ctx),
    ctx.db.query('retentionJobs').withIndex('by_created_at').order('desc').first(),
    ctx.db.query('backupVerificationReports').withIndex('by_checked_at').order('desc').first(),
    ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').first(),
    countQueryResults(
      ctx.db
        .query('auditLogs')
        .withIndex('by_eventType_and_createdAt', (q) =>
          q.eq('eventType', 'audit_integrity_check_failed'),
        ),
    ),
  ]);

  const totalUsers = authUsers.length;
  const usersWithPasskeys = new Set(
    passkeys
      .map((passkey) => passkey.userId)
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
  );
  const mfaEnabledUsers = authUsers.filter(
    (user) => user.twoFactorEnabled === true || usersWithPasskeys.has(user._id),
  ).length;
  const passkeyEnabledUsers = authUsers.filter((user) => usersWithPasskeys.has(user._id)).length;
  const retentionPolicy = getRetentionPolicyConfig();
  const vendorPosture = getVendorBoundarySnapshot();
  const sentryPosture = vendorPosture.find((vendor) => vendor.vendor === 'sentry');

  return {
    audit: {
      integrityFailures,
      lastEventAt: latestAuditEvent?.createdAt ?? null,
    },
    auth: {
      emailVerificationRequired: ALWAYS_ON_REGULATED_BASELINE.requireVerifiedEmail,
      mfaCoveragePercent: totalUsers === 0 ? 0 : Math.round((mfaEnabledUsers / totalUsers) * 100),
      mfaEnabledUsers,
      passkeyEnabledUsers,
      totalUsers,
    },
    backups: {
      lastCheckedAt: latestBackupCheck?.checkedAt ?? null,
      lastStatus: latestBackupCheck?.status ?? null,
    },
    retention: {
      lastJobAt: latestRetentionJob?.createdAt ?? null,
      lastJobStatus: latestRetentionJob?.status ?? null,
    },
    scanner: {
      lastScanAt: metrics.lastDocumentScanAt,
      quarantinedCount: metrics.quarantinedDocumentScans,
      rejectedCount: metrics.rejectedDocumentScans,
      totalScans: metrics.totalDocumentScans,
    },
    sessions: {
      freshWindowMinutes: retentionPolicy.recentStepUpWindowMinutes,
      sessionExpiryHours: 24,
      temporaryLinkTtlMinutes: retentionPolicy.attachmentUrlTtlMinutes,
    },
    telemetry: {
      sentryApproved: sentryPosture?.approved ?? false,
      sentryEnabled: Boolean(process.env.VITE_SENTRY_DSN) && (sentryPosture?.approved ?? false),
    },
    vendors: vendorPosture,
  };
}

export const getSecurityPostureSummary = query({
  args: {},
  returns: securityPostureSummaryValidator,
  handler: getSecurityPostureSummaryHandler,
});

export const storeExportArtifact = internalMutation({
  args: {
    artifactType: exportArtifactTypeValidator,
    exportedAt: v.number(),
    exportedByUserId: v.string(),
    manifestHash: v.string(),
    manifestJson: v.string(),
    organizationId: v.optional(v.string()),
    payloadHash: v.string(),
    payloadJson: v.string(),
    schemaVersion: v.string(),
    sourceReportId: v.optional(v.id('evidenceReports')),
  },
  returns: v.id('exportArtifacts'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('exportArtifacts', {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export async function getAuditReadinessSnapshotHandler(ctx: QueryCtx) {
  const [latestBackupDrill, latestRetentionJob, recentAuditLogs, recentExports] = await Promise.all(
    [
      ctx.db.query('backupVerificationReports').withIndex('by_checked_at').order('desc').first(),
      ctx.db.query('retentionJobs').withIndex('by_created_at').order('desc').first(),
      ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').take(200),
      ctx.db
        .query('exportArtifacts')
        .withIndex('by_artifact_type_and_created_at')
        .order('desc')
        .take(50),
    ],
  );

  const metadataGaps = recentAuditLogs
    .filter(
      (log) =>
        ['info', 'warning', 'critical'].includes(log.severity ?? '') &&
        ['success', 'failure'].includes(log.outcome ?? '') &&
        (!log.resourceType || !log.resourceId || !log.sourceSurface),
    )
    .slice(0, 25)
    .map((log) => ({
      createdAt: log.createdAt,
      eventType: log.eventType,
      id: log.id,
      resourceId: log.resourceId ?? null,
    }));

  return {
    latestBackupDrill: latestBackupDrill
      ? {
          artifactHash: latestBackupDrill.artifactHash,
          checkedAt: latestBackupDrill.checkedAt,
          drillId: latestBackupDrill.drillId,
          drillType: latestBackupDrill.drillType,
          failureReason: latestBackupDrill.failureReason,
          initiatedByKind: latestBackupDrill.initiatedByKind,
          initiatedByUserId: latestBackupDrill.initiatedByUserId,
          restoredItemCount: latestBackupDrill.restoredItemCount,
          sourceDataset: latestBackupDrill.sourceDataset,
          status: latestBackupDrill.status,
          targetEnvironment: latestBackupDrill.targetEnvironment,
          verificationMethod: latestBackupDrill.verificationMethod,
        }
      : null,
    latestRetentionJob: latestRetentionJob
      ? {
          createdAt: latestRetentionJob.createdAt,
          details: latestRetentionJob.details,
          jobKind: latestRetentionJob.jobKind,
          processedCount: latestRetentionJob.processedCount,
          status: latestRetentionJob.status,
        }
      : null,
    metadataGaps,
    recentDeniedActions: recentAuditLogs
      .filter((log) => log.eventType === 'authorization_denied')
      .slice(0, 25)
      .map((log) => ({
        createdAt: log.createdAt,
        eventType: log.eventType,
        id: log.id,
        metadata: log.metadata ?? null,
        organizationId: log.organizationId ?? null,
      })),
    recentExports: recentExports.slice(0, 25).map((artifact) => ({
      artifactType: artifact.artifactType,
      exportedAt: artifact.exportedAt,
      manifestHash: artifact.manifestHash,
      sourceReportId: artifact.sourceReportId ?? null,
    })),
  };
}

export const getAuditReadinessSnapshot = internalQuery({
  args: {},
  returns: auditReadinessSnapshotValidator,
  handler: getAuditReadinessSnapshotHandler,
});

export const getAuditReadinessOverview = query({
  args: {},
  returns: auditReadinessSnapshotValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await getAuditReadinessSnapshotHandler(ctx);
  },
});

export const listSecurityControlWorkspaces = query({
  args: {},
  returns: securityControlWorkspaceListValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityControlWorkspaceRecords(ctx, {
      authUserId: currentUser.authUserId,
    });
  },
});

export async function listSecurityControlEvidenceActivityHandler(
  ctx: QueryCtx,
  args: {
    internalControlId: string;
    itemId: string;
  },
) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

  type EvidenceActivityRow = {
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

  const activityLogs = await ctx.db
    .query('securityControlEvidenceActivity')
    .withIndex('by_internal_control_id_and_item_id_and_created_at', (q) =>
      q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
    )
    .order('desc')
    .collect();

  const matchingLogs: EvidenceActivityRow[] = activityLogs.map(
    (log): EvidenceActivityRow => ({
      actorUserId: log.actorUserId,
      auditEventId: log.auditEventId,
      createdAt: log.createdAt,
      eventType: log.eventType,
      evidenceId: log.evidenceId,
      evidenceTitle: log.evidenceTitle,
      internalControlId: log.internalControlId,
      itemId: log.itemId,
      lifecycleStatus:
        log.lifecycleStatus === 'active' ||
        log.lifecycleStatus === 'archived' ||
        log.lifecycleStatus === 'superseded'
          ? log.lifecycleStatus
          : null,
      renewedFromEvidenceId: log.renewedFromEvidenceId,
      replacedByEvidenceId: log.replacedByEvidenceId,
      reviewStatus:
        log.reviewStatus === 'pending' || log.reviewStatus === 'reviewed' ? log.reviewStatus : null,
    }),
  );

  const actorIds = Array.from(
    new Set(
      matchingLogs
        .map((log) => log.actorUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const actorProfiles = await Promise.all(
    actorIds.map(async (authUserId) => {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
      return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
    }),
  );
  const actorDisplayById = new Map(actorProfiles);

  return matchingLogs.map((log) => ({
    id: log.auditEventId,
    eventType: log.eventType,
    actorDisplay: getActorDisplayName(actorDisplayById, log.actorUserId ?? undefined),
    createdAt: log.createdAt,
    evidenceId: log.evidenceId,
    evidenceTitle: log.evidenceTitle,
    internalControlId: log.internalControlId,
    itemId: log.itemId,
    lifecycleStatus: log.lifecycleStatus,
    renewedFromEvidenceId: log.renewedFromEvidenceId,
    replacedByEvidenceId: log.replacedByEvidenceId,
    reviewStatus: log.reviewStatus,
  }));
}

export async function listSecurityFindingsHandler(ctx: QueryCtx) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const currentFindings = await buildCurrentSecurityFindings(ctx);
  const storedFindingEntries = await Promise.all(
    currentFindings.map(async (finding) => {
      const record = await ctx.db
        .query('securityFindings')
        .withIndex('by_finding_key', (q) => q.eq('findingKey', finding.findingKey))
        .unique();
      return [finding.findingKey, record] as const;
    }),
  );
  const storedFindingByKey = new Map(storedFindingEntries);
  const reviewedByIds = Array.from(
    new Set(
      storedFindingEntries
        .map(([, record]) => record?.reviewedByUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const reviewedByProfiles = await Promise.all(
    reviewedByIds.map(async (authUserId) => {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
      return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
    }),
  );
  const reviewedByDisplayById = new Map(reviewedByProfiles);

  return currentFindings.map((finding) => {
    const record = storedFindingByKey.get(finding.findingKey) ?? null;
    return {
      description: finding.description,
      disposition: record?.disposition ?? ('pending_review' as const),
      findingKey: finding.findingKey,
      findingType: finding.findingType,
      firstObservedAt: record
        ? Math.min(record.firstObservedAt, finding.firstObservedAt)
        : finding.firstObservedAt,
      lastObservedAt: Math.max(
        record?.lastObservedAt ?? finding.lastObservedAt,
        finding.lastObservedAt,
      ),
      reviewNotes: record?.reviewNotes ?? null,
      reviewedAt: record?.reviewedAt ?? null,
      reviewedByDisplay: getActorDisplayName(
        reviewedByDisplayById,
        record?.reviewedByUserId ?? undefined,
      ),
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
    };
  });
}

export const listSecurityFindings = query({
  args: {},
  returns: securityFindingListValidator,
  handler: listSecurityFindingsHandler,
});

export async function reviewSecurityFindingHandler(
  ctx: MutationCtx,
  args: {
    disposition:
      | 'accepted_risk'
      | 'false_positive'
      | 'investigating'
      | 'pending_review'
      | 'resolved';
    findingKey: string;
    reviewNotes?: string;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const finding = (await buildCurrentSecurityFindings(ctx)).find(
    (entry) => entry.findingKey === args.findingKey,
  );

  if (!finding) {
    throw new Error('Security finding not found');
  }

  const now = Date.now();
  const existing = await ctx.db
    .query('securityFindings')
    .withIndex('by_finding_key', (q) => q.eq('findingKey', args.findingKey))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      description: finding.description,
      disposition: args.disposition,
      findingType: finding.findingType,
      firstObservedAt: Math.min(existing.firstObservedAt, finding.firstObservedAt),
      lastObservedAt: Math.max(existing.lastObservedAt, finding.lastObservedAt),
      reviewNotes: args.reviewNotes?.trim() || null,
      reviewedAt: now,
      reviewedByUserId: currentUser.authUserId,
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('securityFindings', {
      description: finding.description,
      disposition: args.disposition,
      findingKey: finding.findingKey,
      findingType: finding.findingType,
      firstObservedAt: finding.firstObservedAt,
      lastObservedAt: finding.lastObservedAt,
      reviewNotes: args.reviewNotes?.trim() || null,
      reviewedAt: now,
      reviewedByUserId: currentUser.authUserId,
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
      createdAt: now,
      updatedAt: now,
    });
  }

  const reviewerProfile = await ctx.db
    .query('userProfiles')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', currentUser.authUserId))
    .first();

  return {
    description: finding.description,
    disposition: args.disposition,
    findingKey: finding.findingKey,
    findingType: finding.findingType,
    firstObservedAt: existing
      ? Math.min(existing.firstObservedAt, finding.firstObservedAt)
      : finding.firstObservedAt,
    lastObservedAt: existing
      ? Math.max(existing.lastObservedAt, finding.lastObservedAt)
      : finding.lastObservedAt,
    reviewNotes: args.reviewNotes?.trim() || null,
    reviewedAt: now,
    reviewedByDisplay:
      reviewerProfile?.name?.trim() ||
      reviewerProfile?.email?.trim() ||
      getActorDisplayName(new Map(), currentUser.authUserId),
    severity: finding.severity,
    sourceLabel: finding.sourceLabel,
    sourceRecordId: finding.sourceRecordId,
    sourceType: finding.sourceType,
    status: finding.status,
    title: finding.title,
  };
}

export const reviewSecurityFinding = mutation({
  args: {
    disposition: securityFindingDispositionValidator,
    findingKey: v.string(),
    reviewNotes: v.optional(v.string()),
  },
  returns: securityFindingListItemValidator,
  handler: reviewSecurityFindingHandler,
});

export const listSecurityControlEvidenceActivity = query({
  args: {
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: securityControlEvidenceActivityListValidator,
  handler: listSecurityControlEvidenceActivityHandler,
});

export const addSecurityControlEvidenceLink = mutation({
  args: {
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    url: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'link',
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      url: args.url.trim(),
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title.trim(),
      evidenceType: 'link',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
    });
    return evidenceId;
  },
});

export const createSecurityControlEvidenceLinkInternal = internalMutation({
  args: {
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    organizationId: v.optional(v.string()),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    uploadedByUserId: v.string(),
    url: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'link',
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      url: args.url.trim(),
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: args.uploadedByUserId,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: args.uploadedByUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title.trim(),
      evidenceType: 'link',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: args.organizationId,
      reviewStatus: 'pending',
    });
    return evidenceId;
  },
});

export const addSecurityControlEvidenceNote = mutation({
  args: {
    description: v.string(),
    evidenceDate: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'note',
      title: args.title.trim(),
      description: args.description.trim(),
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title.trim(),
      evidenceType: 'note',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
    });
    return evidenceId;
  },
});

export const reviewSecurityControlEvidence = mutation({
  args: {
    evidenceId: v.id('securityControlEvidence'),
    reviewStatus: v.union(v.literal('pending'), v.literal('reviewed')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) {
      throw new Error('Evidence not found.');
    }
    if ((evidence.lifecycleStatus ?? 'active') !== 'active') {
      throw new Error('Only active evidence can be reviewed.');
    }

    const now = Date.now();
    await ctx.db.patch(args.evidenceId, {
      reviewStatus: args.reviewStatus,
      reviewedAt: args.reviewStatus === 'reviewed' ? now : undefined,
      reviewedByUserId: args.reviewStatus === 'reviewed' ? currentUser.authUserId : undefined,
      updatedAt: now,
    });
    if (args.reviewStatus === 'reviewed') {
      await recordSecurityControlEvidenceAuditEvent(ctx, {
        actorUserId: currentUser.authUserId,
        eventType: 'security_control_evidence_reviewed',
        evidenceId: evidence._id,
        evidenceTitle: evidence.title,
        evidenceType: evidence.evidenceType,
        internalControlId: evidence.internalControlId,
        itemId: evidence.itemId,
        lifecycleStatus: evidence.lifecycleStatus ?? 'active',
        organizationId: currentUser.activeOrganizationId ?? undefined,
        reviewStatus: 'reviewed',
      });
    }
    return null;
  },
});

export async function archiveSecurityControlEvidenceHandler(
  ctx: MutationCtx,
  args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const now = Date.now();

  if (args.evidenceId.includes(':seed:')) {
    const seededEvidence = getSeededEvidenceEntry(
      args.internalControlId,
      args.itemId,
      args.evidenceId,
    );
    if (!seededEvidence) {
      throw new Error('Seeded evidence not found.');
    }

    const existing = await ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
      )
      .unique();
    const archivedSeedEvidence = existing?.archivedSeedEvidence ?? [];
    const nextArchivedSeedEvidence = [
      ...archivedSeedEvidence.filter((entry) => entry.evidenceId !== args.evidenceId),
      {
        evidenceId: args.evidenceId,
        lifecycleStatus: 'archived' as const,
        archivedAt: now,
        archivedByUserId: currentUser.authUserId,
      },
    ];
    const patch = {
      hiddenSeedEvidenceIds: Array.from(
        new Set([...(existing?.hiddenSeedEvidenceIds ?? []), args.evidenceId]),
      ),
      archivedSeedEvidence: nextArchivedSeedEvidence,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlChecklistItems', {
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        createdAt: now,
        ...patch,
      });
    }

    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_archived',
      evidenceId: args.evidenceId,
      evidenceTitle: seededEvidence.entry.title,
      evidenceType: seededEvidence.entry.evidenceType,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'archived',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'reviewed',
    });

    return null;
  }

  const evidenceId = args.evidenceId as Id<'securityControlEvidence'>;
  const evidence = await ctx.db.get(evidenceId);
  if (!evidence) {
    throw new Error('Evidence not found.');
  }
  if ((evidence.lifecycleStatus ?? 'active') !== 'active') {
    throw new Error('Only active evidence can be archived.');
  }

  await ctx.db.patch(evidenceId, {
    lifecycleStatus: 'archived',
    archivedAt: now,
    archivedByUserId: currentUser.authUserId,
    updatedAt: now,
  });
  await recordSecurityControlEvidenceAuditEvent(ctx, {
    actorUserId: currentUser.authUserId,
    eventType: 'security_control_evidence_archived',
    evidenceId: evidence._id,
    evidenceTitle: evidence.title,
    evidenceType: evidence.evidenceType,
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    lifecycleStatus: 'archived',
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reviewStatus: evidence.reviewStatus ?? 'pending',
  });
  return null;
}

export const archiveSecurityControlEvidence = mutation({
  args: {
    evidenceId: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.null(),
  handler: archiveSecurityControlEvidenceHandler,
});

export async function renewSecurityControlEvidenceHandler(
  ctx: MutationCtx,
  args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  },
): Promise<Id<'securityControlEvidence'>> {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const now = Date.now();

  if (args.evidenceId.includes(':seed:')) {
    const seededEvidence = getSeededEvidenceEntry(
      args.internalControlId,
      args.itemId,
      args.evidenceId,
    );
    if (!seededEvidence) {
      throw new Error('Seeded evidence not found.');
    }

    const newEvidenceId = await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: seededEvidence.entry.evidenceType,
      title: seededEvidence.entry.title,
      description: seededEvidence.entry.description ?? undefined,
      url: seededEvidence.entry.url ?? undefined,
      sufficiency: seededEvidence.entry.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      renewedFromEvidenceId: args.evidenceId as Id<'securityControlEvidence'>,
      createdAt: now,
      updatedAt: now,
    });

    const existing = await ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
      )
      .unique();
    const nextArchivedSeedEvidence = [
      ...(existing?.archivedSeedEvidence ?? []).filter(
        (entry) => entry.evidenceId !== args.evidenceId,
      ),
      {
        evidenceId: args.evidenceId,
        lifecycleStatus: 'superseded' as const,
        archivedAt: now,
        archivedByUserId: currentUser.authUserId,
        replacedByEvidenceId: newEvidenceId,
      },
    ];
    const patch = {
      hiddenSeedEvidenceIds: Array.from(
        new Set([...(existing?.hiddenSeedEvidenceIds ?? []), args.evidenceId]),
      ),
      archivedSeedEvidence: nextArchivedSeedEvidence,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlChecklistItems', {
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        createdAt: now,
        ...patch,
      });
    }

    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_created',
      evidenceId: newEvidenceId,
      evidenceTitle: seededEvidence.entry.title,
      evidenceType: seededEvidence.entry.evidenceType,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
      renewedFromEvidenceId: args.evidenceId,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_renewed',
      evidenceId: newEvidenceId,
      evidenceTitle: seededEvidence.entry.title,
      evidenceType: seededEvidence.entry.evidenceType,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
      renewedFromEvidenceId: args.evidenceId,
      replacedByEvidenceId: newEvidenceId,
    });

    return newEvidenceId;
  }

  const evidenceId = args.evidenceId as Id<'securityControlEvidence'>;
  const evidence = await ctx.db.get(evidenceId);
  if (!evidence) {
    throw new Error('Evidence not found.');
  }
  if ((evidence.lifecycleStatus ?? 'active') !== 'active') {
    throw new Error('Only active evidence can be renewed.');
  }

  const newEvidenceId = await ctx.db.insert('securityControlEvidence', {
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    evidenceType: evidence.evidenceType,
    title: evidence.title,
    description: evidence.description,
    url: evidence.url,
    storageId: evidence.storageId,
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    evidenceDate: evidence.evidenceDate,
    reviewDueIntervalMonths: evidence.reviewDueIntervalMonths,
    source: evidence.source,
    sufficiency: evidence.sufficiency,
    uploadedByUserId: currentUser.authUserId,
    reviewStatus: 'pending',
    lifecycleStatus: 'active',
    renewedFromEvidenceId: evidence._id,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(evidenceId, {
    lifecycleStatus: 'superseded',
    archivedAt: now,
    archivedByUserId: currentUser.authUserId,
    replacedByEvidenceId: newEvidenceId,
    updatedAt: now,
  });

  await recordSecurityControlEvidenceAuditEvent(ctx, {
    actorUserId: currentUser.authUserId,
    eventType: 'security_control_evidence_created',
    evidenceId: newEvidenceId,
    evidenceTitle: evidence.title,
    evidenceType: evidence.evidenceType,
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    lifecycleStatus: 'active',
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reviewStatus: 'pending',
    renewedFromEvidenceId: evidence._id,
  });
  await recordSecurityControlEvidenceAuditEvent(ctx, {
    actorUserId: currentUser.authUserId,
    eventType: 'security_control_evidence_renewed',
    evidenceId: newEvidenceId,
    evidenceTitle: evidence.title,
    evidenceType: evidence.evidenceType,
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    lifecycleStatus: 'active',
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reviewStatus: 'pending',
    renewedFromEvidenceId: evidence._id,
    replacedByEvidenceId: newEvidenceId,
  });

  return newEvidenceId;
}

export const renewSecurityControlEvidence = mutation({
  args: {
    evidenceId: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: renewSecurityControlEvidenceHandler,
});

export const createSecurityControlEvidenceUploadTarget = action({
  args: {
    contentType: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.object({
    backend: v.union(v.literal('convex'), v.literal('s3')),
    backendMode: v.union(v.literal('convex'), v.literal('s3-primary'), v.literal('s3-mirror')),
    expiresAt: v.number(),
    storageId: v.string(),
    uploadFields: v.optional(v.record(v.string(), v.string())),
    uploadHeaders: v.optional(v.record(v.string(), v.string())),
    uploadMethod: v.union(v.literal('POST'), v.literal('PUT')),
    uploadUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    validateSecurityEvidenceUploadInput(args);
    await enforceSecurityEvidenceUploadRateLimit(ctx, currentUser.authUserId);
    const target = await createUploadTargetWithMode(ctx, {
      contentType: args.contentType,
      fileName: args.fileName,
      fileSize: args.fileSize,
      sourceId: `${args.internalControlId}:${args.itemId}`,
      sourceType: 'security_control_evidence',
    });
    const backendMode: 'convex' | 's3-primary' | 's3-mirror' =
      target.backend === 'convex'
        ? 'convex'
        : process.env.FILE_STORAGE_BACKEND_MODE === 's3-mirror'
          ? 's3-mirror'
          : 's3-primary';

    return {
      ...target,
      backendMode,
    };
  },
});

export const finalizeSecurityControlEvidenceUpload = action({
  args: {
    backendMode: v.union(v.literal('convex'), v.literal('s3-primary'), v.literal('s3-mirror')),
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    mimeType: v.string(),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    storageId: v.string(),
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args): Promise<Id<'securityControlEvidence'>> => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    await ctx.runAction(internal.storagePlatform.finalizeUploadInternal, {
      backendMode: args.backendMode,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
      sourceId: `${args.internalControlId}:${args.itemId}`,
      sourceType: 'security_control_evidence',
      storageId: args.storageId,
    });

    return await ctx.runMutation(internal.security.createSecurityControlEvidenceFileInternal, {
      description: args.description?.trim() || undefined,
      evidenceDate: args.evidenceDate,
      fileName: args.fileName,
      fileSize: args.fileSize,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      mimeType: args.mimeType,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      storageId: args.storageId,
      source: args.source,
      sufficiency: args.sufficiency,
      title: args.title.trim(),
      uploadedByUserId: currentUser.authUserId,
    });
  },
});

export const createSecurityControlEvidenceFileInternal = internalMutation({
  args: {
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    mimeType: v.string(),
    organizationId: v.optional(v.string()),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    storageId: v.string(),
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    uploadedByUserId: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'file',
      title: args.title,
      description: args.description,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.fileSize,
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: args.uploadedByUserId,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: args.uploadedByUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title,
      evidenceType: 'file',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: args.organizationId,
      reviewStatus: 'pending',
    });
    return evidenceId;
  },
});

export const listEvidenceReports = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: evidenceReportListValidator,
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const reports = await ctx.db
      .query('evidenceReports')
      .withIndex('by_created_at')
      .order('desc')
      .take(limit);
    return reports.map((report) => ({
      id: report._id,
      createdAt: report.createdAt,
      generatedByUserId: report.generatedByUserId,
      reportKind: report.reportKind,
      contentHash: report.contentHash,
      exportHash: report.exportHash ?? null,
      exportManifestHash: report.exportManifestHash ?? null,
      exportedAt: report.exportedAt ?? null,
      exportedByUserId: report.exportedByUserId ?? null,
      reviewStatus: report.reviewStatus,
      reviewedAt: report.reviewedAt ?? null,
      reviewedByUserId: report.reviewedByUserId ?? null,
      reviewNotes: report.reviewNotes ?? null,
    }));
  },
});

export const reviewEvidenceReport = mutation({
  args: {
    id: v.id('evidenceReports'),
    reviewNotes: v.optional(v.string()),
    reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_follow_up')),
  },
  returns: evidenceReportRecordValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const report = await ctx.db.get(args.id);
    if (!report) {
      throw new Error('Evidence report not found');
    }

    const reviewedAt = Date.now();
    await ctx.db.patch(args.id, {
      reviewNotes: args.reviewNotes?.trim() || null,
      reviewStatus: args.reviewStatus,
      reviewedAt,
      reviewedByUserId: currentUser.authUserId,
    });

    if (args.reviewStatus === 'needs_follow_up') {
      await createTriggeredReviewRunRecord(ctx, {
        actorUserId: currentUser.authUserId,
        dedupeKey: `evidence-report:${report._id}`,
        sourceRecordId: report._id,
        sourceRecordType: 'evidence_report',
        title: `${report.reportKind} follow-up`,
        triggerType: 'evidence_report_follow_up',
      });
    }

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'evidence_report_reviewed',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: report._id,
      resourceLabel: report.reportKind,
      resourceType: 'evidence_report',
      severity: args.reviewStatus === 'reviewed' ? 'info' : 'warning',
      sourceSurface: 'admin.security',
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        reviewNotes: args.reviewNotes?.trim() || null,
        reviewStatus: args.reviewStatus,
      }),
    });

    const updated = await ctx.db.get(args.id);
    if (!updated) {
      throw new Error('Evidence report not found after update');
    }

    return updated;
  },
});

export async function exportEvidenceReportHandler(
  ctx: ActionCtx,
  args: {
    id: Id<'evidenceReports'>;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const report = await ctx.runQuery(anyApi.security.getEvidenceReportInternal, {
    id: args.id,
  });
  if (!report) {
    throw new Error('Evidence report not found');
  }

  const exportedAt = Date.now();
  const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditIntegrityInternal, {
    limit: 250,
  });
  const exportBundle = stringifyStable({
    contentHash: report.contentHash,
    exportedAt: new Date(exportedAt).toISOString(),
    integritySummary: {
      contentHash: report.contentHash,
      checkedAt: integrityCheck.checkedAt,
      failureCount: integrityCheck.failures.length,
      reviewedAt: report.reviewedAt ?? null,
      reviewStatus: report.reviewStatus,
    },
    report: JSON.parse(report.contentJson),
    reportId: report._id,
  });
  const exportHash = await hashContent(exportBundle);
  const exportId = crypto.randomUUID();
  const manifest = buildExportManifest({
    actorUserId: currentUser.authUserId,
    contentHash: report.contentHash,
    exactFilters: {
      reportId: report._id,
      reportKind: report.reportKind,
    },
    exportHash,
    exportId,
    exportedAt,
    integritySummary: summarizeIntegrityCheck(integrityCheck),
    organizationScope: report.organizationId ?? currentUser.activeOrganizationId ?? null,
    reviewStatusAtExport: report.reviewStatus,
    rowCount: 1,
    sourceReportId: report._id,
  });
  const manifestJson = stringifyStable(manifest);
  const manifestHash = await hashContent(manifestJson);
  const exportIntegritySummary = stringifyStable({
    contentHash: report.contentHash,
    exportHash,
    manifestHash,
    reviewStatus: report.reviewStatus,
  });
  const artifactId = await ctx.runMutation(anyApi.security.storeExportArtifact, {
    artifactType: 'evidence_report_export',
    exportedAt,
    exportedByUserId: currentUser.authUserId,
    manifestHash,
    manifestJson,
    organizationId: report.organizationId ?? currentUser.activeOrganizationId ?? undefined,
    payloadHash: exportHash,
    payloadJson: exportBundle,
    schemaVersion: EXPORT_ARTIFACT_SCHEMA_VERSION,
    sourceReportId: args.id,
  });

  await ctx.runMutation(anyApi.security.storeEvidenceReportExport, {
    id: args.id,
    exportBundleJson: exportBundle,
    exportHash,
    exportIntegritySummary,
    exportManifestHash: manifestHash,
    exportManifestJson: manifestJson,
    exportedAt,
    exportedByUserId: currentUser.authUserId,
    latestExportArtifactId: artifactId,
  });

  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    actorUserId: currentUser.authUserId,
    eventType: 'evidence_report_exported',
    identifier: currentUser.authUser.email ?? undefined,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: report._id,
    resourceLabel: report.reportKind,
    resourceType: 'evidence_report',
    severity: 'info',
    sourceSurface: 'admin.security',
    userId: currentUser.authUserId,
    metadata: stringifyStable({
      exportHash,
      exportId,
      filters: manifest.exactFilters,
      manifestHash,
      rowCount: manifest.rowCount,
      scope: manifest.organizationScope,
    }),
  });

  return {
    createdAt: report.createdAt,
    exportHash,
    id: report._id,
    report: exportBundle,
    reportKind: report.reportKind,
    reviewStatus: report.reviewStatus,
  };
}

export const exportEvidenceReport = action({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: evidenceReportValidator,
  handler: exportEvidenceReportHandler,
});

export const getEvidenceReportInternal = internalQuery({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: v.union(evidenceReportRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.id)) ?? null;
  },
});

export const storeEvidenceReportExport = internalMutation({
  args: {
    id: v.id('evidenceReports'),
    exportBundleJson: v.string(),
    exportHash: v.string(),
    exportIntegritySummary: v.string(),
    exportManifestHash: v.string(),
    exportManifestJson: v.string(),
    exportedAt: v.number(),
    exportedByUserId: v.string(),
    latestExportArtifactId: v.id('exportArtifacts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      exportBundleJson: args.exportBundleJson,
      exportHash: args.exportHash,
      exportIntegritySummary: args.exportIntegritySummary,
      exportManifestHash: args.exportManifestHash,
      exportManifestJson: args.exportManifestJson,
      exportedAt: args.exportedAt,
      exportedByUserId: args.exportedByUserId,
      latestExportArtifactId: args.latestExportArtifactId,
    });
    return null;
  },
});

export async function generateEvidenceReportHandler(
  ctx: ActionCtx,
  args: {
    reportKind?:
      | 'security_posture'
      | 'audit_integrity'
      | 'audit_readiness'
      | 'annual_review'
      | 'findings_snapshot'
      | 'vendor_posture_snapshot'
      | 'control_workspace_snapshot';
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const reportKind = args.reportKind ?? 'security_posture';
  const summary = await ctx.runQuery(anyApi.security.getSecurityPostureSummary, {});
  const controlWorkspace = (await ctx.runQuery(
    anyApi.security.listSecurityControlWorkspaces,
    {},
  )) as Array<{
    evidenceReadiness: 'missing' | 'partial' | 'ready';
    internalControlId: string;
    platformChecklist: Array<{
      evidence: Array<{
        createdAt: number;
        id: string;
        lifecycleStatus: 'active' | 'archived' | 'superseded';
        reviewStatus: 'pending' | 'reviewed';
        reviewedAt: number | null;
        sufficiency: 'missing' | 'partial' | 'sufficient';
        title: string;
      }>;
      itemId: string;
    }>;
  }>;
  const recentAuditLogs: Array<{
    createdAt: number;
    eventType: string;
    organizationId?: string;
    outcome?: 'success' | 'failure';
    resourceType?: string;
    sourceSurface?: string;
  }> = await ctx.runQuery(anyApi.audit.getRecentAuditLogsInternal, {
    limit: 25,
  });
  const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditIntegrityInternal, {
    limit: 250,
  });
  const auditReadinessSnapshot = await ctx.runQuery(anyApi.security.getAuditReadinessSnapshot, {});
  const currentOrganizationPolicies = currentUser.activeOrganizationId
    ? await ctx.runQuery(anyApi.organizationManagement.getOrganizationPoliciesInternal, {
        organizationId: currentUser.activeOrganizationId,
      })
    : null;
  const vendorPosture = getVendorBoundarySnapshot();
  const currentFindings = (
    reportKind === 'findings_snapshot' || reportKind === 'annual_review'
      ? await ctx.runQuery(anyApi.security.listSecurityFindings, {})
      : []
  ) as Array<{
    disposition:
      | 'accepted_risk'
      | 'false_positive'
      | 'investigating'
      | 'pending_review'
      | 'resolved';
    status: 'open' | 'resolved';
  }>;
  const createdAt = Date.now();
  const reportPayload =
    reportKind === 'audit_readiness'
      ? {
          generatedAt: new Date(createdAt).toISOString(),
          generatedByUserId: currentUser.authUserId,
          integrityCheck,
          retention: {
            lastJobAt: auditReadinessSnapshot.latestRetentionJob?.createdAt ?? null,
            lastJobStatus: auditReadinessSnapshot.latestRetentionJob?.status ?? null,
            processedCount: auditReadinessSnapshot.latestRetentionJob?.processedCount ?? null,
          },
          recentDeniedActions: auditReadinessSnapshot.recentDeniedActions,
          recentExports: auditReadinessSnapshot.recentExports,
          backupDrill: {
            isStale:
              auditReadinessSnapshot.latestBackupDrill === null ||
              createdAt - auditReadinessSnapshot.latestBackupDrill.checkedAt >
                BACKUP_DRILL_STALE_WINDOW_MS,
            latest: auditReadinessSnapshot.latestBackupDrill,
          },
          metadataGaps: auditReadinessSnapshot.metadataGaps,
          summary: {
            backupDrillStatus: auditReadinessSnapshot.latestBackupDrill?.status ?? null,
            deniedActionCount: auditReadinessSnapshot.recentDeniedActions.length,
            exportCount: auditReadinessSnapshot.recentExports.length,
            integrityFailureCount: integrityCheck.failures.length,
            metadataGapCount: auditReadinessSnapshot.metadataGaps.length,
          },
        }
      : reportKind === 'findings_snapshot'
        ? {
            findings: currentFindings,
            generatedAt: new Date(createdAt).toISOString(),
            generatedByUserId: currentUser.authUserId,
            summary: {
              openCount: currentFindings.filter((finding) => finding.status === 'open').length,
              totalCount: currentFindings.length,
              unresolvedCount: currentFindings.filter(
                (finding) => finding.disposition !== 'resolved',
              ).length,
            },
          }
        : reportKind === 'vendor_posture_snapshot'
          ? {
              generatedAt: new Date(createdAt).toISOString(),
              generatedByUserId: currentUser.authUserId,
              summary: {
                approvedCount: vendorPosture.filter((vendor) => vendor.approved).length,
                totalCount: vendorPosture.length,
              },
              vendorBoundary: vendorPosture,
            }
          : reportKind === 'control_workspace_snapshot'
            ? {
                controls: controlWorkspace,
                generatedAt: new Date(createdAt).toISOString(),
                generatedByUserId: currentUser.authUserId,
                summary: {
                  readyCount: controlWorkspace.filter(
                    (control) => control.evidenceReadiness === 'ready',
                  ).length,
                  totalCount: controlWorkspace.length,
                },
              }
            : reportKind === 'annual_review'
              ? {
                  controls: controlWorkspace,
                  findings: currentFindings,
                  generatedAt: new Date(createdAt).toISOString(),
                  generatedByUserId: currentUser.authUserId,
                  summary,
                  vendorBoundary: vendorPosture,
                }
              : {
                  generatedAt: new Date(createdAt).toISOString(),
                  generatedByUserId: currentUser.authUserId,
                  baselineDefaults: {
                    organizationPolicies: REGULATED_ORGANIZATION_POLICY_DEFAULTS,
                  },
                  sessionPolicy: {
                    sessionExpiryHours: 24,
                    sessionRefreshHours: 4,
                    recentStepUpWindowMinutes: getRetentionPolicyConfig().recentStepUpWindowMinutes,
                    temporaryLinkTtlMinutes: getRetentionPolicyConfig().attachmentUrlTtlMinutes,
                  },
                  telemetryPosture: {
                    sentryApproved: vendorPosture.some(
                      (vendor) => vendor.vendor === 'sentry' && vendor.approved,
                    ),
                    sentryEnabled:
                      vendorPosture.some(
                        (vendor) => vendor.vendor === 'sentry' && vendor.approved,
                      ) && Boolean(process.env.VITE_SENTRY_DSN),
                  },
                  vendorBoundary: vendorPosture,
                  verificationPosture: {
                    emailVerificationRequired: ALWAYS_ON_REGULATED_BASELINE.requireVerifiedEmail,
                    mfaRequired: ALWAYS_ON_REGULATED_BASELINE.requireMfaOrPasskey,
                  },
                  integrityCheck,
                  recentAuditEvents: recentAuditLogs.slice(0, 10).map((log) => ({
                    createdAt: log.createdAt,
                    eventType: log.eventType,
                    outcome: log.outcome ?? null,
                    organizationId: log.organizationId ?? null,
                    resourceType: log.resourceType ?? null,
                    sourceSurface: log.sourceSurface ?? null,
                  })),
                  scopedOrganizationPolicies: currentOrganizationPolicies,
                  summary,
                  controls: controlWorkspace,
                };
  const report = stringifyStable(reportPayload);
  const contentHash = await hashContent(report);

  const id = await ctx.runMutation(anyApi.security.createEvidenceReport, {
    contentJson: report,
    contentHash,
    generatedByUserId: currentUser.authUserId,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reportKind,
  });

  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    actorUserId: currentUser.authUserId,
    eventType: 'evidence_report_generated',
    identifier: currentUser.authUser.email ?? undefined,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: id,
    resourceLabel: reportKind,
    resourceType: 'evidence_report',
    severity: 'info',
    sourceSurface: 'admin.security',
    userId: currentUser.authUserId,
    metadata: stringifyStable({
      contentHash,
      filters: { reportKind },
    }),
  });

  return {
    createdAt,
    exportHash: null,
    id,
    report,
    reportKind,
    reviewStatus: 'pending' as const,
  };
}

export const generateEvidenceReport = action({
  args: {
    reportKind: v.optional(evidenceReportKindValidator),
  },
  returns: evidenceReportValidator,
  handler: generateEvidenceReportHandler,
});

export const storeReviewRunFinalization = internalMutation({
  args: {
    finalReportId: v.id('evidenceReports'),
    finalizedAt: v.number(),
    finalizedByUserId: v.string(),
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reviewRunId, {
      finalReportId: args.finalReportId,
      finalizedAt: args.finalizedAt,
      finalizedByUserId: args.finalizedByUserId,
      status: 'completed',
      updatedAt: args.finalizedAt,
    });
    return null;
  },
});

export const refreshReviewRunAutomation = action({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const detail = (await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    })) as {
      id: Id<'reviewRuns'>;
      kind: 'annual' | 'triggered';
      tasks: Array<{
        freshnessWindowDays: number | null;
        id: Id<'reviewTasks'>;
        taskType: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up';
        templateKey: string;
        title: string;
      }>;
    } | null;
    if (!detail) {
      return null;
    }
    if (detail.kind !== 'annual') {
      return detail;
    }

    const controlWorkspace = (await ctx.runQuery(
      anyApi.security.listSecurityControlWorkspaces,
      {},
    )) as Array<{
      internalControlId: string;
      platformChecklist: Array<{
        evidence: Array<{
          createdAt: number;
          id: string;
          lifecycleStatus: 'active' | 'archived' | 'superseded';
          reviewedAt: number | null;
          sufficiency: 'missing' | 'partial' | 'sufficient';
          title: string;
        }>;
        itemId: string;
      }>;
    }>;
    const findings = (await ctx.runQuery(anyApi.security.listSecurityFindings, {})) as Array<{
      status: 'open' | 'resolved';
    }>;
    const auditReadiness = await ctx.runQuery(anyApi.security.getAuditReadinessOverview, {});

    for (const task of detail.tasks.filter((entry) => entry.taskType === 'automated_check')) {
      const blueprint = ANNUAL_REVIEW_TASK_BLUEPRINTS.find(
        (entry) => entry.templateKey === task.templateKey,
      );
      if (!blueprint?.automationKind) {
        continue;
      }

      const now = Date.now();
      if (
        blueprint.automationKind === 'security_posture' ||
        blueprint.automationKind === 'audit_readiness' ||
        blueprint.automationKind === 'findings_snapshot' ||
        blueprint.automationKind === 'vendor_posture_snapshot' ||
        blueprint.automationKind === 'control_workspace_snapshot'
      ) {
        const reportKind =
          blueprint.automationKind === 'security_posture'
            ? 'security_posture'
            : blueprint.automationKind === 'audit_readiness'
              ? 'audit_readiness'
              : blueprint.automationKind;
        const report = await generateEvidenceReportHandler(ctx, {
          reportKind,
        });
        await ctx.runMutation(anyApi.security.replaceReviewTaskEvidenceLinksInternal, {
          reviewTaskId: task.id,
          sourceTypes: ['evidence_report'],
        });
        await ctx.runMutation(anyApi.security.upsertReviewTaskEvidenceLinkInternal, {
          freshAt: report.createdAt,
          reviewRunId: detail.id,
          reviewTaskId: task.id,
          role: 'primary',
          sourceId: report.id,
          sourceLabel: getAutomationEvidenceLabel(blueprint),
          sourceType: 'evidence_report',
        });

        const findingsOpenCount =
          reportKind === 'findings_snapshot'
            ? findings.filter((finding) => finding.status === 'open').length
            : 0;
        const status =
          reportKind === 'findings_snapshot' && findingsOpenCount > 0 ? 'blocked' : 'completed';
        await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
          actorUserId: 'system:automation',
          mode: 'automated_check',
          note:
            status === 'blocked'
              ? `${findingsOpenCount} open finding(s) still require follow-up.`
              : undefined,
          reviewTaskId: task.id,
          resultType: 'automated_check',
          satisfiedAt: status === 'completed' ? report.createdAt : null,
          satisfiedThroughAt:
            status === 'completed'
              ? addDays(report.createdAt, task.freshnessWindowDays ?? 30)
              : null,
          status,
        });
        continue;
      }

      if (blueprint.automationKind === 'backup_verification') {
        const latestBackupDrill = auditReadiness.latestBackupDrill;
        await ctx.runMutation(anyApi.security.replaceReviewTaskEvidenceLinksInternal, {
          reviewTaskId: task.id,
          sourceTypes: ['backup_verification_report'],
        });
        if (!latestBackupDrill) {
          await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
            actorUserId: 'system:automation',
            mode: 'automated_check',
            note: 'No backup verification evidence is currently recorded.',
            reviewTaskId: task.id,
            resultType: 'automated_check',
            satisfiedAt: null,
            satisfiedThroughAt: null,
            status: 'blocked',
          });
          continue;
        }

        await ctx.runMutation(anyApi.security.upsertReviewTaskEvidenceLinkInternal, {
          freshAt: latestBackupDrill.checkedAt,
          reviewRunId: detail.id,
          reviewTaskId: task.id,
          role: 'primary',
          sourceId: latestBackupDrill.drillId,
          sourceLabel: getAutomationEvidenceLabel(blueprint),
          sourceType: 'backup_verification_report',
        });
        await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
          actorUserId: 'system:automation',
          mode: 'automated_check',
          reviewTaskId: task.id,
          resultType: 'automated_check',
          satisfiedAt: latestBackupDrill.checkedAt,
          satisfiedThroughAt: addDays(latestBackupDrill.checkedAt, task.freshnessWindowDays ?? 90),
          status: 'completed',
        });
        continue;
      }

      if (blueprint.automationKind === 'release_provenance') {
        await ctx.runMutation(anyApi.security.replaceReviewTaskEvidenceLinksInternal, {
          reviewTaskId: task.id,
          sourceTypes: ['security_control_evidence'],
        });
        const releaseControl = controlWorkspace.find(
          (control) => control.internalControlId === RELEASE_PROVENANCE_CONTROL_ID,
        );
        const releaseItem = releaseControl?.platformChecklist.find(
          (item) => item.itemId === RELEASE_PROVENANCE_ITEM_ID,
        );
        const latestEvidence = [...(releaseItem?.evidence ?? [])]
          .filter((entry) => entry.lifecycleStatus === 'active')
          .sort((left, right) => right.createdAt - left.createdAt)[0];

        if (!latestEvidence) {
          await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
            actorUserId: 'system:automation',
            mode: 'automated_check',
            note: 'No release provenance evidence is currently linked.',
            reviewTaskId: task.id,
            resultType: 'automated_check',
            satisfiedAt: null,
            satisfiedThroughAt: null,
            status: 'blocked',
          });
          continue;
        }

        await ctx.runMutation(anyApi.security.upsertReviewTaskEvidenceLinkInternal, {
          freshAt: latestEvidence.reviewedAt ?? latestEvidence.createdAt,
          reviewRunId: detail.id,
          reviewTaskId: task.id,
          role: latestEvidence.sufficiency === 'sufficient' ? 'primary' : 'blocking',
          sourceId: latestEvidence.id,
          sourceLabel: latestEvidence.title,
          sourceType: 'security_control_evidence',
        });
        await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
          actorUserId: 'system:automation',
          mode: 'automated_check',
          note:
            latestEvidence.sufficiency === 'sufficient'
              ? undefined
              : 'The latest release provenance evidence is partial and still needs follow-up.',
          reviewTaskId: task.id,
          resultType: 'automated_check',
          satisfiedAt:
            latestEvidence.sufficiency === 'sufficient'
              ? (latestEvidence.reviewedAt ?? latestEvidence.createdAt)
              : null,
          satisfiedThroughAt:
            latestEvidence.sufficiency === 'sufficient'
              ? addDays(
                  latestEvidence.reviewedAt ?? latestEvidence.createdAt,
                  task.freshnessWindowDays ?? 90,
                )
              : null,
          status: latestEvidence.sufficiency === 'sufficient' ? 'completed' : 'blocked',
        });
      }
    }

    return await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    });
  },
});

export const finalizeReviewRun = action({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const detail = (await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    })) as {
      id: Id<'reviewRuns'>;
      required?: boolean;
      tasks: Array<{
        required: boolean;
        status: 'ready' | 'completed' | 'exception' | 'blocked';
        title: string;
      }>;
      title: string;
    } | null;
    if (!detail) {
      return null;
    }

    const blockingTask = detail.tasks.find((task) => task.required && task.status === 'blocked');
    if (blockingTask) {
      throw new Error(`Finalize is blocked by "${blockingTask.title}".`);
    }
    const incompleteTask = detail.tasks.find(
      (task) => task.required && task.status !== 'completed' && task.status !== 'exception',
    );
    if (incompleteTask) {
      throw new Error(`Finalize requires "${incompleteTask.title}" to be completed first.`);
    }

    const createdAt = Date.now();
    const reportPayload = stringifyStable({
      finalizedAt: new Date(createdAt).toISOString(),
      generatedAt: new Date(createdAt).toISOString(),
      generatedByUserId: currentUser.authUserId,
      reviewRun: detail,
    });
    const reportId = await ctx.runMutation(anyApi.security.createEvidenceReport, {
      contentJson: reportPayload,
      contentHash: await hashContent(reportPayload),
      generatedByUserId: currentUser.authUserId,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reportKind: 'annual_review',
    });
    await exportEvidenceReportHandler(ctx, {
      id: reportId,
    });
    await ctx.runMutation(anyApi.security.storeReviewRunFinalization, {
      finalReportId: reportId,
      finalizedAt: createdAt,
      finalizedByUserId: currentUser.authUserId,
      reviewRunId: args.reviewRunId,
    });

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_review_run_finalized',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: args.reviewRunId,
      resourceLabel: detail.title,
      resourceType: 'review_run',
      severity: 'info',
      sourceSurface: REVIEW_RUN_SOURCE_SURFACE,
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        finalReportId: reportId,
        reviewRunId: args.reviewRunId,
      }),
    });

    return await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    });
  },
});

export const cleanupExpiredAttachments = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const expiredAttachments = await ctx.runQuery(
      internal.security.listExpiredAttachmentsInternal,
      {
        now,
      },
    );

    let processedCount = 0;

    for (const attachment of expiredAttachments) {
      if (attachment.extractedTextStorageId) {
        await ctx.storage.delete(attachment.extractedTextStorageId);
      }

      await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
        storageId: attachment.storageId,
      });

      await ctx.runMutation(internal.agentChat.deleteAttachmentStorageInternal, {
        attachmentId: attachment._id,
      });
      processedCount += 1;
    }

    await ctx.runMutation(internal.security.recordRetentionJob, {
      details: processedCount > 0 ? `Purged ${processedCount} expired attachments` : undefined,
      jobKind: 'attachment_purge',
      processedCount,
      status: 'success',
    });

    return null;
  },
});

export const listExpiredAttachmentsInternal = internalQuery({
  args: {
    now: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id('chatAttachments'),
      extractedTextStorageId: v.optional(v.id('_storage')),
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query('chatAttachments')
      .withIndex('by_purgeEligibleAt', (q) => q.lt('purgeEligibleAt', args.now))
      .collect();

    return expired.map((attachment) => ({
      _id: attachment._id,
      extractedTextStorageId: attachment.extractedTextStorageId,
      storageId: attachment.storageId,
    }));
  },
});

export const reseedSecurityControlWorkspaceForDevelopment = internalMutation({
  args: {
    secret: v.string(),
  },
  returns: v.object({
    activeSeedControlCount: v.number(),
    deletedReviewAttestations: v.number(),
    deletedReviewRuns: v.number(),
    deletedReviewTaskEvidenceLinks: v.number(),
    deletedReviewTaskResults: v.number(),
    deletedReviewTasks: v.number(),
    deletedChecklistItems: v.number(),
    deletedEvidence: v.number(),
    deletedEvidenceActivity: v.number(),
    deletedEvidenceReports: v.number(),
    deletedExportArtifacts: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.secret !== getE2ETestSecret()) {
      throw new Error('Invalid reseed secret.');
    }

    const [
      checklistItems,
      evidenceRows,
      evidenceActivityRows,
      evidenceReports,
      exportArtifacts,
      reviewRuns,
      reviewTasks,
      reviewTaskResults,
      reviewAttestations,
      reviewTaskEvidenceLinks,
    ] = await Promise.all([
      ctx.db.query('securityControlChecklistItems').collect(),
      ctx.db.query('securityControlEvidence').collect(),
      ctx.db.query('securityControlEvidenceActivity').collect(),
      ctx.db.query('evidenceReports').collect(),
      ctx.db.query('exportArtifacts').collect(),
      ctx.db.query('reviewRuns').collect(),
      ctx.db.query('reviewTasks').collect(),
      ctx.db.query('reviewTaskResults').collect(),
      ctx.db.query('reviewAttestations').collect(),
      ctx.db.query('reviewTaskEvidenceLinks').collect(),
    ]);

    await Promise.all([
      ...checklistItems.map((row) => ctx.db.delete(row._id)),
      ...evidenceRows.map((row) => ctx.db.delete(row._id)),
      ...evidenceActivityRows.map((row) => ctx.db.delete(row._id)),
      ...evidenceReports.map((row) => ctx.db.delete(row._id)),
      ...exportArtifacts.map((row) => ctx.db.delete(row._id)),
      ...reviewRuns.map((row) => ctx.db.delete(row._id)),
      ...reviewTasks.map((row) => ctx.db.delete(row._id)),
      ...reviewTaskResults.map((row) => ctx.db.delete(row._id)),
      ...reviewAttestations.map((row) => ctx.db.delete(row._id)),
      ...reviewTaskEvidenceLinks.map((row) => ctx.db.delete(row._id)),
    ]);

    return {
      activeSeedControlCount: ACTIVE_CONTROL_REGISTER.controls.length,
      deletedReviewAttestations: reviewAttestations.length,
      deletedReviewRuns: reviewRuns.length,
      deletedReviewTaskEvidenceLinks: reviewTaskEvidenceLinks.length,
      deletedReviewTaskResults: reviewTaskResults.length,
      deletedReviewTasks: reviewTasks.length,
      deletedChecklistItems: checklistItems.length,
      deletedEvidence: evidenceRows.length,
      deletedEvidenceActivity: evidenceActivityRows.length,
      deletedEvidenceReports: evidenceReports.length,
      deletedExportArtifacts: exportArtifacts.length,
    };
  },
});
