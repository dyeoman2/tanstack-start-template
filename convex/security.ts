import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import { getRetentionPolicyConfig } from '../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../src/lib/server/vendor-boundary.server';
import { ALWAYS_ON_REGULATED_BASELINE, REGULATED_ORGANIZATION_POLICY_DEFAULTS } from '../src/lib/shared/security-baseline';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
} from './auth/access';
import { fetchAllBetterAuthPasskeys, fetchAllBetterAuthUsers } from './lib/betterAuth';

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
      approvalEnvVar: v.union(v.string(), v.null()),
      approved: v.boolean(),
      approvedByDefault: v.boolean(),
      displayName: v.string(),
      vendor: v.string(),
    }),
  ),
});

const evidenceReportValidator = v.object({
  createdAt: v.number(),
  exportHash: v.union(v.string(), v.null()),
  id: v.id('evidenceReports'),
  report: v.string(),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
});

const evidenceReportRecordValidator = v.object({
  _id: v.id('evidenceReports'),
  _creationTime: v.number(),
  organizationId: v.optional(v.string()),
  generatedByUserId: v.string(),
  reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
  contentJson: v.string(),
  contentHash: v.string(),
  exportBundleJson: v.optional(v.string()),
  exportHash: v.optional(v.string()),
  exportIntegritySummary: v.optional(v.string()),
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
  reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
  contentHash: v.string(),
  exportHash: v.union(v.string(), v.null()),
  exportedAt: v.union(v.number(), v.null()),
  exportedByUserId: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByUserId: v.union(v.string(), v.null()),
  reviewNotes: v.union(v.string(), v.null()),
});

const evidenceReportListValidator = v.array(evidenceReportListItemValidator);

function stringifyStable(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function hashContent(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
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

export const recordDocumentScanEvent = mutation({
  args: documentScanEventArgs,
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('documentScanEvents', {
      ...args,
      createdAt: Date.now(),
      details: args.details ?? null,
    });
  },
});

export const recordDocumentScanEventInternal = internalMutation({
  args: {
    ...documentScanEventArgs,
  },
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('documentScanEvents', {
      ...args,
      createdAt: Date.now(),
      details: args.details ?? null,
    });
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

export const recordBackupVerification = internalMutation({
  args: {
    checkedAt: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
    summary: v.string(),
  },
  returns: v.id('backupVerificationReports'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('backupVerificationReports', {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const createEvidenceReport = internalMutation({
  args: {
    contentJson: v.string(),
    contentHash: v.string(),
    generatedByUserId: v.string(),
    organizationId: v.optional(v.string()),
    reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
  },
  returns: v.id('evidenceReports'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('evidenceReports', {
      ...args,
      exportBundleJson: undefined,
      exportHash: undefined,
      exportIntegritySummary: undefined,
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

export const getSecurityPostureSummary = query({
  args: {},
  returns: securityPostureSummaryValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

    const [
      authUsers,
      passkeys,
      latestScan,
      latestRetentionJob,
      latestBackupCheck,
      latestAuditEvent,
      integrityFailures,
      totalScans,
      quarantinedScans,
      rejectedScans,
    ] =
      await Promise.all([
        fetchAllBetterAuthUsers(ctx),
        fetchAllBetterAuthPasskeys(ctx),
        ctx.db.query('documentScanEvents').withIndex('by_created_at').order('desc').first(),
        ctx.db.query('retentionJobs').withIndex('by_created_at').order('desc').first(),
        ctx.db.query('backupVerificationReports').withIndex('by_checked_at').order('desc').first(),
        ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').first(),
        ctx.db
          .query('auditLogs')
          .withIndex('by_eventType_and_createdAt', (q) => q.eq('eventType', 'audit_integrity_check_failed'))
          .collect(),
        ctx.db.query('documentScanEvents').collect(),
        ctx.db
          .query('documentScanEvents')
          .filter((q) => q.eq(q.field('resultStatus'), 'quarantined'))
          .collect(),
        ctx.db
          .query('documentScanEvents')
          .filter((q) => q.eq(q.field('resultStatus'), 'rejected'))
          .collect(),
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
        integrityFailures: integrityFailures.length,
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
        lastScanAt: latestScan?.createdAt ?? null,
        quarantinedCount: quarantinedScans.length,
        rejectedCount: rejectedScans.length,
        totalScans: totalScans.length,
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
    const reports = await ctx.db.query('evidenceReports').withIndex('by_created_at').order('desc').take(limit);
    return reports.map((report) => ({
      id: report._id,
      createdAt: report.createdAt,
      generatedByUserId: report.generatedByUserId,
      reportKind: report.reportKind,
      contentHash: report.contentHash,
      exportHash: report.exportHash ?? null,
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

export const exportEvidenceReport = action({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: evidenceReportValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const report = await ctx.runQuery(anyApi.security.getEvidenceReportInternal, {
      id: args.id,
    });
    if (!report) {
      throw new Error('Evidence report not found');
    }

    const exportBundle = stringifyStable({
      contentHash: report.contentHash,
      exportedAt: new Date().toISOString(),
      integritySummary: {
        contentHash: report.contentHash,
        reviewedAt: report.reviewedAt ?? null,
        reviewStatus: report.reviewStatus,
      },
      report: JSON.parse(report.contentJson),
      reportId: report._id,
    });
    const exportHash = await hashContent(exportBundle);
    const exportedAt = Date.now();
    const exportIntegritySummary = stringifyStable({
      contentHash: report.contentHash,
      exportHash,
      reviewStatus: report.reviewStatus,
    });

    await ctx.runMutation(anyApi.security.storeEvidenceReportExport, {
      id: args.id,
      exportBundleJson: exportBundle,
      exportHash,
      exportIntegritySummary,
      exportedAt,
      exportedByUserId: currentUser.authUserId,
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
      }),
    });

    return {
      createdAt: report.createdAt,
      exportHash,
      id: report._id,
      report: exportBundle,
      reviewStatus: report.reviewStatus,
    };
  },
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
    exportedAt: v.number(),
    exportedByUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      exportBundleJson: args.exportBundleJson,
      exportHash: args.exportHash,
      exportIntegritySummary: args.exportIntegritySummary,
      exportedAt: args.exportedAt,
      exportedByUserId: args.exportedByUserId,
    });
    return null;
  },
});

export const generateEvidenceReport = action({
  args: {},
  returns: evidenceReportValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const summary = await ctx.runQuery(anyApi.security.getSecurityPostureSummary, {});
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
    const currentOrganizationPolicies = currentUser.activeOrganizationId
      ? await ctx.runQuery(anyApi.organizationManagement.getOrganizationPolicies, {
          organizationId: currentUser.activeOrganizationId,
        })
      : null;
    const vendorPosture = getVendorBoundarySnapshot();
    const createdAt = Date.now();
    const reportPayload = {
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
      };
    const report = stringifyStable(reportPayload);
    const contentHash = await hashContent(report);

    const id = await ctx.runMutation(anyApi.security.createEvidenceReport, {
      contentJson: report,
      contentHash,
      generatedByUserId: currentUser.authUserId,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reportKind: 'security_posture',
    });

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'evidence_report_generated',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: id,
      resourceLabel: 'security_posture',
      resourceType: 'evidence_report',
      severity: 'info',
      sourceSurface: 'admin.security',
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        contentHash,
      }),
    });

    return {
      createdAt,
      exportHash: null,
      id,
      report,
      reviewStatus: 'pending' as const,
    };
  },
});

export const cleanupExpiredAttachments = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const expiredAttachments = await ctx.runQuery(anyApi.security.listExpiredAttachmentsInternal, {
      now,
    });

    let processedCount = 0;

    for (const attachment of expiredAttachments) {
      if (attachment.extractedTextStorageId) {
        await ctx.storage.delete(attachment.extractedTextStorageId);
      }

      await ctx.runAction(anyApi.storagePlatform.deleteStoredFileInternal, {
        storageId: attachment.storageId,
      });

      await ctx.runMutation(anyApi.agentChat.deleteAttachmentStorageInternal, {
        attachmentId: attachment._id,
      });
      processedCount += 1;
    }

    await ctx.runMutation(anyApi.security.recordRetentionJob, {
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
