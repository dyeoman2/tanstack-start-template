import { components } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import { v } from 'convex/values';

const SECURITY_METRICS_KEY = 'global';
const SECURITY_SCOPE_TYPE = 'provider_global' as const;
const SECURITY_SCOPE_ID = 'provider' as const;
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

const vendorKeyValidator = v.union(
  v.literal('openrouter'),
  v.literal('resend'),
  v.literal('sentry'),
);
const vendorRuntimePostureValidator = v.object({
  allowedDataClasses: v.array(v.string()),
  allowedEnvironments: v.array(
    v.union(v.literal('development'), v.literal('production'), v.literal('test')),
  ),
  approvalEnvVar: v.union(v.string(), v.null()),
  approved: v.boolean(),
  approvedByDefault: v.boolean(),
  displayName: v.string(),
  vendor: vendorKeyValidator,
});
const vendorReviewStatusValidator = v.union(
  v.literal('current'),
  v.literal('due_soon'),
  v.literal('overdue'),
);
const vendorRelatedControlValidator = v.object({
  internalControlId: v.string(),
  itemId: v.union(v.string(), v.null()),
  itemLabel: v.union(v.string(), v.null()),
  nist80053Id: v.string(),
  title: v.string(),
});
const securityScopeTypeValidator = v.literal(SECURITY_SCOPE_TYPE);
const securityScopeIdValidator = v.string();
const securityRelationshipObjectTypeValidator = v.union(
  v.literal('policy'),
  v.literal('control'),
  v.literal('checklist_item'),
  v.literal('evidence'),
  v.literal('finding'),
  v.literal('vendor'),
  v.literal('review_run'),
  v.literal('review_task'),
  v.literal('evidence_report'),
);
const securityRelationshipTypeValidator = v.union(
  v.literal('has_evidence'),
  v.literal('tracks_finding'),
  v.literal('tracks_vendor'),
  v.literal('has_review_task'),
  v.literal('has_report'),
  v.literal('supports'),
  v.literal('satisfies'),
  v.literal('follow_up_for'),
  v.literal('related_control'),
);
const linkedEntitySummaryValidator = v.object({
  entityId: v.string(),
  entityType: securityRelationshipObjectTypeValidator,
  label: v.string(),
  relationshipType: securityRelationshipTypeValidator,
  status: v.union(v.string(), v.null()),
});
const securityPolicySupportValidator = v.union(
  v.literal('missing'),
  v.literal('partial'),
  v.literal('complete'),
);
const securityPolicyMappedControlValidator = v.object({
  familyId: v.string(),
  familyTitle: v.string(),
  implementationSummary: v.optional(v.string()),
  internalControlId: v.string(),
  isPrimary: v.boolean(),
  nist80053Id: v.string(),
  platformChecklist: v.array(
    v.object({
      itemId: v.string(),
      label: v.string(),
      required: v.boolean(),
      support: securityPolicySupportValidator,
    }),
  ),
  responsibility: v.union(
    v.literal('platform'),
    v.literal('shared-responsibility'),
    v.literal('customer'),
    v.null(),
  ),
  support: securityPolicySupportValidator,
  title: v.string(),
});
const securityPolicyLinkedReviewTaskValidator = v.object({
  id: v.id('reviewTasks'),
  status: v.union(
    v.literal('ready'),
    v.literal('completed'),
    v.literal('exception'),
    v.literal('blocked'),
  ),
  title: v.string(),
});
const securityPolicySummaryValidator = v.object({
  contentHash: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  linkedAnnualReviewTask: v.union(securityPolicyLinkedReviewTaskValidator, v.null()),
  mappedControlCount: v.number(),
  mappedControlCountsBySupport: v.object({
    complete: v.number(),
    missing: v.number(),
    partial: v.number(),
  }),
  nextReviewAt: v.union(v.number(), v.null()),
  owner: v.string(),
  policyId: v.string(),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  sourcePath: v.string(),
  summary: v.string(),
  support: securityPolicySupportValidator,
  title: v.string(),
});
const securityPolicyDetailValidator = v.object({
  contentHash: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  linkedAnnualReviewTask: v.union(securityPolicyLinkedReviewTaskValidator, v.null()),
  mappedControls: v.array(securityPolicyMappedControlValidator),
  nextReviewAt: v.union(v.number(), v.null()),
  owner: v.string(),
  policyId: v.string(),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  sourcePath: v.string(),
  sourceMarkdown: v.union(v.string(), v.null()),
  summary: v.string(),
  support: securityPolicySupportValidator,
  title: v.string(),
});
const securityPolicySummaryListValidator = v.array(securityPolicySummaryValidator);
const vendorWorkspaceValidator = v.object({
  allowedDataClasses: v.array(v.string()),
  allowedEnvironments: v.array(
    v.union(v.literal('development'), v.literal('production'), v.literal('test')),
  ),
  approvalEnvVar: v.union(v.string(), v.null()),
  approved: v.boolean(),
  approvedByDefault: v.boolean(),
  title: v.string(),
  summary: v.union(v.string(), v.null()),
  linkedFollowUpRunId: v.union(v.id('reviewRuns'), v.null()),
  linkedEntities: v.array(linkedEntitySummaryValidator),
  linkedAnnualReviewTask: v.union(
    v.object({
      id: v.id('reviewTasks'),
      status: v.union(
        v.literal('ready'),
        v.literal('completed'),
        v.literal('exception'),
        v.literal('blocked'),
      ),
      title: v.string(),
    }),
    v.null(),
  ),
  owner: v.union(v.string(), v.null()),
  relatedControls: v.array(vendorRelatedControlValidator),
  reviewStatus: vendorReviewStatusValidator,
  lastReviewedAt: v.union(v.number(), v.null()),
  nextReviewAt: v.union(v.number(), v.null()),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  vendor: vendorKeyValidator,
});
const vendorWorkspaceListValidator = v.array(vendorWorkspaceValidator);

const securityPostureSummaryValidator = v.object({
  audit: v.object({
    integrityFailures: v.number(),
    lastEventAt: v.union(v.number(), v.null()),
    lastImmutableExportAt: v.union(v.number(), v.null()),
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
  vendors: v.array(vendorRuntimePostureValidator),
});

const securityFindingTypeValidator = v.union(
  v.literal('audit_integrity_failures'),
  v.literal('audit_request_context_gaps'),
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
  customerSummary: v.union(v.string(), v.null()),
  description: v.string(),
  disposition: securityFindingDispositionValidator,
  findingKey: v.string(),
  findingType: securityFindingTypeValidator,
  firstObservedAt: v.number(),
  internalNotes: v.union(v.string(), v.null()),
  lastObservedAt: v.number(),
  latestLinkedReviewRun: v.union(
    v.object({
      id: v.id('reviewRuns'),
      status: v.union(v.literal('ready'), v.literal('needs_attention'), v.literal('completed')),
      title: v.string(),
    }),
    v.null(),
  ),
  relatedControls: v.array(vendorRelatedControlValidator),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
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
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

const SECURITY_EVIDENCE_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.gif',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.txt',
  '.webp',
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
  id: v.id('evidenceReports'),
  latestExport: v.union(
    v.object({
      exportHash: v.string(),
      exportedAt: v.number(),
      exportedByUserId: v.string(),
      id: v.id('exportArtifacts'),
      manifestHash: v.string(),
    }),
    v.null(),
  ),
  report: v.string(),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
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
  scopeId: v.optional(v.string()),
  scopeType: v.optional(securityScopeTypeValidator),
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
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByUserId: v.union(v.string(), v.null()),
  customerSummary: v.optional(v.union(v.string(), v.null())),
  internalReviewNotes: v.optional(v.union(v.string(), v.null())),
  createdAt: v.number(),
});

const evidenceReportLatestExportSummaryValidator = v.object({
  exportHash: v.string(),
  exportedAt: v.number(),
  exportedByUserId: v.string(),
  id: v.id('exportArtifacts'),
  manifestHash: v.string(),
});

const evidenceReportLatestExportDetailValidator = v.object({
  exportHash: v.string(),
  exportedAt: v.number(),
  exportedByUserId: v.string(),
  id: v.id('exportArtifacts'),
  integritySummary: v.union(
    v.object({
      checkedAt: v.union(v.string(), v.null()),
      failureCount: v.number(),
      verified: v.boolean(),
    }),
    v.null(),
  ),
  manifestHash: v.string(),
  manifestJson: v.string(),
  schemaVersion: v.string(),
});

const evidenceReportListItemValidator = v.object({
  id: v.id('evidenceReports'),
  createdAt: v.number(),
  generatedByUserId: v.string(),
  customerSummary: v.union(v.string(), v.null()),
  internalNotes: v.union(v.string(), v.null()),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
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
  latestExport: v.union(evidenceReportLatestExportSummaryValidator, v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByUserId: v.union(v.string(), v.null()),
});

const evidenceReportListValidator = v.array(evidenceReportListItemValidator);
const supportStatusValidator = v.union(
  v.literal('missing'),
  v.literal('partial'),
  v.literal('complete'),
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
  v.literal('review_attestation'),
  v.literal('review_document'),
  v.literal('automated_review_result'),
  v.literal('follow_up_resolution'),
  v.literal('review_exception'),
);
const evidenceExpiryStatusValidator = v.union(
  v.literal('none'),
  v.literal('current'),
  v.literal('expiring_soon'),
  v.literal('expired'),
);
const evidenceTypeValidator = v.union(
  v.literal('file'),
  v.literal('link'),
  v.literal('note'),
  v.literal('system_snapshot'),
  v.literal('review_attestation'),
  v.literal('review_document'),
  v.literal('automated_review_result'),
  v.literal('follow_up_resolution'),
  v.literal('exception_record'),
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
  reviewDueIntervalMonths: v.union(evidenceReviewDueIntervalValidator, v.null()),
  reviewOriginReviewRunId: v.union(v.id('reviewRuns'), v.null()),
  reviewOriginReviewTaskId: v.union(v.id('reviewTasks'), v.null()),
  reviewOriginReviewTaskResultId: v.union(v.id('reviewTaskResults'), v.null()),
  reviewOriginReviewAttestationId: v.union(v.id('reviewAttestations'), v.null()),
  reviewOriginSourceId: v.union(v.string(), v.null()),
  reviewOriginSourceLabel: v.union(v.string(), v.null()),
  reviewOriginSourceType: v.union(
    v.literal('security_control_evidence'),
    v.literal('evidence_report'),
    v.literal('security_finding'),
    v.literal('backup_verification_report'),
    v.literal('external_document'),
    v.literal('review_task'),
    v.literal('vendor'),
    v.null(),
  ),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByDisplay: v.union(v.string(), v.null()),
  sizeBytes: v.union(v.number(), v.null()),
  validUntil: v.union(v.number(), v.null()),
  source: v.union(evidenceSourceValidator, v.null()),
  storageId: v.union(v.string(), v.null()),
  sufficiency: evidenceSufficiencyValidator,
  title: v.string(),
  uploadedByDisplay: v.union(v.string(), v.null()),
  url: v.union(v.string(), v.null()),
});
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
const controlChecklistItemValidator = v.object({
  completedAt: v.union(v.number(), v.null()),
  description: v.string(),
  evidence: v.array(controlEvidenceValidator),
  hasExpiringSoonEvidence: v.boolean(),
  itemId: v.string(),
  label: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  owner: v.union(v.string(), v.null()),
  operatorNotes: v.union(v.string(), v.null()),
  required: v.boolean(),
  reviewArtifact: v.union(
    v.object({
      evidenceId: v.string(),
      evidenceType: evidenceTypeValidator,
      relatedReports: v.array(
        v.object({
          id: v.id('evidenceReports'),
          label: v.string(),
          reportKind: evidenceReportKindValidator,
        }),
      ),
      reviewRunId: v.id('reviewRuns'),
      reviewRunKind: reviewRunKindValidator,
      reviewRunStatus: reviewRunStatusValidator,
      reviewRunTitle: v.string(),
      reviewTaskId: v.id('reviewTasks'),
      reviewTaskTitle: v.string(),
      satisfiedAt: v.number(),
      satisfiedByDisplay: v.union(v.string(), v.null()),
      validUntil: v.union(v.number(), v.null()),
    }),
    v.null(),
  ),
  support: supportStatusValidator,
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
  support: supportStatusValidator,
  familyId: v.string(),
  familyTitle: v.string(),
  hasExpiringSoonEvidence: v.boolean(),
  implementationSummary: v.string(),
  internalControlId: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  linkedEntities: v.array(linkedEntitySummaryValidator),
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
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  responsibility: v.union(
    v.literal('platform'),
    v.literal('shared-responsibility'),
    v.literal('customer'),
    v.null(),
  ),
  title: v.string(),
});
const securityControlWorkspaceExportValidator = v.object({
  controlStatement: v.string(),
  customerResponsibilityNotes: v.union(v.string(), v.null()),
  support: supportStatusValidator,
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
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  responsibility: v.union(
    v.literal('platform'),
    v.literal('shared-responsibility'),
    v.literal('customer'),
    v.null(),
  ),
  title: v.string(),
});
const securityControlWorkspaceSummaryValidator = v.object({
  checklistStats: v.object({
    completeCount: v.number(),
    totalCount: v.number(),
  }),
  controlStatement: v.string(),
  customerResponsibilityNotes: v.union(v.string(), v.null()),
  support: supportStatusValidator,
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
  priority: v.union(v.literal('p0'), v.literal('p1'), v.literal('p2')),
  responsibility: v.union(
    v.literal('platform'),
    v.literal('shared-responsibility'),
    v.literal('customer'),
    v.null(),
  ),
  searchableText: v.string(),
  title: v.string(),
});
const securityControlWorkspaceSummaryListValidator = v.array(
  securityControlWorkspaceSummaryValidator,
);
const securityControlWorkspaceExportListValidator = v.array(
  securityControlWorkspaceExportValidator,
);
const releaseProvenanceEvidenceSummaryValidator = v.object({
  createdAt: v.number(),
  id: v.string(),
  lifecycleStatus: evidenceLifecycleStatusValidator,
  reviewedAt: v.union(v.number(), v.null()),
  sufficiency: evidenceSufficiencyValidator,
  title: v.string(),
});
const securityControlEvidenceActivityListValidator = v.array(
  securityControlEvidenceActivityEventValidator,
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
const reviewOutcomeModeValidator = v.union(reviewTaskTypeValidator, v.literal('exception'));
const reviewTaskEvidenceSourceTypeValidator = v.union(
  v.literal('security_control_evidence'),
  v.literal('evidence_report'),
  v.literal('security_finding'),
  v.literal('backup_verification_report'),
  v.literal('external_document'),
  v.literal('review_task'),
  v.literal('vendor'),
);
const reviewTaskEvidenceRoleValidator = v.union(
  v.literal('primary'),
  v.literal('supporting'),
  v.literal('blocking'),
);
const reviewTaskControlLinkValidator = v.object({
  controlTitle: v.union(v.string(), v.null()),
  internalControlId: v.string(),
  itemId: v.string(),
  itemLabel: v.union(v.string(), v.null()),
  nist80053Id: v.union(v.string(), v.null()),
});
const reviewTaskControlReferenceValidator = v.object({
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
  policy: v.union(
    v.object({
      id: v.string(),
      policyId: v.string(),
      sourcePath: v.string(),
      support: securityPolicySupportValidator,
      title: v.string(),
      type: v.literal('policy'),
    }),
    v.null(),
  ),
  policyControls: v.array(securityPolicyMappedControlValidator),
  vendor: v.union(
    v.object({
      reviewStatus: vendorReviewStatusValidator,
      title: v.string(),
      vendorKey: vendorKeyValidator,
    }),
    v.null(),
  ),
  findingsSummary: v.union(
    v.object({
      criticalOpenCount: v.number(),
      lowerSeverityOpenCount: v.number(),
      totalOpenCount: v.number(),
      undispositionedCount: v.number(),
    }),
    v.null(),
  ),
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
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
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
const reviewTaskLinkedSummaryValidator = v.object({
  controlLinks: v.array(reviewTaskControlLinkValidator),
  reviewRunId: v.id('reviewRuns'),
  reviewRunKind: reviewRunKindValidator,
  reviewRunStatus: reviewRunStatusValidator,
  reviewRunTitle: v.string(),
  taskId: v.id('reviewTasks'),
  taskStatus: reviewTaskStatusValidator,
  taskTitle: v.string(),
});
const evidenceReportDetailValidator = v.object({
  contentHash: v.string(),
  contentJson: v.string(),
  createdAt: v.number(),
  generatedByUserId: v.string(),
  id: v.id('evidenceReports'),
  latestExport: v.union(evidenceReportLatestExportDetailValidator, v.null()),
  linkedTasks: v.array(reviewTaskLinkedSummaryValidator),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  organizationId: v.union(v.string(), v.null()),
  reportKind: evidenceReportKindValidator,
  customerSummary: v.union(v.string(), v.null()),
  internalNotes: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByDisplay: v.union(v.string(), v.null()),
});
const reviewRunDetailValidator = v.object({
  createdAt: v.number(),
  finalReportId: v.union(v.id('evidenceReports'), v.null()),
  finalizedAt: v.union(v.number(), v.null()),
  id: v.id('reviewRuns'),
  kind: reviewRunKindValidator,
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
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
const auditReadinessHeadSummaryValidator = v.object({
  headHash: v.union(v.string(), v.null()),
  headSequence: v.number(),
  updatedAt: v.number(),
});
const auditReadinessCheckpointSummaryValidator = v.object({
  checkedAt: v.number(),
  endSequence: v.number(),
  headHash: v.union(v.string(), v.null()),
  startSequence: v.number(),
  status: v.union(v.literal('ok'), v.literal('failed')),
  verifiedEventCount: v.number(),
});
const auditReadinessVerifiedCheckpointSummaryValidator = v.object({
  checkedAt: v.number(),
  endSequence: v.number(),
  headHash: v.union(v.string(), v.null()),
  startSequence: v.number(),
  verifiedEventCount: v.number(),
});
const auditReadinessIntegrityFailureSummaryValidator = v.object({
  checkedAt: v.number(),
  eventId: v.string(),
  expectedSequence: v.number(),
});
const auditReadinessSnapshotValidator = v.object({
  currentHead: v.union(auditReadinessHeadSummaryValidator, v.null()),
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
      scopeId: securityScopeIdValidator,
      scopeType: securityScopeTypeValidator,
      sourceDataset: v.string(),
      status: v.union(v.literal('success'), v.literal('failure')),
      targetEnvironment: backupVerificationTargetEnvironmentValidator,
      verificationMethod: v.string(),
    }),
    v.null(),
  ),
  latestCheckpoint: v.union(auditReadinessCheckpointSummaryValidator, v.null()),
  latestRetentionJob: v.union(
    v.object({
      createdAt: v.number(),
      details: v.optional(v.string()),
      jobKind: v.union(
        v.literal('attachment_purge'),
        v.literal('quarantine_cleanup'),
        v.literal('temporary_artifact_purge'),
      ),
      processedCount: v.number(),
      scopeId: securityScopeIdValidator,
      scopeType: securityScopeTypeValidator,
      status: v.union(v.literal('success'), v.literal('failure')),
    }),
    v.null(),
  ),
  latestVerifiedCheckpoint: v.union(auditReadinessVerifiedCheckpointSummaryValidator, v.null()),
  latestImmutableExport: v.union(
    v.object({
      endSequence: v.number(),
      exportedAt: v.number(),
      headHash: v.union(v.string(), v.null()),
      objectKey: v.string(),
    }),
    v.null(),
  ),
  lastIntegrityFailure: v.union(auditReadinessIntegrityFailureSummaryValidator, v.null()),
  lastSealAt: v.union(v.number(), v.null()),
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
  immutableExportHealthy: v.boolean(),
  immutableExportLagCount: v.number(),
  sealCount: v.number(),
  unverifiedTailCount: v.number(),
});
const securityWorkspaceOverviewValidator = v.object({
  auditReadiness: auditReadinessSnapshotValidator,
  controlSummary: v.object({
    bySupport: v.object({
      missing: v.number(),
      partial: v.number(),
      complete: v.number(),
    }),
    byResponsibility: v.object({
      customer: v.number(),
      platform: v.number(),
      sharedResponsibility: v.number(),
    }),
    totalControls: v.number(),
  }),
  currentAnnualReviewRun: v.union(reviewRunSummaryValidator, v.null()),
  findingSummary: v.object({
    openCount: v.number(),
    totalCount: v.number(),
    undispositionedCount: v.number(),
  }),
  postureSummary: securityPostureSummaryValidator,
  queues: v.object({
    blockedReviewTasks: v.number(),
    missingSupportControls: v.number(),
    pendingVendorReviews: v.number(),
    undispositionedFindings: v.number(),
  }),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
  vendorSummary: v.object({
    approvedCount: v.number(),
    dueSoonCount: v.number(),
    overdueCount: v.number(),
    totalCount: v.number(),
  }),
});
const securityFindingsBoardValidator = v.object({
  findings: securityFindingListValidator,
  summary: v.object({
    openCount: v.number(),
    reviewPendingCount: v.number(),
    totalCount: v.number(),
  }),
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
});
const securityReportsBoardValidator = v.object({
  auditReadiness: auditReadinessSnapshotValidator,
  evidenceReports: evidenceReportListValidator,
  scopeId: securityScopeIdValidator,
  scopeType: securityScopeTypeValidator,
});
const securityWorkspaceMigrationResultValidator = v.object({
  patchedChecklistStatuses: v.number(),
  patchedReviewNotes: v.number(),
  patchedScopeRecords: v.number(),
  syncedVendorReviewRows: v.number(),
});

export {
  MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES,
  SECURITY_EVIDENCE_ALLOWED_EXTENSIONS,
  SECURITY_EVIDENCE_ALLOWED_MIME_TYPES,
  SECURITY_EVIDENCE_UPLOAD_RATE_LIMIT,
  SECURITY_METRICS_KEY,
  SECURITY_SCOPE_ID,
  SECURITY_SCOPE_TYPE,
  auditReadinessSnapshotValidator,
  backupVerificationDrillTypeValidator,
  backupVerificationInitiatedByKindValidator,
  backupVerificationTargetEnvironmentValidator,
  controlChecklistItemValidator,
  controlEvidenceValidator,
  enforceSecurityEvidenceUploadRateLimit,
  evidenceExpiryStatusValidator,
  evidenceLifecycleStatusValidator,
  evidenceReportDetailValidator,
  evidenceReportKindValidator,
  evidenceReportListItemValidator,
  evidenceReportListValidator,
  evidenceReportRecordValidator,
  evidenceReportValidator,
  evidenceReviewDueIntervalValidator,
  evidenceSourceValidator,
  evidenceSufficiencyValidator,
  evidenceTypeValidator,
  exportArtifactTypeValidator,
  getLowercaseFileExtension,
  linkedEntitySummaryValidator,
  releaseProvenanceEvidenceSummaryValidator,
  reviewAttestationValidator,
  reviewRunDetailValidator,
  reviewRunKindValidator,
  reviewRunStatusValidator,
  reviewRunSummaryListValidator,
  reviewRunSummaryValidator,
  reviewOutcomeModeValidator,
  reviewTaskControlLinkValidator,
  reviewTaskControlReferenceValidator,
  supportStatusValidator,
  reviewTaskEvidenceLinkValidator,
  reviewTaskEvidenceRoleValidator,
  reviewTaskEvidenceSourceTypeValidator,
  reviewTaskLinkedSummaryValidator,
  reviewTaskResultTypeValidator,
  reviewTaskStatusValidator,
  reviewTaskTypeValidator,
  reviewTaskValidator,
  securityPolicyDetailValidator,
  securityPolicySummaryListValidator,
  securityPolicySummaryValidator,
  securityControlEvidenceActivityEventValidator,
  securityControlEvidenceActivityListValidator,
  securityControlEvidenceAuditEventTypeValidator,
  securityControlWorkspaceSummaryListValidator,
  securityControlWorkspaceSummaryValidator,
  securityControlWorkspaceExportListValidator,
  securityControlWorkspaceExportValidator,
  securityControlWorkspaceValidator,
  securityFindingDispositionValidator,
  securityFindingListItemValidator,
  securityFindingListValidator,
  securityFindingSeverityValidator,
  securityFindingSourceTypeValidator,
  securityFindingStatusValidator,
  securityFindingTypeValidator,
  securityFindingsBoardValidator,
  securityPostureSummaryValidator,
  securityReportsBoardValidator,
  securityRelationshipObjectTypeValidator,
  securityRelationshipTypeValidator,
  securityScopeIdValidator,
  securityScopeTypeValidator,
  securityWorkspaceMigrationResultValidator,
  securityWorkspaceOverviewValidator,
  securityPolicySupportValidator,
  suggestedEvidenceTypeValidator,
  validateSecurityEvidenceUploadInput,
  vendorKeyValidator,
  vendorRelatedControlValidator,
  vendorReviewStatusValidator,
  vendorRuntimePostureValidator,
  vendorWorkspaceListValidator,
  vendorWorkspaceValidator,
};
