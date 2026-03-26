import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import {
  EXPORT_ARTIFACT_SCHEMA_VERSION,
  RELEASE_PROVENANCE_CONTROL_ID,
  RELEASE_PROVENANCE_ITEM_ID,
  VENDOR_RELATED_CONTROL_LINKS_BY_VENDOR,
} from './securityReviewConfig';
import { SECURITY_SCOPE_ID, SECURITY_SCOPE_TYPE } from './validators';

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

function addMonths(timestamp: number, months: number) {
  const date = new Date(timestamp);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
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

function getSecurityScopeFields() {
  return {
    scopeId: SECURITY_SCOPE_ID,
    scopeType: SECURITY_SCOPE_TYPE,
  };
}

function normalizeSecurityScope<
  T extends {
    scopeId?: string | null;
    scopeType?: 'provider_global' | null;
  },
>(value: T) {
  return {
    ...value,
    scopeId: value.scopeId ?? SECURITY_SCOPE_ID,
    scopeType: value.scopeType ?? SECURITY_SCOPE_TYPE,
  };
}

type SecurityRelationshipObjectType =
  | 'control'
  | 'checklist_item'
  | 'evidence'
  | 'finding'
  | 'vendor'
  | 'review_run'
  | 'review_task'
  | 'evidence_report';

type SecurityRelationshipType =
  | 'has_evidence'
  | 'tracks_finding'
  | 'tracks_vendor'
  | 'has_review_task'
  | 'has_report'
  | 'supports'
  | 'satisfies'
  | 'follow_up_for'
  | 'related_control';

async function upsertSecurityRelationship(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    createdByUserId: string;
    fromId: string;
    fromType: SecurityRelationshipObjectType;
    relationshipType: SecurityRelationshipType;
    toId: string;
    toType: SecurityRelationshipObjectType;
  },
) {
  let existing: Array<Doc<'securityRelationships'>> = [];
  try {
    existing = await ctx.db
      .query('securityRelationships')
      .withIndex('by_from', (q) => q.eq('fromType', args.fromType).eq('fromId', args.fromId))
      .collect();
  } catch {
    return null;
  }

  const duplicate = existing.find(
    (entry) =>
      entry.toType === args.toType &&
      entry.toId === args.toId &&
      entry.relationshipType === args.relationshipType,
  );
  if (duplicate) {
    return duplicate._id;
  }

  try {
    return await ctx.db.insert('securityRelationships', {
      ...getSecurityScopeFields(),
      createdAt: Date.now(),
      createdByUserId: args.createdByUserId,
      fromId: args.fromId,
      fromType: args.fromType,
      relationshipType: args.relationshipType,
      toId: args.toId,
      toType: args.toType,
    });
  } catch {
    return null;
  }
}

function isMissingDocumentDeleteError(error: unknown) {
  return error instanceof Error && error.message.includes('Delete on nonexistent document ID');
}

export async function deleteSecurityRelationships(
  ctx: Pick<MutationCtx, 'db'>,
  args:
    | {
        fromId: string;
        fromType: SecurityRelationshipObjectType;
        relationshipType?: SecurityRelationshipType;
        toId?: string;
        toType?: SecurityRelationshipObjectType;
      }
    | {
        fromId?: string;
        fromType?: SecurityRelationshipObjectType;
        relationshipType?: SecurityRelationshipType;
        toId: string;
        toType: SecurityRelationshipObjectType;
      },
) {
  let candidates: Array<Doc<'securityRelationships'>> = [];
  const fromId = 'fromId' in args ? args.fromId : undefined;
  const fromType = 'fromType' in args ? args.fromType : undefined;
  const toId = 'toId' in args ? args.toId : undefined;
  const toType = 'toType' in args ? args.toType : undefined;

  if (fromId && fromType) {
    try {
      candidates = await ctx.db
        .query('securityRelationships')
        .withIndex('by_from', (q) => q.eq('fromType', fromType).eq('fromId', fromId))
        .collect();
    } catch {
      return 0;
    }
  } else if (toId && toType) {
    try {
      candidates = await ctx.db
        .query('securityRelationships')
        .withIndex('by_to', (q) => q.eq('toType', toType).eq('toId', toId))
        .collect();
    } catch {
      return 0;
    }
  } else {
    return 0;
  }

  const matches = candidates.filter((relationship) => {
    if (fromId && relationship.fromId !== fromId) {
      return false;
    }
    if (fromType && relationship.fromType !== fromType) {
      return false;
    }
    if (toId && relationship.toId !== toId) {
      return false;
    }
    if (toType && relationship.toType !== toType) {
      return false;
    }
    if (args.relationshipType && relationship.relationshipType !== args.relationshipType) {
      return false;
    }
    return true;
  });

  const deletedCounts = await Promise.all(
    matches.map(async (relationship) => {
      try {
        await ctx.db.delete(relationship._id);
        return 1;
      } catch (error) {
        if (isMissingDocumentDeleteError(error)) {
          return 0;
        }
        throw error;
      }
    }),
  );
  return deletedCounts.reduce<number>((total, count) => total + count, 0);
}

async function patchSecurityScopeDefaults(
  ctx: Pick<MutationCtx, 'db'>,
  tableName:
    | 'securityFindings'
    | 'evidenceReports'
    | 'exportArtifacts'
    | 'securityControlChecklistItems'
    | 'securityControlEvidence'
    | 'securityControlEvidenceActivity'
    | 'reviewRuns'
    | 'reviewTasks'
    | 'reviewTaskResults'
    | 'reviewAttestations'
    | 'reviewTaskEvidenceLinks'
    | 'securityVendors'
    | 'securityVendorControlMappings'
    | 'retentionJobs'
    | 'backupVerificationReports'
    | 'securityRelationships',
) {
  const docs = await ctx.db.query(tableName).collect();
  let patched = 0;
  for (const doc of docs) {
    const normalized = normalizeSecurityScope(doc);
    if (doc.scopeId !== normalized.scopeId || doc.scopeType !== normalized.scopeType) {
      await ctx.db.patch(doc._id, getSecurityScopeFields());
      patched += 1;
    }
  }
  return patched;
}

function resolveControlLinkMetadata(link: { internalControlId: string; itemId: string }): {
  controlTitle: string | null;
  itemLabel: string | null;
  nist80053Id: string | null;
} {
  const control = ACTIVE_CONTROL_REGISTER.controls.find(
    (entry) => entry.internalControlId === link.internalControlId,
  );
  const item = control?.platformChecklistItems.find((entry) => entry.itemId === link.itemId);

  return {
    controlTitle: control?.title ?? null,
    itemLabel: item?.label ?? null,
    nist80053Id: control?.nist80053Id ?? null,
  };
}

function getVendorRelatedControlLinks(vendorKey: 'openrouter' | 'resend' | 'sentry') {
  return VENDOR_RELATED_CONTROL_LINKS_BY_VENDOR[vendorKey];
}

function buildVendorRelatedControls(vendorKey: 'openrouter' | 'resend' | 'sentry') {
  return getVendorRelatedControlLinks(vendorKey).map((link) => {
    const metadata = resolveControlLinkMetadata(link);
    return {
      ...link,
      itemLabel: metadata.itemLabel,
      nist80053Id: metadata.nist80053Id ?? '',
      title: metadata.controlTitle ?? link.internalControlId,
    };
  });
}

function getSecurityRelationshipObjectTypeFromSourceRecordType(
  sourceRecordType: string | null | undefined,
): SecurityRelationshipObjectType | null {
  switch (sourceRecordType) {
    case 'evidence_report':
      return 'evidence_report';
    case 'security_finding':
      return 'finding';
    case 'review_task':
      return 'review_task';
    case 'vendor':
      return 'vendor';
    default:
      return null;
  }
}

function getSecurityRelationshipObjectTypeFromEvidenceSourceType(
  sourceType:
    | 'security_control_evidence'
    | 'evidence_report'
    | 'security_finding'
    | 'backup_verification_report'
    | 'external_document'
    | 'review_task'
    | 'vendor',
): SecurityRelationshipObjectType | null {
  switch (sourceType) {
    case 'security_control_evidence':
      return 'evidence';
    case 'evidence_report':
      return 'evidence_report';
    case 'security_finding':
      return 'finding';
    case 'review_task':
      return 'review_task';
    case 'vendor':
      return 'vendor';
    default:
      return null;
  }
}

function getSecurityFindingControlLinks(
  findingType:
    | 'audit_integrity_failures'
    | 'audit_request_context_gaps'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation',
) {
  switch (findingType) {
    case 'release_security_validation':
      return [
        {
          internalControlId: RELEASE_PROVENANCE_CONTROL_ID,
          itemId: RELEASE_PROVENANCE_ITEM_ID,
        },
      ];
    case 'audit_integrity_failures':
    case 'audit_request_context_gaps':
      return [
        { internalControlId: 'CTRL-AU-012', itemId: 'workflow-audit-emission' },
        {
          internalControlId: 'CTRL-AU-006',
          itemId: 'provider-review-procedure',
        },
      ];
    case 'document_scan_quarantines':
    case 'document_scan_rejections':
      return [
        {
          internalControlId: 'CTRL-RA-005',
          itemId: 'security-findings-can-be-reviewed-and-prioritized',
        },
        {
          internalControlId: 'CTRL-CA-005',
          itemId: 'follow-up-findings-can-be-surfaced',
        },
      ];
  }
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
  failure?: unknown | null;
  ok?: boolean;
}) {
  return {
    checkedAt: typeof integrityCheck.checkedAt === 'number' ? integrityCheck.checkedAt : null,
    failureCount: integrityCheck.failure ? 1 : 0,
    verified: integrityCheck.ok === true,
  };
}

export type EvidenceReportLatestExportIntegritySummary = {
  checkedAt: string | null;
  failureCount: number;
  verified: boolean;
};

export type EvidenceReportLatestExport = {
  exportHash: string;
  exportedAt: number;
  exportedByUserId: string;
  id: Id<'exportArtifacts'>;
  integritySummary: EvidenceReportLatestExportIntegritySummary | null;
  manifestHash: string;
  manifestJson: string;
  schemaVersion: string;
};

function parseEvidenceReportExportIntegritySummary(
  manifestJson: string,
): EvidenceReportLatestExportIntegritySummary | null {
  try {
    const parsed = JSON.parse(manifestJson) as {
      integritySummary?: {
        checkedAt?: string | null;
        failureCount?: number;
        verified?: boolean;
      };
    };
    const integritySummary = parsed.integritySummary;
    if (!integritySummary || typeof integritySummary !== 'object') {
      return null;
    }

    return {
      checkedAt:
        integritySummary.checkedAt === null || typeof integritySummary.checkedAt === 'string'
          ? integritySummary.checkedAt
          : null,
      failureCount:
        typeof integritySummary.failureCount === 'number' ? integritySummary.failureCount : 0,
      verified: integritySummary.verified === true,
    };
  } catch {
    return null;
  }
}

export function mapExportArtifactToEvidenceReportLatestExport(
  artifact: Pick<
    Doc<'exportArtifacts'>,
    | '_id'
    | 'exportedAt'
    | 'exportedByUserId'
    | 'manifestHash'
    | 'manifestJson'
    | 'payloadHash'
    | 'schemaVersion'
  >,
): EvidenceReportLatestExport {
  return {
    exportHash: artifact.payloadHash,
    exportedAt: artifact.exportedAt,
    exportedByUserId: artifact.exportedByUserId,
    id: artifact._id,
    integritySummary: parseEvidenceReportExportIntegritySummary(artifact.manifestJson),
    manifestHash: artifact.manifestHash,
    manifestJson: artifact.manifestJson,
    schemaVersion: artifact.schemaVersion,
  };
}

export async function getLatestEvidenceReportExportForReport(
  ctx: Pick<QueryCtx, 'db'>,
  reportId: Id<'evidenceReports'>,
): Promise<EvidenceReportLatestExport | null> {
  const artifacts = await ctx.db
    .query('exportArtifacts')
    .withIndex('by_source_report_id_and_created_at', (q) => q.eq('sourceReportId', reportId))
    .order('desc')
    .take(10);
  const latestArtifact = artifacts.find(
    (artifact) => artifact.artifactType === 'evidence_report_export',
  );
  return latestArtifact ? mapExportArtifactToEvidenceReportLatestExport(latestArtifact) : null;
}

export async function getLatestEvidenceReportExportsByReportId(
  ctx: Pick<QueryCtx, 'db'>,
  reportIds: Id<'evidenceReports'>[],
): Promise<Map<Id<'evidenceReports'>, EvidenceReportLatestExport>> {
  const uniqueReportIds = Array.from(new Set(reportIds));
  const latestExports = await Promise.all(
    uniqueReportIds.map(
      async (reportId) =>
        [reportId, await getLatestEvidenceReportExportForReport(ctx, reportId)] as const,
    ),
  );

  return new Map(
    latestExports.filter(
      (entry): entry is [Id<'evidenceReports'>, EvidenceReportLatestExport] => entry[1] !== null,
    ),
  );
}

export {
  addMonths,
  addDays,
  buildVendorRelatedControls,
  getAnnualReviewRunKey,
  getAnnualReviewRunTitle,
  getCurrentAnnualReviewYear,
  getSecurityFindingControlLinks,
  getSecurityRelationshipObjectTypeFromEvidenceSourceType,
  getSecurityRelationshipObjectTypeFromSourceRecordType,
  getSecurityScopeFields,
  getVendorRelatedControlLinks,
  hashContent,
  isMissingDocumentDeleteError,
  normalizeSecurityScope,
  patchSecurityScopeDefaults,
  resolveControlLinkMetadata,
  stringifyStable,
  upsertSecurityRelationship,
};
export type { ExportManifest, SecurityRelationshipObjectType, SecurityRelationshipType };
