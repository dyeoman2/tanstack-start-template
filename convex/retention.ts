import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { RETENTION_EVENT_TYPES } from './lib/retention';
import { recordSystemAuditEvent } from './lib/auditEmitters';

const TEMPORARY_ARTIFACT_RETENTION_LIMIT = 128;

type TemporaryArtifactPurgeCandidate =
  | {
      _id: Doc<'chatAttachments'>['_id'];
      kind: 'chat_attachment';
      name: string;
      organizationId: string;
      purgeEligibleAt: number;
      storageId: string;
    }
  | {
      _id: Doc<'pdfParseJobs'>['_id'];
      kind: 'pdf_parse_result';
      organizationId: string;
      purgeEligibleAt: number;
      resultStorageId: string;
      sourceStorageId: string;
    };

type OrganizationBatchAccumulator = {
  deletedCount: number;
  failedCount: number;
  failureMessages: string[];
  sampleIds: string[];
  skippedOnHoldCount: number;
  typeCounts: {
    chat_attachment: number;
    pdf_parse_result: number;
  };
};

function createOrganizationBatchAccumulator(): OrganizationBatchAccumulator {
  return {
    deletedCount: 0,
    failedCount: 0,
    failureMessages: [],
    sampleIds: [],
    skippedOnHoldCount: 0,
    typeCounts: {
      chat_attachment: 0,
      pdf_parse_result: 0,
    },
  };
}

function addSampleId(accumulator: OrganizationBatchAccumulator, id: string) {
  if (accumulator.sampleIds.length >= 10) {
    return;
  }
  accumulator.sampleIds.push(id);
}

export const listPurgeEligibleTemporaryArtifactsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.object({
    attachments: v.array(
      v.object({
        _id: v.id('chatAttachments'),
        name: v.string(),
        organizationId: v.string(),
        purgeEligibleAt: v.number(),
        storageId: v.string(),
      }),
    ),
    pdfParseJobs: v.array(
      v.object({
        _id: v.id('pdfParseJobs'),
        organizationId: v.string(),
        purgeEligibleAt: v.number(),
        resultStorageId: v.string(),
        sourceStorageId: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? TEMPORARY_ARTIFACT_RETENTION_LIMIT, 512));
    const [attachments, pdfParseJobs] = await Promise.all([
      ctx.db
        .query('chatAttachments')
        .withIndex('by_purgeEligibleAt', (query) => query.lt('purgeEligibleAt', args.now))
        .take(limit),
      ctx.db
        .query('pdfParseJobs')
        .withIndex('by_purgeEligibleAt', (query) => query.lt('purgeEligibleAt', args.now))
        .take(limit),
    ]);

    return {
      attachments: attachments.map((attachment) => ({
        _id: attachment._id,
        name: attachment.name,
        organizationId: attachment.organizationId,
        purgeEligibleAt: attachment.purgeEligibleAt ?? args.now,
        storageId: attachment.storageId,
      })),
      pdfParseJobs: pdfParseJobs
        .filter((job) => typeof job.resultStorageId === 'string')
        .map((job) => ({
          _id: job._id,
          organizationId: job.organizationId,
          purgeEligibleAt: job.purgeEligibleAt ?? args.now,
          resultStorageId: job.resultStorageId as string,
          sourceStorageId: job.storageId,
        })),
    };
  },
});

export const recordRetentionDeletionBatchInternal = internalMutation({
  args: {
    completedAt: v.number(),
    deletedCount: v.number(),
    detailsJson: v.string(),
    failedCount: v.number(),
    jobKind: v.literal('temporary_artifact_purge'),
    organizationId: v.string(),
    policySnapshotJson: v.string(),
    skippedOnHoldCount: v.number(),
    startedAt: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
  },
  returns: v.id('retentionDeletionBatches'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('retentionDeletionBatches', {
      ...args,
      createdAt: args.completedAt,
    });
  },
});

export const purgeExpiredTemporaryArtifacts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const startedAt = Date.now();
    const candidates = (await ctx.runQuery(
      internal.retention.listPurgeEligibleTemporaryArtifactsInternal,
      {
        limit: TEMPORARY_ARTIFACT_RETENTION_LIMIT,
        now: startedAt,
      },
    )) as {
      attachments: Array<{
        _id: Doc<'chatAttachments'>['_id'];
        name: string;
        organizationId: string;
        purgeEligibleAt: number;
        storageId: string;
      }>;
      pdfParseJobs: Array<{
        _id: Doc<'pdfParseJobs'>['_id'];
        organizationId: string;
        purgeEligibleAt: number;
        resultStorageId: string;
        sourceStorageId: string;
      }>;
    };

    const dueAttachmentStorageIds = new Set(
      candidates.attachments.map((attachment) => attachment.storageId),
    );
    const groupedCandidates = new Map<string, TemporaryArtifactPurgeCandidate[]>();
    for (const attachment of candidates.attachments) {
      const current = groupedCandidates.get(attachment.organizationId) ?? [];
      current.push({
        _id: attachment._id,
        kind: 'chat_attachment',
        name: attachment.name,
        organizationId: attachment.organizationId,
        purgeEligibleAt: attachment.purgeEligibleAt,
        storageId: attachment.storageId,
      });
      groupedCandidates.set(attachment.organizationId, current);
    }
    for (const job of candidates.pdfParseJobs) {
      const current = groupedCandidates.get(job.organizationId) ?? [];
      current.push({
        _id: job._id,
        kind: 'pdf_parse_result',
        organizationId: job.organizationId,
        purgeEligibleAt: job.purgeEligibleAt,
        resultStorageId: job.resultStorageId,
        sourceStorageId: job.sourceStorageId,
      });
      groupedCandidates.set(job.organizationId, current);
    }

    let totalDeletedCount = 0;
    let totalFailedCount = 0;
    let totalSkippedOnHoldCount = 0;

    for (const [organizationId, organizationCandidates] of groupedCandidates) {
      const accumulator = createOrganizationBatchAccumulator();
      const legalHold = (await ctx.runQuery(
        internal.organizationManagement.getOrganizationLegalHoldInternal,
        {
          organizationId,
        },
      )) as {
        id: Doc<'organizationLegalHolds'>['_id'];
        reason: string;
        status: 'active' | 'released';
      } | null;
      const policies = (await ctx.runQuery(
        internal.organizationManagement.getOrganizationPoliciesInternal,
        {
          organizationId,
        },
      )) as {
        dataRetentionDays: number;
      };

      if (legalHold?.status === 'active') {
        accumulator.skippedOnHoldCount = organizationCandidates.length;
        for (const candidate of organizationCandidates) {
          accumulator.typeCounts[candidate.kind] += 1;
          addSampleId(accumulator, String(candidate._id));
        }
      } else {
        for (const candidate of organizationCandidates) {
          accumulator.typeCounts[candidate.kind] += 1;
          addSampleId(accumulator, String(candidate._id));

          try {
            if (candidate.kind === 'chat_attachment') {
              await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
                storageId: candidate.storageId,
              });
              await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
                attachmentId: candidate._id,
                patch: {
                  errorMessage: 'Attachment content expired per organization retention policy.',
                  extractedTextStorageId: null,
                  purgeEligibleAt: null,
                  status: 'error',
                  updatedAt: Date.now(),
                },
              });
            } else {
              if (!dueAttachmentStorageIds.has(candidate.sourceStorageId)) {
                await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
                  storageId: candidate.resultStorageId,
                });
              }

              const currentJob = (await ctx.runQuery(
                internal.pdfParse.getPdfParseJobByStorageIdInternal,
                {
                  storageId: candidate.sourceStorageId,
                },
              )) as Doc<'pdfParseJobs'> | null;
              if (currentJob) {
                await ctx.runMutation(internal.pdfParse.upsertPdfParseJobInternal, {
                  completedAt: currentJob.completedAt ?? Date.now(),
                  dispatchAttempts: currentJob.dispatchAttempts ?? 0,
                  dispatchErrorMessage: currentJob.dispatchErrorMessage ?? null,
                  errorMessage: 'Parsed PDF result expired per organization retention policy.',
                  organizationId: currentJob.organizationId,
                  parserVersion: currentJob.parserVersion ?? null,
                  processingStartedAt: currentJob.processingStartedAt ?? null,
                  purgeEligibleAt: null,
                  requestedByUserId: currentJob.requestedByUserId,
                  resultStorageId: null,
                  status: 'failed',
                  storageId: currentJob.storageId,
                  updatedAt: Date.now(),
                });
              }
            }

            accumulator.deletedCount += 1;
          } catch (error) {
            accumulator.failedCount += 1;
            accumulator.failureMessages.push(
              `${candidate.kind}:${String(candidate._id)}:${error instanceof Error ? error.message : 'unknown'}`,
            );
          }
        }
      }

      totalDeletedCount += accumulator.deletedCount;
      totalFailedCount += accumulator.failedCount;
      totalSkippedOnHoldCount += accumulator.skippedOnHoldCount;

      const completedAt = Date.now();
      const batchStatus = accumulator.failedCount > 0 ? 'failure' : 'success';
      const policySnapshotJson = JSON.stringify({
        dataRetentionDays: policies.dataRetentionDays,
        legalHoldStatus: legalHold?.status ?? null,
        retentionScope: 'temporary_artifacts_only_v1',
      });
      const detailsJson = JSON.stringify({
        failedMessages: accumulator.failureMessages.slice(0, 20),
        sampleIds: accumulator.sampleIds,
        typeCounts: accumulator.typeCounts,
      });
      const batchId = await ctx.runMutation(
        internal.retention.recordRetentionDeletionBatchInternal,
        {
          completedAt,
          deletedCount: accumulator.deletedCount,
          detailsJson,
          failedCount: accumulator.failedCount,
          jobKind: 'temporary_artifact_purge',
          organizationId,
          policySnapshotJson,
          skippedOnHoldCount: accumulator.skippedOnHoldCount,
          startedAt,
          status: batchStatus,
        },
      );

      if (accumulator.skippedOnHoldCount > 0) {
        await recordSystemAuditEvent(ctx, {
          emitter: 'retention.temporary_artifact_purge',
          eventType: RETENTION_EVENT_TYPES.purgeSkippedOnHold,
          metadata: JSON.stringify({
            batchId,
            reason: legalHold?.reason ?? 'Organization legal hold is active.',
            skippedOnHoldCount: accumulator.skippedOnHoldCount,
          }),
          organizationId,
          outcome: 'success',
          resourceId: String(batchId),
          resourceLabel: 'Temporary artifact purge batch',
          resourceType: 'retention_batch',
          severity: 'info',
          sourceSurface: 'retention.temporary_artifact_purge',
        });
      } else {
        await recordSystemAuditEvent(ctx, {
          emitter: 'retention.temporary_artifact_purge',
          eventType:
            accumulator.failedCount > 0
              ? RETENTION_EVENT_TYPES.purgeFailed
              : RETENTION_EVENT_TYPES.purgeCompleted,
          metadata: JSON.stringify({
            batchId,
            deletedCount: accumulator.deletedCount,
            failedCount: accumulator.failedCount,
          }),
          organizationId,
          outcome: accumulator.failedCount > 0 ? 'failure' : 'success',
          resourceId: String(batchId),
          resourceLabel: 'Temporary artifact purge batch',
          resourceType: 'retention_batch',
          severity: accumulator.failedCount > 0 ? 'warning' : 'info',
          sourceSurface: 'retention.temporary_artifact_purge',
        });
      }
    }

    await ctx.runMutation(internal.securityOps.recordRetentionJob, {
      details: `Temporary artifact purge deleted ${totalDeletedCount}, skipped ${totalSkippedOnHoldCount}, failed ${totalFailedCount}.`,
      jobKind: 'temporary_artifact_purge',
      processedCount: totalDeletedCount,
      status: totalFailedCount > 0 ? 'failure' : 'success',
    });

    return null;
  },
});
