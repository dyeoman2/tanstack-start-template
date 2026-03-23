import { internalMutation, internalQuery, query } from '../../../_generated/server';
import type { QueryCtx } from '../../../_generated/server';
import { getRetentionPolicyConfig } from '../../../../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../../../../src/lib/server/vendor-boundary.server';
import { ALWAYS_ON_REGULATED_BASELINE } from '../../../../src/lib/shared/security-baseline';
import { getVerifiedCurrentSiteAdminUserOrThrow } from '../../../auth/access';
import { fetchAllBetterAuthPasskeys, fetchAllBetterAuthUsers } from '../../betterAuth';
import { getSecurityScopeFields, normalizeSecurityScope } from './core';
import {
  _getSecurityMetricsSnapshot,
  buildSecurityWorkspaceControlSummary,
  buildSecurityWorkspaceFindingSummary,
  buildSecurityWorkspaceVendorSummary,
  countQueryResults,
  getCurrentAnnualReviewRunRecord,
} from './operations_core';
import { buildReviewRunSummary, listReviewTasksByRunId } from './review_runs_core';
import {
  SECURITY_SCOPE_ID,
  SECURITY_SCOPE_TYPE,
  auditReadinessSnapshotValidator,
  evidenceReportKindValidator,
  exportArtifactTypeValidator,
  securityPostureSummaryValidator,
  securityWorkspaceOverviewValidator,
} from './validators';
import { v } from 'convex/values';

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
      ...getSecurityScopeFields(),
      ...args,
      exportBundleJson: undefined,
      exportHash: undefined,
      exportIntegritySummary: undefined,
      exportManifestJson: undefined,
      exportManifestHash: undefined,
      internalReviewNotes: null,
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
      ...getSecurityScopeFields(),
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
          scopeId: normalizeSecurityScope(latestBackupDrill).scopeId,
          scopeType: normalizeSecurityScope(latestBackupDrill).scopeType,
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
          scopeId: normalizeSecurityScope(latestRetentionJob).scopeId,
          scopeType: normalizeSecurityScope(latestRetentionJob).scopeType,
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

export const getSecurityWorkspaceOverview = query({
  args: {},
  returns: securityWorkspaceOverviewValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const [
      postureSummary,
      auditReadiness,
      controlWorkspaceOverview,
      findingSummary,
      vendorSummary,
      annualRunRecord,
    ] = await Promise.all([
      getSecurityPostureSummaryHandler(ctx),
      getAuditReadinessSnapshotHandler(ctx),
      buildSecurityWorkspaceControlSummary(ctx),
      buildSecurityWorkspaceFindingSummary(ctx),
      buildSecurityWorkspaceVendorSummary(ctx),
      getCurrentAnnualReviewRunRecord(ctx),
    ]);
    const annualRun = annualRunRecord ? await buildReviewRunSummary(ctx, annualRunRecord) : null;
    const blockedReviewTasks =
      annualRun?.taskCounts.blocked ??
      (await (async () => {
        const triggeredRuns = await ctx.db
          .query('reviewRuns')
          .withIndex('by_kind_and_created_at', (q) => q.eq('kind', 'triggered'))
          .collect();
        const taskLists = await Promise.all(
          triggeredRuns.map(async (run) => await listReviewTasksByRunId(ctx, run._id)),
        );
        return taskLists.flat().filter((task) => task.status === 'blocked').length;
      })());

    return {
      auditReadiness,
      controlSummary: controlWorkspaceOverview.controlSummary,
      currentAnnualReviewRun: annualRun,
      findingSummary,
      postureSummary,
      queues: {
        blockedReviewTasks,
        missingEvidenceControls: controlWorkspaceOverview.missingEvidenceControls,
        pendingVendorReviews: vendorSummary.pendingVendorReviews,
        undispositionedFindings: findingSummary.undispositionedCount,
      },
      scopeId: SECURITY_SCOPE_ID,
      scopeType: SECURITY_SCOPE_TYPE,
      vendorSummary: {
        approvedCount: vendorSummary.approvedCount,
        needsFollowUpCount: vendorSummary.needsFollowUpCount,
        totalCount: vendorSummary.totalCount,
      },
    };
  },
});
