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
import type { Id } from './_generated/dataModel';
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
);
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

function stringifyStable(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function hashContent(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
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
      const derivedStatus = deriveChecklistItemStatus(evidence);
      const itemHasExpiringSoonEvidence = hasExpiringSoonEvidence(evidence);
      const completedAt =
        derivedStatus === 'done'
          ? evidence
              .filter(
                (entry) => entry.lifecycleStatus === 'active' && entry.reviewStatus === 'reviewed',
              )
              .reduce<number | null>((latest, entry) => {
                const candidate = entry.reviewedAt ?? entry.createdAt;
                return latest === null ? candidate : Math.max(latest, candidate);
              }, null)
          : null;
      const lastReviewedAtCandidates = [
        item.seed.evidence.length > 0 || derivedStatus !== 'not_started' ? seededReviewedAt : null,
        completedAt,
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
    reportKind?: 'security_posture' | 'audit_integrity' | 'audit_readiness';
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const reportKind = args.reportKind ?? 'security_posture';
  const summary = await ctx.runQuery(anyApi.security.getSecurityPostureSummary, {});
  const controlWorkspace = await ctx.runQuery(anyApi.security.listSecurityControlWorkspaces, {});
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
    ? await ctx.runQuery(anyApi.organizationManagement.getOrganizationPolicies, {
        organizationId: currentUser.activeOrganizationId,
      })
    : null;
  const vendorPosture = getVendorBoundarySnapshot();
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
              vendorPosture.some((vendor) => vendor.vendor === 'sentry' && vendor.approved) &&
              Boolean(process.env.VITE_SENTRY_DSN),
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

    const [checklistItems, evidenceRows, evidenceActivityRows, evidenceReports, exportArtifacts] =
      await Promise.all([
        ctx.db.query('securityControlChecklistItems').collect(),
        ctx.db.query('securityControlEvidence').collect(),
        ctx.db.query('securityControlEvidenceActivity').collect(),
        ctx.db.query('evidenceReports').collect(),
        ctx.db.query('exportArtifacts').collect(),
      ]);

    await Promise.all([
      ...checklistItems.map((row) => ctx.db.delete(row._id)),
      ...evidenceRows.map((row) => ctx.db.delete(row._id)),
      ...evidenceActivityRows.map((row) => ctx.db.delete(row._id)),
      ...evidenceReports.map((row) => ctx.db.delete(row._id)),
      ...exportArtifacts.map((row) => ctx.db.delete(row._id)),
    ]);

    return {
      activeSeedControlCount: ACTIVE_CONTROL_REGISTER.controls.length,
      deletedChecklistItems: checklistItems.length,
      deletedEvidence: evidenceRows.length,
      deletedEvidenceActivity: evidenceActivityRows.length,
      deletedEvidenceReports: evidenceReports.length,
      deletedExportArtifacts: exportArtifacts.length,
    };
  },
});
