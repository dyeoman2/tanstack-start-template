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
import {
  getSecurityWorkspaceResetSecret,
  isDevelopmentOrTestDeployment,
  isSecurityWorkspaceResetEnabled,
} from '../src/lib/server/env.server';
import { getVerifiedCurrentUserOrThrow, requireOrganizationPermission } from './auth/access';
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

const SECURITY_WORKSPACE_RESEED_BATCH_SIZE = 8;

type SecurityWorkspaceResetTable =
  | 'securityControlChecklistItems'
  | 'securityControlEvidence'
  | 'securityControlEvidenceActivity'
  | 'evidenceReports'
  | 'exportArtifacts'
  | 'reviewRuns'
  | 'reviewTasks'
  | 'reviewTaskResults'
  | 'reviewAttestations'
  | 'reviewTaskEvidenceLinks'
  | 'securityPolicies'
  | 'securityPolicyControlMappings'
  | 'securityVendors'
  | 'securityVendorControlMappings';

const SECURITY_WORKSPACE_RESET_TABLES: readonly SecurityWorkspaceResetTable[] = [
  'securityControlChecklistItems',
  'securityControlEvidence',
  'securityControlEvidenceActivity',
  'evidenceReports',
  'exportArtifacts',
  'reviewRuns',
  'reviewTasks',
  'reviewTaskResults',
  'reviewAttestations',
  'reviewTaskEvidenceLinks',
  'securityPolicies',
  'securityPolicyControlMappings',
  'securityVendors',
  'securityVendorControlMappings',
];

function assertSecurityWorkspaceResetAuthorized(secret: string) {
  if (!isDevelopmentOrTestDeployment() || !isSecurityWorkspaceResetEnabled()) {
    throw new Error('Security workspace reset is disabled.');
  }

  if (secret !== getSecurityWorkspaceResetSecret()) {
    throw new Error('Invalid reseed secret.');
  }
}

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
      await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
        storageId: attachment.storageId,
      });
      if (attachment.extractedTextStorageId) {
        await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
          storageId: attachment.extractedTextStorageId,
        });
      }

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
      extractedTextStorageId: v.optional(v.string()),
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

export const deleteSecurityWorkspaceTableBatchForDevelopment = internalMutation({
  args: {
    secret: v.string(),
    tableName: v.union(
      v.literal('securityControlChecklistItems'),
      v.literal('securityControlEvidence'),
      v.literal('securityControlEvidenceActivity'),
      v.literal('evidenceReports'),
      v.literal('exportArtifacts'),
      v.literal('reviewRuns'),
      v.literal('reviewTasks'),
      v.literal('reviewTaskResults'),
      v.literal('reviewAttestations'),
      v.literal('reviewTaskEvidenceLinks'),
      v.literal('securityPolicies'),
      v.literal('securityPolicyControlMappings'),
      v.literal('securityVendors'),
      v.literal('securityVendorControlMappings'),
    ),
  },
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertSecurityWorkspaceResetAuthorized(args.secret);

    const batch = await ctx.db.query(args.tableName).take(SECURITY_WORKSPACE_RESEED_BATCH_SIZE);
    for (const row of batch) {
      await ctx.db.delete(row._id);
    }

    return {
      deletedCount: batch.length,
      hasMore: batch.length === SECURITY_WORKSPACE_RESEED_BATCH_SIZE,
    };
  },
});

export const resetSecurityControlWorkspaceForDevelopment = internalAction({
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
    assertSecurityWorkspaceResetAuthorized(args.secret);

    const deletedCounts: Record<SecurityWorkspaceResetTable, number> = {
      evidenceReports: 0,
      exportArtifacts: 0,
      reviewAttestations: 0,
      reviewRuns: 0,
      reviewTaskEvidenceLinks: 0,
      reviewTaskResults: 0,
      reviewTasks: 0,
      securityControlChecklistItems: 0,
      securityControlEvidence: 0,
      securityControlEvidenceActivity: 0,
      securityPolicies: 0,
      securityPolicyControlMappings: 0,
      securityVendorControlMappings: 0,
      securityVendors: 0,
    };

    for (const tableName of SECURITY_WORKSPACE_RESET_TABLES) {
      while (true) {
        const result = await ctx.runMutation(
          internal.securityOps.deleteSecurityWorkspaceTableBatchForDevelopment,
          {
            secret: args.secret,
            tableName,
          },
        );
        deletedCounts[tableName] += result.deletedCount;
        if (!result.hasMore) {
          break;
        }
      }
    }

    return {
      activeSeedControlCount: ACTIVE_CONTROL_REGISTER.controls.length,
      deletedReviewAttestations: deletedCounts.reviewAttestations,
      deletedReviewRuns: deletedCounts.reviewRuns,
      deletedReviewTaskEvidenceLinks: deletedCounts.reviewTaskEvidenceLinks,
      deletedReviewTaskResults: deletedCounts.reviewTaskResults,
      deletedReviewTasks: deletedCounts.reviewTasks,
      deletedChecklistItems: deletedCounts.securityControlChecklistItems,
      deletedEvidence: deletedCounts.securityControlEvidence,
      deletedEvidenceActivity: deletedCounts.securityControlEvidenceActivity,
      deletedEvidenceReports: deletedCounts.evidenceReports,
      deletedExportArtifacts: deletedCounts.exportArtifacts,
      deletedPolicies: deletedCounts.securityPolicies,
      deletedPolicyControlMappings: deletedCounts.securityPolicyControlMappings,
      deletedVendorControlMappings: deletedCounts.securityVendorControlMappings,
      deletedVendors: deletedCounts.securityVendors,
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
    /* security-lint-ok: site-admin-not-required reason: authenticated organization users must be able to persist scan results for files they upload after organization-level authorization passes. */
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    await requireOrganizationPermission(ctx, {
      organizationId: args.organizationId,
      permission: 'viewOrganization',
      sourceSurface: 'security.document_scan_event',
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
    jobKind: v.union(v.literal('attachment_purge'), v.literal('quarantine_cleanup')),
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
