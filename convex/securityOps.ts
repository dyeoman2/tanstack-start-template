import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from './_generated/server';
import { v } from 'convex/values';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';
import { getE2ETestSecret } from '../src/lib/server/env.server';
import { getSecurityScopeFields } from './lib/security/core';
import { getVerifiedCurrentUserOrThrow, requireOrganizationPermission } from './auth/access';
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

async function insertDocumentScanEvent(
  ctx: MutationCtx,
  args: {
    attachmentId?: Id<'chatAttachments'>;
    details: string | null;
    fileName: string;
    mimeType: string;
    organizationId: string;
    requestedByUserId: string;
    resultStatus: 'accepted' | 'inspection_failed' | 'quarantined' | 'rejected';
    scannedAt: number;
    scannerEngine: string;
  },
) {
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
}

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
    deletedVendorControlMappings: v.number(),
    deletedVendors: v.number(),
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
      vendors,
      vendorControlMappings,
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
      ctx.db.query('securityVendors').collect(),
      ctx.db.query('securityVendorControlMappings').collect(),
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
      ...vendors.map((row) => ctx.db.delete(row._id)),
      ...vendorControlMappings.map((row) => ctx.db.delete(row._id)),
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
      deletedVendorControlMappings: vendorControlMappings.length,
      deletedVendors: vendors.length,
    };
  },
});

export const recordDocumentScanEventInternal = internalMutation({
  args: {
    ...documentScanEventArgs,
  },
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args) => {
    return await insertDocumentScanEvent(ctx, {
      ...args,
      details: args.details ?? null,
    });
  },
});

export const recordDocumentScanEvent = mutation({
  args: {
    attachmentId: v.optional(v.id('chatAttachments')),
    details: v.union(v.string(), v.null()),
    fileName: v.string(),
    mimeType: v.string(),
    organizationId: v.string(),
    resultStatus: v.union(
      v.literal('accepted'),
      v.literal('inspection_failed'),
      v.literal('quarantined'),
      v.literal('rejected'),
    ),
    scannedAt: v.number(),
    scannerEngine: v.string(),
  },
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args): Promise<Id<'documentScanEvents'>> => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    await requireOrganizationPermission(ctx, {
      organizationId: args.organizationId,
      permission: 'viewOrganization',
    });

    return await insertDocumentScanEvent(ctx, {
      ...args,
      details: args.details ?? null,
      requestedByUserId: user.authUserId,
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
