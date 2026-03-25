import { internalMutation, internalQuery, query } from './_generated/server';
import {
  getAuditReadinessSnapshotHandler,
  getSecurityPostureSummaryHandler,
} from './lib/security/posture';
import { getVerifiedCurrentSiteAdminUserOrThrow } from './auth/access';
import {
  SECURITY_SCOPE_ID,
  SECURITY_SCOPE_TYPE,
  auditReadinessSnapshotValidator,
  evidenceReportKindValidator,
  exportArtifactTypeValidator,
  securityFindingsBoardValidator,
  securityPostureSummaryValidator,
  securityReportsBoardValidator,
  securityWorkspaceOverviewValidator,
} from './lib/security/validators';
import { v } from 'convex/values';
import { getSecurityScopeFields, normalizeSecurityScope } from './lib/security/core';
import {
  buildSecurityWorkspaceControlSummary,
  buildSecurityWorkspaceFindingSummary,
  buildSecurityWorkspaceVendorSummary,
  getCurrentAnnualReviewRunRecord,
} from './lib/security/operations_core';
import { buildReviewRunSummary, listReviewTasksByRunId } from './lib/security/review_runs_core';
import { listSecurityFindingsHandler } from './lib/security/workspace';

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
      createdAt: Date.now(),
    });
  },
});

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
        missingSupportControls: controlWorkspaceOverview.missingSupportControls,
        pendingVendorReviews: vendorSummary.pendingVendorReviews,
        undispositionedFindings: findingSummary.undispositionedCount,
      },
      scopeId: SECURITY_SCOPE_ID,
      scopeType: SECURITY_SCOPE_TYPE,
      vendorSummary: {
        approvedCount: vendorSummary.approvedCount,
        dueSoonCount: vendorSummary.dueSoonCount,
        overdueCount: vendorSummary.overdueCount,
        totalCount: vendorSummary.totalCount,
      },
    };
  },
});

export const getSecurityFindingsBoard = query({
  args: {},
  returns: securityFindingsBoardValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const findings = await listSecurityFindingsHandler(ctx);
    const summary = {
      openCount: findings.filter((finding) => finding.status === 'open').length,
      reviewPendingCount: findings.filter((finding) => finding.disposition === 'pending_review')
        .length,
      totalCount: findings.length,
    };

    return {
      findings,
      summary,
      scopeId: SECURITY_SCOPE_ID,
      scopeType: SECURITY_SCOPE_TYPE,
    };
  },
});

export const getSecurityReportsBoard = query({
  args: {},
  returns: securityReportsBoardValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const [auditReadiness, evidenceReports] = await Promise.all([
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
    ]);

    return {
      auditReadiness,
      evidenceReports,
      scopeId: SECURITY_SCOPE_ID,
      scopeType: SECURITY_SCOPE_TYPE,
    };
  },
});
