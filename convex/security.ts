import { anyApi } from 'convex/server';
import { v } from 'convex/values';
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
import { fetchAllBetterAuthUsers } from './lib/betterAuth';

const securityPostureSummaryValidator = v.object({
  audit: v.object({
    integrityFailures: v.number(),
    lastEventAt: v.union(v.number(), v.null()),
  }),
  auth: v.object({
    mfaCoveragePercent: v.number(),
    mfaEnabledUsers: v.number(),
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
    totalScans: v.number(),
  }),
});

const evidenceReportValidator = v.object({
  createdAt: v.number(),
  id: v.id('evidenceReports'),
  report: v.string(),
});

const documentScanEventArgs = {
  attachmentId: v.optional(v.id('chatAttachments')),
  details: v.optional(v.union(v.string(), v.null())),
  fileName: v.string(),
  mimeType: v.string(),
  organizationId: v.string(),
  requestedByUserId: v.string(),
  resultStatus: v.union(v.literal('clean'), v.literal('quarantined')),
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
    generatedByUserId: v.string(),
    organizationId: v.optional(v.string()),
    reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
  },
  returns: v.id('evidenceReports'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('evidenceReports', {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const getSecurityPostureSummary = query({
  args: {},
  returns: securityPostureSummaryValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

    const [authUsers, latestScan, latestRetentionJob, latestBackupCheck, latestAuditEvent, integrityFailures, totalScans, quarantinedScans] =
      await Promise.all([
        fetchAllBetterAuthUsers(ctx),
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
      ]);

    const totalUsers = authUsers.length;
    const mfaEnabledUsers = authUsers.filter((user) => user.twoFactorEnabled === true).length;

    return {
      audit: {
        integrityFailures: integrityFailures.length,
        lastEventAt: latestAuditEvent?.createdAt ?? null,
      },
      auth: {
        mfaCoveragePercent: totalUsers === 0 ? 0 : Math.round((mfaEnabledUsers / totalUsers) * 100),
        mfaEnabledUsers,
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
        totalScans: totalScans.length,
      },
    };
  },
});

export const generateEvidenceReport = action({
  args: {},
  returns: evidenceReportValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const summary = await ctx.runQuery(anyApi.security.getSecurityPostureSummary, {});
    const createdAt = Date.now();
    const report = JSON.stringify(
      {
        generatedAt: new Date(createdAt).toISOString(),
        generatedByUserId: currentUser.authUserId,
        summary,
      },
      null,
      2,
    );

    const id = await ctx.runMutation(anyApi.security.createEvidenceReport, {
      contentJson: report,
      generatedByUserId: currentUser.authUserId,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reportKind: 'security_posture',
    });

    return {
      createdAt,
      id,
      report,
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
      if (attachment.rawStorageId) {
        await ctx.storage.delete(attachment.rawStorageId);
      }

      if (attachment.extractedTextStorageId) {
        await ctx.storage.delete(attachment.extractedTextStorageId);
      }

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
      rawStorageId: v.optional(v.id('_storage')),
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
      rawStorageId: attachment.rawStorageId,
    }));
  },
});
