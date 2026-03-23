import { internalMutation } from '../../../_generated/server';
import type { MutationCtx, QueryCtx } from '../../../_generated/server';
import { getVendorBoundarySnapshot } from '../../../../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../../../../src/lib/shared/compliance/control-register';
import { RELEASE_PROVENANCE_CONTROL_ID, RELEASE_PROVENANCE_ITEM_ID } from '../securityReviewConfig';
import {
  addControlToSecurityWorkspaceSummary,
  createEmptySecurityWorkspaceControlSummary,
} from '../securityWorkspaceOverview';
import {
  getAnnualReviewRunKey,
  getCurrentAnnualReviewYear,
  getSecurityFindingControlLinks,
  getSecurityScopeFields,
  hasActiveReviewSatisfaction,
  stringifyStable,
  upsertSecurityRelationship,
} from './core';
import {
  SECURITY_METRICS_KEY,
  backupVerificationDrillTypeValidator,
  backupVerificationInitiatedByKindValidator,
  backupVerificationTargetEnvironmentValidator,
} from './validators';
import { anyApi } from 'convex/server';
import { v } from 'convex/values';

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

async function buildActorDisplayMap(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  actorIds: string[],
) {
  const uniqueIds = Array.from(
    new Set(actorIds.filter((value) => typeof value === 'string' && value.length > 0)),
  );
  const profiles = await Promise.all(
    uniqueIds.map(async (authUserId) => {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
      return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
    }),
  );
  return new Map(profiles);
}

async function listReviewTaskEvidenceLinksBySource(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  args: {
    sourceId: string;
    sourceType:
      | 'security_control_evidence'
      | 'evidence_report'
      | 'security_finding'
      | 'backup_verification_report'
      | 'external_document'
      | 'review_task'
      | 'vendor_review';
  },
) {
  return await ctx.db
    .query('reviewTaskEvidenceLinks')
    .withIndex('by_source_type_and_source_id', (q) =>
      q.eq('sourceType', args.sourceType).eq('sourceId', args.sourceId),
    )
    .collect();
}

async function getLatestReleaseProvenanceEvidence(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
) {
  const evidenceRows = await ctx.db
    .query('securityControlEvidence')
    .withIndex('by_internal_control_id_and_item_id', (q) =>
      q
        .eq('internalControlId', RELEASE_PROVENANCE_CONTROL_ID)
        .eq('itemId', RELEASE_PROVENANCE_ITEM_ID),
    )
    .collect();

  return (
    [...evidenceRows]
      .filter((entry) => (entry.lifecycleStatus ?? 'active') === 'active')
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
  );
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

  if (!args.evidenceId.includes(':seed:')) {
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.actorUserId,
      fromId: args.internalControlId,
      fromType: 'control',
      relationshipType: 'has_evidence',
      toId: args.evidenceId,
      toType: 'evidence',
    });
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.actorUserId,
      fromId: `${args.internalControlId}:${args.itemId}`,
      fromType: 'checklist_item',
      relationshipType: 'has_evidence',
      toId: args.evidenceId,
      toType: 'evidence',
    });
  }

  await syncCurrentSecurityFindings(ctx, args.actorUserId);
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

async function _getSecurityMetricsSnapshot(ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>) {
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

async function buildCurrentSecurityFindings(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
): Promise<SecurityFindingSnapshot[]> {
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

async function getCurrentAnnualReviewRunRecord(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
) {
  return await ctx.db
    .query('reviewRuns')
    .withIndex('by_run_key', (q) =>
      q.eq('runKey', getAnnualReviewRunKey(getCurrentAnnualReviewYear())),
    )
    .unique();
}

async function buildSecurityWorkspaceFindingSummary(ctx: QueryCtx) {
  const [currentFindings, storedFindings] = await Promise.all([
    buildCurrentSecurityFindings(ctx),
    ctx.db.query('securityFindings').collect(),
  ]);
  const storedFindingByKey = new Map(
    storedFindings.map((finding) => [finding.findingKey, finding] as const),
  );

  return currentFindings.reduce(
    (summary, finding) => {
      summary.totalCount += 1;
      if (finding.status === 'open') {
        summary.openCount += 1;
      }
      const stored = storedFindingByKey.get(finding.findingKey);
      if ((stored?.disposition ?? 'pending_review') !== 'resolved') {
        summary.undispositionedCount += 1;
      }
      return summary;
    },
    {
      openCount: 0,
      totalCount: 0,
      undispositionedCount: 0,
    },
  );
}

async function buildSecurityWorkspaceVendorSummary(ctx: QueryCtx) {
  const [runtimePosture, reviewRows] = await Promise.all([
    Promise.resolve(getVendorBoundarySnapshot()),
    ctx.db.query('securityVendorReviews').collect(),
  ]);
  const reviewByVendorKey = new Map(reviewRows.map((row) => [row.vendorKey, row] as const));

  return runtimePosture.reduce(
    (summary, vendor) => {
      summary.totalCount += 1;
      if (vendor.approved) {
        summary.approvedCount += 1;
      }
      const reviewStatus = reviewByVendorKey.get(vendor.vendor)?.reviewStatus ?? 'pending';
      if (reviewStatus === 'needs_follow_up') {
        summary.needsFollowUpCount += 1;
      }
      if (reviewStatus === 'pending' || reviewStatus === 'needs_follow_up') {
        summary.pendingVendorReviews += 1;
      }
      return summary;
    },
    {
      approvedCount: 0,
      needsFollowUpCount: 0,
      pendingVendorReviews: 0,
      totalCount: 0,
    },
  );
}

async function buildSecurityWorkspaceControlSummary(ctx: QueryCtx) {
  const [checklistItems, evidenceRows] = await Promise.all([
    ctx.db.query('securityControlChecklistItems').collect(),
    ctx.db.query('securityControlEvidence').collect(),
  ]);
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
  const reviewSatisfactionEntries = checklistItems
    .map((item) => item.reviewSatisfaction ?? null)
    .filter(
      (entry): entry is NonNullable<(typeof checklistItems)[number]['reviewSatisfaction']> =>
        entry !== null,
    );
  const reviewTaskIds = Array.from(
    new Set(reviewSatisfactionEntries.map((entry) => entry.reviewTaskId)),
  );
  const reviewTasks = await Promise.all(
    reviewTaskIds.map(async (reviewTaskId) => await ctx.db.get(reviewTaskId)),
  );
  const reviewTaskById = new Map(
    reviewTasks
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const reviewRunIds = Array.from(
    new Set(reviewSatisfactionEntries.map((entry) => entry.reviewRunId)),
  );
  const reviewRuns = await Promise.all(
    reviewRunIds.map(async (reviewRunId) => await ctx.db.get(reviewRunId)),
  );
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );

  const controlSummary = ACTIVE_CONTROL_REGISTER.controls.reduce((summary, control) => {
    const platformChecklist = control.platformChecklistItems.map((item) => {
      const itemState = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
      const reviewSatisfaction =
        itemState?.reviewSatisfaction &&
        hasActiveReviewSatisfaction(
          itemState.reviewSatisfaction,
          reviewTaskById.get(itemState.reviewSatisfaction.reviewTaskId),
          reviewRunById.get(itemState.reviewSatisfaction.reviewRunId),
        );
      const evidence = (evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []).map(
        (entry) => ({
          lifecycleStatus: entry.lifecycleStatus ?? ('active' as const),
          reviewStatus:
            entry.reviewStatus ?? (entry.reviewedAt ? ('reviewed' as const) : ('pending' as const)),
        }),
      );
      const evidenceDerivedStatus = deriveChecklistItemStatus(evidence);
      const manualStatus = itemState?.manualStatus ?? itemState?.status ?? null;
      const status =
        manualStatus ??
        (evidenceDerivedStatus === 'done' || reviewSatisfaction
          ? ('done' as const)
          : evidenceDerivedStatus);

      return {
        evidence,
        status,
      };
    });

    const evidenceReadiness = deriveEvidenceReadiness(platformChecklist);
    addControlToSecurityWorkspaceSummary(summary, {
      evidenceReadiness,
      responsibility: control.responsibility,
    });
    return summary;
  }, createEmptySecurityWorkspaceControlSummary());

  return {
    controlSummary,
    missingEvidenceControls: controlSummary.byEvidence.missing,
  };
}

async function syncCurrentSecurityFindings(ctx: MutationCtx, actorUserId: string) {
  const findings = await buildCurrentSecurityFindings(ctx);
  const storedFindingEntries = await Promise.all(
    findings.map(async (finding) => {
      const record = await ctx.db
        .query('securityFindings')
        .withIndex('by_finding_key', (q) => q.eq('findingKey', finding.findingKey))
        .unique();
      return [finding.findingKey, record] as const;
    }),
  );
  const storedFindingByKey = new Map(storedFindingEntries);
  const now = Date.now();

  await Promise.all(
    findings.map(async (finding) => {
      const existing = storedFindingByKey.get(finding.findingKey) ?? null;
      const patch = {
        ...getSecurityScopeFields(),
        customerSummary: existing?.customerSummary ?? null,
        description: finding.description,
        disposition: existing?.disposition ?? ('pending_review' as const),
        findingKey: finding.findingKey,
        findingType: finding.findingType,
        firstObservedAt: existing
          ? Math.min(existing.firstObservedAt, finding.firstObservedAt)
          : finding.firstObservedAt,
        internalReviewNotes: existing?.internalReviewNotes ?? existing?.reviewNotes ?? null,
        lastObservedAt: existing
          ? Math.max(existing.lastObservedAt, finding.lastObservedAt)
          : finding.lastObservedAt,
        reviewNotes: undefined,
        reviewedAt: existing?.reviewedAt ?? null,
        reviewedByUserId: existing?.reviewedByUserId ?? null,
        severity: finding.severity,
        sourceLabel: finding.sourceLabel,
        sourceRecordId: finding.sourceRecordId,
        sourceType: finding.sourceType,
        status: finding.status,
        title: finding.title,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert('securityFindings', {
          ...patch,
          createdAt: now,
        });
      }

      for (const controlLink of getSecurityFindingControlLinks(finding.findingType)) {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: actorUserId,
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'tracks_finding',
          toId: finding.findingKey,
          toType: 'finding',
        });
      }
    }),
  );

  return findings;
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
    await syncCurrentSecurityFindings(ctx, 'system:document-scan');
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
      ...getSecurityScopeFields(),
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
    ...getSecurityScopeFields(),
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

export {
  _getSecurityMetricsSnapshot,
  addMonths,
  buildActorDisplayMap,
  buildCurrentSecurityFindings,
  buildSecurityWorkspaceControlSummary,
  buildSecurityWorkspaceFindingSummary,
  buildSecurityWorkspaceVendorSummary,
  compareSecurityFindingSeverity,
  countQueryResults,
  deriveChecklistItemStatus,
  deriveEvidenceExpiryStatus,
  deriveEvidenceReadiness,
  deriveItemEvidenceSufficiency,
  documentScanEventArgs,
  getActorDisplayName,
  getCurrentAnnualReviewRunRecord,
  getLatestReleaseProvenanceEvidence,
  getSeededEvidenceEntry,
  hasExpiringSoonEvidence,
  listReviewTaskEvidenceLinksBySource,
  recordSecurityControlEvidenceAuditEvent,
  resolveSeedSiteAdminActor,
  syncCurrentSecurityFindings,
  updateSecurityMetrics,
  upsertSecurityControlEvidenceActivity,
};
export type { SecurityFindingSnapshot };
