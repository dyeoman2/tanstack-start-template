import { internal } from '../../../_generated/api';
import { internalAction, internalMutation, internalQuery } from '../../../_generated/server';
import { getE2ETestSecret } from '../../../../src/lib/server/env.server';
import { ACTIVE_CONTROL_REGISTER } from '../../../../src/lib/shared/compliance/control-register';
import { v } from 'convex/values';

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
    };
  },
});
