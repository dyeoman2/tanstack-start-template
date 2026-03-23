import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';
import { getE2ETestSecret } from '../src/lib/server/env.server';
import { getSecurityScopeFields } from './lib/security/core';
import {
  documentScanEventArgs,
  recordBackupVerificationHandler,
  syncCurrentSecurityFindings,
  updateSecurityMetrics,
} from './lib/security/operations_core';
import {
  backupVerificationDrillTypeValidator,
  backupVerificationInitiatedByKindValidator,
  backupVerificationTargetEnvironmentValidator,
} from './lib/security/validators';

export const cleanupExpiredAttachments = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const expiredAttachments = await ctx.runQuery(
      internal.securityOps.listExpiredAttachmentsInternal,
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

    await ctx.runMutation(internal.securityOps.recordRetentionJob, {
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
    deletedReviewAttestations: v.number(),
    deletedReviewRuns: v.number(),
    deletedReviewTaskEvidenceLinks: v.number(),
    deletedReviewTaskResults: v.number(),
    deletedReviewTasks: v.number(),
    deletedChecklistItems: v.number(),
    deletedEvidence: v.number(),
    deletedEvidenceActivity: v.number(),
    deletedEvidenceReports: v.number(),
    deletedExportArtifacts: v.number(),
    deletedPolicies: v.number(),
    deletedPolicyControlMappings: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.secret !== getE2ETestSecret()) {
      throw new Error('Invalid reseed secret.');
    }

    const [
      checklistItems,
      evidenceRows,
      evidenceActivityRows,
      evidenceReports,
      exportArtifacts,
      reviewRuns,
      reviewTasks,
      reviewTaskResults,
      reviewAttestations,
      reviewTaskEvidenceLinks,
      policies,
      policyControlMappings,
    ] = await Promise.all([
      ctx.db.query('securityControlChecklistItems').collect(),
      ctx.db.query('securityControlEvidence').collect(),
      ctx.db.query('securityControlEvidenceActivity').collect(),
      ctx.db.query('evidenceReports').collect(),
      ctx.db.query('exportArtifacts').collect(),
      ctx.db.query('reviewRuns').collect(),
      ctx.db.query('reviewTasks').collect(),
      ctx.db.query('reviewTaskResults').collect(),
      ctx.db.query('reviewAttestations').collect(),
      ctx.db.query('reviewTaskEvidenceLinks').collect(),
      ctx.db.query('securityPolicies').collect(),
      ctx.db.query('securityPolicyControlMappings').collect(),
    ]);

    await Promise.all([
      ...checklistItems.map((row) => ctx.db.delete(row._id)),
      ...evidenceRows.map((row) => ctx.db.delete(row._id)),
      ...evidenceActivityRows.map((row) => ctx.db.delete(row._id)),
      ...evidenceReports.map((row) => ctx.db.delete(row._id)),
      ...exportArtifacts.map((row) => ctx.db.delete(row._id)),
      ...reviewRuns.map((row) => ctx.db.delete(row._id)),
      ...reviewTasks.map((row) => ctx.db.delete(row._id)),
      ...reviewTaskResults.map((row) => ctx.db.delete(row._id)),
      ...reviewAttestations.map((row) => ctx.db.delete(row._id)),
      ...reviewTaskEvidenceLinks.map((row) => ctx.db.delete(row._id)),
      ...policies.map((row) => ctx.db.delete(row._id)),
      ...policyControlMappings.map((row) => ctx.db.delete(row._id)),
    ]);

    return {
      activeSeedControlCount: ACTIVE_CONTROL_REGISTER.controls.length,
      deletedReviewAttestations: reviewAttestations.length,
      deletedReviewRuns: reviewRuns.length,
      deletedReviewTaskEvidenceLinks: reviewTaskEvidenceLinks.length,
      deletedReviewTaskResults: reviewTaskResults.length,
      deletedReviewTasks: reviewTasks.length,
      deletedChecklistItems: checklistItems.length,
      deletedEvidence: evidenceRows.length,
      deletedEvidenceActivity: evidenceActivityRows.length,
      deletedEvidenceReports: evidenceReports.length,
      deletedExportArtifacts: exportArtifacts.length,
      deletedPolicies: policies.length,
      deletedPolicyControlMappings: policyControlMappings.length,
    };
  },
});

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
