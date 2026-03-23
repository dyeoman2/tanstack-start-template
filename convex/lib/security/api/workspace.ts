import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../../../_generated/server';
import type { MutationCtx, QueryCtx } from '../../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../../src/lib/shared/compliance/control-register';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
} from '../../../auth/access';
import { createUploadTargetWithMode } from '../../../storagePlatform';
import {
  getSecurityControlWorkspaceRecord,
  listSecurityControlWorkspaceExportRecords,
  listSecurityControlWorkspaceSummaryRecords,
} from './control_workspace_core';
import {
  getAnnualReviewRunKey,
  getCurrentAnnualReviewYear,
  getSecurityFindingControlLinks,
  getSecurityScopeFields,
  normalizeSecurityScope,
  upsertSecurityRelationship,
} from './core';
import {
  buildCurrentSecurityFindings,
  getActorDisplayName,
  getLatestReleaseProvenanceEvidence,
  getSeededEvidenceEntry,
  recordSecurityControlEvidenceAuditEvent,
  syncCurrentSecurityFindings,
} from './operations_core';
import { getAuditReadinessSnapshotHandler } from './posture';
import {
  buildReviewRunDetail,
  buildReviewRunSummary,
  buildVendorWorkspaceRows,
  createTriggeredReviewRunRecord,
  runSecurityWorkspaceMigration,
} from './review_runs_core';
import {
  SECURITY_SCOPE_ID,
  SECURITY_SCOPE_TYPE,
  enforceSecurityEvidenceUploadRateLimit,
  evidenceReviewDueIntervalValidator,
  evidenceSourceValidator,
  evidenceSufficiencyValidator,
  releaseProvenanceEvidenceSummaryValidator,
  reviewRunSummaryValidator,
  securityControlEvidenceActivityListValidator,
  securityControlWorkspaceExportListValidator,
  securityControlWorkspaceSummaryListValidator,
  securityControlWorkspaceValidator,
  securityFindingDispositionValidator,
  securityFindingListItemValidator,
  securityFindingListValidator,
  securityOperationsBoardValidator,
  securityWorkspaceMigrationResultValidator,
  validateSecurityEvidenceUploadInput,
} from './validators';
import { v } from 'convex/values';

const securityFindingRelatedControlMetadataById = new Map(
  ACTIVE_CONTROL_REGISTER.controls.map((control) => [control.internalControlId, control] as const),
);

function getSecurityFindingRelatedControls(
  findingType:
    | 'audit_integrity_failures'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation',
) {
  return getSecurityFindingControlLinks(findingType).map((controlLink) => {
    const control = securityFindingRelatedControlMetadataById.get(controlLink.internalControlId);
    return {
      internalControlId: controlLink.internalControlId,
      itemId: controlLink.itemId,
      itemLabel:
        control?.platformChecklistItems.find((item) => item.itemId === controlLink.itemId)?.label ??
        null,
      nist80053Id: control?.nist80053Id ?? controlLink.internalControlId,
      title: control?.title ?? controlLink.internalControlId,
    };
  });
}

export const getSecurityOperationsBoard = query({
  args: {},
  returns: securityOperationsBoardValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const [
      auditReadiness,
      evidenceReports,
      findings,
      vendorWorkspaces,
      currentAnnualReviewRun,
      triggeredReviewRuns,
    ] = await Promise.all([
      getAuditReadinessSnapshotHandler(ctx),
      (async () => {
        const reports = await ctx.db
          .query('evidenceReports')
          .withIndex('by_created_at')
          .order('desc')
          .take(10);
        return reports.map((report) => ({
          id: report._id,
          createdAt: report.createdAt,
          generatedByUserId: report.generatedByUserId,
          customerSummary: report.customerSummary ?? null,
          internalNotes: report.internalReviewNotes ?? null,
          scopeId: normalizeSecurityScope(report).scopeId,
          scopeType: normalizeSecurityScope(report).scopeType,
          reportKind: report.reportKind,
          contentHash: report.contentHash,
          exportHash: report.exportHash ?? null,
          exportManifestHash: report.exportManifestHash ?? null,
          exportedAt: report.exportedAt ?? null,
          exportedByUserId: report.exportedByUserId ?? null,
          reviewStatus: report.reviewStatus,
          reviewedAt: report.reviewedAt ?? null,
          reviewedByUserId: report.reviewedByUserId ?? null,
        }));
      })(),
      listSecurityFindingsHandler(ctx),
      buildVendorWorkspaceRows(ctx),
      (async () => {
        const existing = await ctx.db
          .query('reviewRuns')
          .withIndex('by_run_key', (q) =>
            q.eq('runKey', getAnnualReviewRunKey(getCurrentAnnualReviewYear())),
          )
          .unique();
        return existing ? await buildReviewRunSummary(ctx, existing) : null;
      })(),
      (async () => {
        const runs = await ctx.db
          .query('reviewRuns')
          .withIndex('by_kind_and_created_at', (q) => q.eq('kind', 'triggered'))
          .order('desc')
          .collect();
        return await Promise.all(runs.map(async (run) => await buildReviewRunSummary(ctx, run)));
      })(),
    ]);
    const currentAnnualReviewDetail = currentAnnualReviewRun
      ? await buildReviewRunDetail(ctx, currentAnnualReviewRun.id)
      : null;

    return {
      auditReadiness,
      currentAnnualReviewDetail,
      currentAnnualReviewRun,
      evidenceReports,
      findings,
      scopeId: SECURITY_SCOPE_ID,
      scopeType: SECURITY_SCOPE_TYPE,
      triggeredReviewRuns,
      vendorWorkspaces,
    };
  },
});

export const migrateSecurityWorkspaceGraph = mutation({
  args: {},
  returns: securityWorkspaceMigrationResultValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await runSecurityWorkspaceMigration(ctx, currentUser.authUserId);
  },
});

export const listSecurityControlWorkspaces = query({
  args: {},
  returns: securityControlWorkspaceSummaryListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityControlWorkspaceSummaryRecords(ctx);
  },
});

export const getSecurityControlWorkspaceDetail = query({
  args: {
    internalControlId: v.string(),
  },
  returns: v.union(securityControlWorkspaceValidator, v.null()),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await getSecurityControlWorkspaceRecord(ctx, args.internalControlId, {
      authUserId: currentUser.authUserId,
    });
  },
});

export const listSecurityControlWorkspaceExports = query({
  args: {
    controlIds: v.optional(v.array(v.string())),
  },
  returns: securityControlWorkspaceExportListValidator,
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityControlWorkspaceExportRecords(ctx, {
      controlIds: args.controlIds,
    });
  },
});

export const listSecurityControlWorkspaceExportsInternal = internalQuery({
  args: {},
  returns: securityControlWorkspaceExportListValidator,
  handler: async (ctx) => {
    return await listSecurityControlWorkspaceExportRecords(ctx);
  },
});

export const listSecurityControlWorkspaceDetailsInternal = internalQuery({
  args: {},
  returns: securityControlWorkspaceExportListValidator,
  handler: async (ctx) => {
    return await listSecurityControlWorkspaceExportRecords(ctx);
  },
});

export const getLatestReleaseProvenanceEvidenceInternal = internalQuery({
  args: {},
  returns: v.union(releaseProvenanceEvidenceSummaryValidator, v.null()),
  handler: async (ctx) => {
    const latestEvidence = await getLatestReleaseProvenanceEvidence(ctx);
    if (!latestEvidence) {
      return null;
    }

    return {
      createdAt: latestEvidence.createdAt,
      id: latestEvidence._id,
      lifecycleStatus: latestEvidence.lifecycleStatus ?? 'active',
      reviewedAt: latestEvidence.reviewedAt ?? null,
      sufficiency: latestEvidence.sufficiency,
      title: latestEvidence.title,
    };
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
      customerSummary: record?.customerSummary ?? null,
      description: finding.description,
      disposition: record?.disposition ?? ('pending_review' as const),
      findingKey: finding.findingKey,
      findingType: finding.findingType,
      firstObservedAt: record
        ? Math.min(record.firstObservedAt, finding.firstObservedAt)
        : finding.firstObservedAt,
      internalNotes: record?.internalReviewNotes ?? null,
      lastObservedAt: Math.max(
        record?.lastObservedAt ?? finding.lastObservedAt,
        finding.lastObservedAt,
      ),
      relatedControls: getSecurityFindingRelatedControls(finding.findingType),
      scopeId: normalizeSecurityScope(record ?? {}).scopeId,
      scopeType: normalizeSecurityScope(record ?? {}).scopeType,
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

export const syncCurrentSecurityFindingsInternal = internalMutation({
  args: {
    actorUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await syncCurrentSecurityFindings(ctx, args.actorUserId);
    return null;
  },
});

export const listSecurityFindings = query({
  args: {},
  returns: securityFindingListValidator,
  handler: listSecurityFindingsHandler,
});

export async function reviewSecurityFindingHandler(
  ctx: MutationCtx,
  args: {
    customerSummary?: string;
    disposition:
      | 'accepted_risk'
      | 'false_positive'
      | 'investigating'
      | 'pending_review'
      | 'resolved';
    findingKey: string;
    internalNotes?: string;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  await syncCurrentSecurityFindings(ctx, currentUser.authUserId);
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
  let findingRecordId = existing?._id ?? null;
  const internalNotes = args.internalNotes?.trim() || null;

  if (existing) {
    await ctx.db.patch(existing._id, {
      customerSummary: args.customerSummary?.trim() || null,
      description: finding.description,
      disposition: args.disposition,
      findingType: finding.findingType,
      firstObservedAt: Math.min(existing.firstObservedAt, finding.firstObservedAt),
      internalReviewNotes: internalNotes,
      lastObservedAt: Math.max(existing.lastObservedAt, finding.lastObservedAt),
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
    findingRecordId = await ctx.db.insert('securityFindings', {
      ...getSecurityScopeFields(),
      description: finding.description,
      disposition: args.disposition,
      findingKey: finding.findingKey,
      findingType: finding.findingType,
      firstObservedAt: finding.firstObservedAt,
      lastObservedAt: finding.lastObservedAt,
      internalReviewNotes: internalNotes,
      reviewedAt: now,
      reviewedByUserId: currentUser.authUserId,
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
      customerSummary: args.customerSummary?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
  }
  findingRecordId ??= existing?._id ?? null;
  if (findingRecordId) {
    for (const controlLink of getSecurityFindingControlLinks(finding.findingType)) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: currentUser.authUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_finding',
        toId: finding.findingKey,
        toType: 'finding',
      });
    }
  }

  const reviewerProfile = await ctx.db
    .query('userProfiles')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', currentUser.authUserId))
    .first();

  return {
    customerSummary: args.customerSummary?.trim() || null,
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
    internalNotes,
    relatedControls: getSecurityFindingRelatedControls(finding.findingType),
    scopeId: normalizeSecurityScope(existing ?? {}).scopeId,
    scopeType: normalizeSecurityScope(existing ?? {}).scopeType,
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
    customerSummary: v.optional(v.string()),
    disposition: securityFindingDispositionValidator,
    findingKey: v.string(),
    internalNotes: v.optional(v.string()),
  },
  returns: securityFindingListItemValidator,
  handler: reviewSecurityFindingHandler,
});

export const openSecurityFindingFollowUp = mutation({
  args: {
    findingKey: v.string(),
    note: v.optional(v.string()),
  },
  returns: reviewRunSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    await syncCurrentSecurityFindings(ctx, currentUser.authUserId);
    const finding = (await buildCurrentSecurityFindings(ctx)).find(
      (entry) => entry.findingKey === args.findingKey,
    );
    if (!finding) {
      throw new Error('Security finding not found.');
    }

    const runId = await createTriggeredReviewRunRecord(ctx, {
      actorUserId: currentUser.authUserId,
      controlLinks: getSecurityFindingControlLinks(finding.findingType),
      dedupeKey: `security-finding:${finding.findingKey}`,
      sourceLink: {
        freshAt: finding.lastObservedAt,
        sourceId: finding.findingKey,
        sourceLabel: finding.title,
        sourceType: 'security_finding',
      },
      sourceRecordId: finding.findingKey,
      sourceRecordType: 'security_finding',
      title: `${finding.title} follow-up`,
      triggerType: 'security_finding_follow_up',
    });
    const run = await ctx.db.get(runId);
    if (!run) {
      throw new Error('Security finding follow-up run not found after create.');
    }

    return await buildReviewRunSummary(ctx as unknown as QueryCtx, run);
  },
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
      ...getSecurityScopeFields(),
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
      ...getSecurityScopeFields(),
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
      ...getSecurityScopeFields(),
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
        ...getSecurityScopeFields(),
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
      ...getSecurityScopeFields(),
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
        ...getSecurityScopeFields(),
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
    ...getSecurityScopeFields(),
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
      ...getSecurityScopeFields(),
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
