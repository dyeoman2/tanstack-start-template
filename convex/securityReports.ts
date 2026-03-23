import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { getVendorBoundarySnapshot } from '../src/lib/server/vendor-boundary.server';
import { getVerifiedCurrentSiteAdminUserOrThrow } from './auth/access';
import {
  buildEvidenceReportDetail,
  createTriggeredReviewRunRecord,
  reconcileEvidenceReportLinkedTasks,
} from './lib/security/review_runs_core';
import {
  buildVendorWorkspaceRows,
  resolveDefaultSecurityOwner,
  resolveVendorNextReviewAt,
  syncSecurityVendorRecords,
} from './lib/security/vendors_core';
import { exportEvidenceReportHandler, generateEvidenceReportHandler } from './lib/security/reports';
import {
  getSecurityScopeFields,
  normalizeSecurityScope,
  stringifyStable,
} from './lib/security/core';
import {
  evidenceReportDetailValidator,
  evidenceReportKindValidator,
  evidenceReportListValidator,
  evidenceReportRecordValidator,
  evidenceReportValidator,
  vendorKeyValidator,
  vendorWorkspaceListValidator,
  vendorWorkspaceValidator,
} from './lib/security/validators';
import { anyApi } from 'convex/server';
import type { Doc } from './_generated/dataModel';

function toEvidenceReportRecord(report: Doc<'evidenceReports'>) {
  return {
    _id: report._id,
    _creationTime: report._creationTime,
    scopeId: report.scopeId,
    scopeType: report.scopeType,
    organizationId: report.organizationId,
    generatedByUserId: report.generatedByUserId,
    reportKind: report.reportKind,
    contentJson: report.contentJson,
    contentHash: report.contentHash,
    exportBundleJson: report.exportBundleJson,
    exportHash: report.exportHash,
    exportIntegritySummary: report.exportIntegritySummary,
    exportManifestJson: report.exportManifestJson,
    exportManifestHash: report.exportManifestHash,
    latestExportArtifactId: report.latestExportArtifactId,
    exportedAt: report.exportedAt,
    exportedByUserId: report.exportedByUserId,
    reviewStatus: report.reviewStatus,
    reviewedAt: report.reviewedAt,
    reviewedByUserId: report.reviewedByUserId,
    customerSummary: report.customerSummary,
    internalReviewNotes: report.internalReviewNotes,
    createdAt: report.createdAt,
  };
}

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
  },
});

export const getEvidenceReportDetail = query({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: v.union(evidenceReportDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await buildEvidenceReportDetail(ctx, args.id);
  },
});

export const reviewEvidenceReport = mutation({
  args: {
    customerSummary: v.optional(v.string()),
    id: v.id('evidenceReports'),
    internalNotes: v.optional(v.string()),
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
    const internalNotes = args.internalNotes?.trim() || null;
    await ctx.db.patch(args.id, {
      customerSummary: args.customerSummary?.trim() || null,
      internalReviewNotes: internalNotes,
      reviewStatus: args.reviewStatus,
      reviewedAt,
      reviewedByUserId: currentUser.authUserId,
    });

    if (args.reviewStatus === 'needs_follow_up') {
      await createTriggeredReviewRunRecord(ctx, {
        actorUserId: currentUser.authUserId,
        dedupeKey: `evidence-report:${report._id}`,
        sourceLink: {
          freshAt: reviewedAt,
          sourceId: report._id,
          sourceLabel: report.reportKind,
          sourceType: 'evidence_report',
        },
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
        customerSummary: args.customerSummary?.trim() || null,
        internalNotes,
        reviewStatus: args.reviewStatus,
      }),
    });

    const updated = await ctx.db.get(args.id);
    if (!updated) {
      throw new Error('Evidence report not found after update');
    }

    await reconcileEvidenceReportLinkedTasks(ctx, {
      actorUserId: currentUser.authUserId,
      report: updated,
    });

    return toEvidenceReportRecord(updated);
  },
});

export const listVendorReviewWorkspaces = query({
  args: {},
  returns: vendorWorkspaceListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await buildVendorWorkspaceRows(ctx);
  },
});

export const syncVendorReviewRecords = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    await syncSecurityVendorRecords(ctx);
    return 0;
  },
});

export const reviewVendorWorkspace = mutation({
  args: {
    owner: v.optional(v.string()),
    summary: v.optional(v.string()),
    vendorKey: vendorKeyValidator,
  },
  returns: vendorWorkspaceValidator,
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('securityVendors')
      .withIndex('by_vendor_key', (q) => q.eq('vendorKey', args.vendorKey))
      .unique();
    const defaultOwner = await resolveDefaultSecurityOwner(ctx);
    const now = Date.now();
    const lastReviewedAt = now;
    const nextReviewAt = resolveVendorNextReviewAt(now);
    const resolvedOwner = args.owner?.trim() || existing?.owner || defaultOwner;

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastReviewedAt,
        nextReviewAt,
        owner: resolvedOwner,
        summary: args.summary?.trim() || null,
        updatedAt: now,
      });
    } else {
      const runtimeVendor = getVendorBoundarySnapshot().find(
        (vendor) => vendor.vendor === args.vendorKey,
      );
      await ctx.db.insert('securityVendors', {
        ...getSecurityScopeFields(),
        createdAt: now,
        lastReviewedAt,
        nextReviewAt,
        owner: resolvedOwner,
        summary: args.summary?.trim() || null,
        title: runtimeVendor?.displayName ?? args.vendorKey,
        updatedAt: now,
        vendorKey: args.vendorKey,
      });
    }

    const workspaces = await buildVendorWorkspaceRows(ctx);
    const updated = workspaces.find((workspace) => workspace.vendor === args.vendorKey);
    if (!updated) {
      throw new Error('Vendor workspace not found after review update.');
    }
    return updated;
  },
});

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
    const report = await ctx.db.get(args.id);
    return report ? toEvidenceReportRecord(report) : null;
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

export const generateEvidenceReport = action({
  args: {
    reportKind: v.optional(evidenceReportKindValidator),
  },
  returns: evidenceReportValidator,
  handler: generateEvidenceReportHandler,
});
