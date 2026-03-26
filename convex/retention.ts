import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { ActionCtx, QueryCtx } from './_generated/server';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { recordSystemAuditEvent } from './lib/auditEmitters';
import {
  buildHoldAwareOperationDecision,
  RETENTION_EVENT_TYPES,
  type HoldAwareOperationDecision,
  type RetentionDeletionJobKind,
  type RetentionResourceType,
} from './lib/retention';

const RETENTION_LIMIT = 128;

type RetentionPurgeCandidate =
  | {
      _id: Doc<'chatThreads'>['_id'];
      kind: 'chat_thread_record_set';
      organizationId: string;
      purgeEligibleAt: number;
      title: string;
    }
  | {
      _id: Doc<'chatAttachments'>['_id'];
      extractedTextStorageId: string | null;
      kind: 'chat_attachment';
      name: string;
      organizationId: string;
      purgeEligibleAt: number;
      storageId: string;
    }
  | {
      _id: Doc<'pdfParseJobs'>['_id'];
      kind: 'pdf_parse_job';
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
    chat_thread_record_set: number;
    pdf_parse_job: number;
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
      chat_thread_record_set: 0,
      pdf_parse_job: 0,
    },
  };
}

function addSampleId(accumulator: OrganizationBatchAccumulator, id: string) {
  if (accumulator.sampleIds.length >= 10) {
    return;
  }
  accumulator.sampleIds.push(id);
}

function buildHoldBlockedMessage(resourceType: RetentionResourceType) {
  switch (resourceType) {
    case 'chat_attachment':
      return 'Organization legal hold is active. Attachment deletion is blocked.';
    case 'chat_thread':
    case 'chat_thread_record_set':
      return 'Organization legal hold is active. Chat deletion is blocked.';
    case 'organization_cleanup':
      return 'Organization legal hold is active. Cleanup is blocked.';
    case 'audit_export':
    case 'directory_export':
    case 'evidence_report_export':
      return 'Organization legal hold is active.';
    case 'chat_run':
    case 'chat_usage_event':
    case 'pdf_parse_job':
    case 'stored_file':
      return 'Organization legal hold is active. Destructive retention work is blocked.';
  }
}

async function resolveHoldAwareDecision(
  ctx: Pick<QueryCtx, 'db'>,
  args: {
    allowExportDuringHold?: boolean;
    operation: HoldAwareOperationDecision['operation'];
    organizationId: string;
    resourceId?: string | null;
    resourceType: HoldAwareOperationDecision['resourceType'];
  },
) {
  const legalHold = await ctx.db
    .query('organizationLegalHolds')
    .withIndex('by_organization_id_and_status', (query) =>
      query.eq('organizationId', args.organizationId).eq('status', 'active'),
    )
    .unique();

  return buildHoldAwareOperationDecision({
    allowExportDuringHold: args.allowExportDuringHold,
    legalHold: legalHold
      ? {
          id: String(legalHold._id),
          reason: legalHold.reason,
          status: legalHold.status,
        }
      : null,
    operation: args.operation,
    resourceId: args.resourceId,
    resourceType: args.resourceType,
  });
}

export const getOrganizationHoldAwareOperationDecisionInternal = internalQuery({
  args: {
    allowExportDuringHold: v.optional(v.boolean()),
    operation: v.union(
      v.literal('delete'),
      v.literal('purge'),
      v.literal('cleanup'),
      v.literal('export'),
    ),
    organizationId: v.string(),
    resourceId: v.optional(v.string()),
    resourceType: v.union(
      v.literal('audit_export'),
      v.literal('chat_attachment'),
      v.literal('chat_run'),
      v.literal('chat_thread'),
      v.literal('chat_thread_record_set'),
      v.literal('chat_usage_event'),
      v.literal('directory_export'),
      v.literal('evidence_report_export'),
      v.literal('organization_cleanup'),
      v.literal('pdf_parse_job'),
      v.literal('stored_file'),
    ),
  },
  returns: v.object({
    allowed: v.boolean(),
    legalHoldActive: v.boolean(),
    legalHoldId: v.union(v.string(), v.null()),
    legalHoldReason: v.union(v.string(), v.null()),
    normalizedLegalHoldReason: v.union(v.string(), v.null()),
    operation: v.union(
      v.literal('delete'),
      v.literal('purge'),
      v.literal('cleanup'),
      v.literal('export'),
    ),
    resourceId: v.union(v.string(), v.null()),
    resourceType: v.union(
      v.literal('audit_export'),
      v.literal('chat_attachment'),
      v.literal('chat_run'),
      v.literal('chat_thread'),
      v.literal('chat_thread_record_set'),
      v.literal('chat_usage_event'),
      v.literal('directory_export'),
      v.literal('evidence_report_export'),
      v.literal('organization_cleanup'),
      v.literal('pdf_parse_job'),
      v.literal('stored_file'),
    ),
    retentionScopeVersion: v.union(
      v.literal('temporary_artifacts_only_v1'),
      v.literal('full_phi_record_set_v2'),
    ),
  }),
  handler: async (ctx, args) => await resolveHoldAwareDecision(ctx, args),
});

export const assertOrganizationHoldAllowsOperationInternal = internalQuery({
  args: {
    allowExportDuringHold: v.optional(v.boolean()),
    operation: v.union(
      v.literal('delete'),
      v.literal('purge'),
      v.literal('cleanup'),
      v.literal('export'),
    ),
    organizationId: v.string(),
    resourceId: v.optional(v.string()),
    resourceType: v.union(
      v.literal('audit_export'),
      v.literal('chat_attachment'),
      v.literal('chat_run'),
      v.literal('chat_thread'),
      v.literal('chat_thread_record_set'),
      v.literal('chat_usage_event'),
      v.literal('directory_export'),
      v.literal('evidence_report_export'),
      v.literal('organization_cleanup'),
      v.literal('pdf_parse_job'),
      v.literal('stored_file'),
    ),
  },
  returns: v.object({
    allowed: v.boolean(),
    legalHoldActive: v.boolean(),
    legalHoldId: v.union(v.string(), v.null()),
    legalHoldReason: v.union(v.string(), v.null()),
    normalizedLegalHoldReason: v.union(v.string(), v.null()),
    operation: v.union(
      v.literal('delete'),
      v.literal('purge'),
      v.literal('cleanup'),
      v.literal('export'),
    ),
    resourceId: v.union(v.string(), v.null()),
    resourceType: v.union(
      v.literal('audit_export'),
      v.literal('chat_attachment'),
      v.literal('chat_run'),
      v.literal('chat_thread'),
      v.literal('chat_thread_record_set'),
      v.literal('chat_usage_event'),
      v.literal('directory_export'),
      v.literal('evidence_report_export'),
      v.literal('organization_cleanup'),
      v.literal('pdf_parse_job'),
      v.literal('stored_file'),
    ),
    retentionScopeVersion: v.union(
      v.literal('temporary_artifacts_only_v1'),
      v.literal('full_phi_record_set_v2'),
    ),
  }),
  handler: async (ctx, args) => {
    const decision = await resolveHoldAwareDecision(ctx, args);

    if (!decision.allowed) {
      throw new ConvexError(buildHoldBlockedMessage(args.resourceType));
    }

    return decision;
  },
});

export const listPurgeEligibleChatThreadsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id('chatThreads'),
      organizationId: v.string(),
      purgeEligibleAt: v.number(),
      title: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? RETENTION_LIMIT, 512));
    const threads = await ctx.db
      .query('chatThreads')
      .withIndex('by_purgeEligibleAt', (query) => query.lt('purgeEligibleAt', args.now))
      .take(limit);

    return threads
      .filter((thread) => !thread.deletedAt && typeof thread.purgeEligibleAt === 'number')
      .map((thread) => ({
        _id: thread._id,
        organizationId: thread.organizationId,
        purgeEligibleAt: thread.purgeEligibleAt ?? args.now,
        title: thread.title,
      }));
  },
});

export const listPurgeEligibleStandaloneAttachmentsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id('chatAttachments'),
      extractedTextStorageId: v.union(v.string(), v.null()),
      name: v.string(),
      organizationId: v.string(),
      purgeEligibleAt: v.number(),
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? RETENTION_LIMIT, 512));
    const attachments = await ctx.db
      .query('chatAttachments')
      .withIndex('by_purgeEligibleAt', (query) => query.lt('purgeEligibleAt', args.now))
      .take(limit);

    return attachments
      .filter(
        (attachment) =>
          !attachment.deletedAt &&
          attachment.threadId === undefined &&
          typeof attachment.purgeEligibleAt === 'number',
      )
      .map((attachment) => ({
        _id: attachment._id,
        extractedTextStorageId: attachment.extractedTextStorageId ?? null,
        name: attachment.name,
        organizationId: attachment.organizationId,
        purgeEligibleAt: attachment.purgeEligibleAt ?? args.now,
        storageId: attachment.storageId,
      }));
  },
});

export const listPurgeEligiblePdfParseJobsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id('pdfParseJobs'),
      organizationId: v.string(),
      purgeEligibleAt: v.number(),
      resultStorageId: v.string(),
      sourceStorageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? RETENTION_LIMIT, 512));
    const jobs = await ctx.db
      .query('pdfParseJobs')
      .withIndex('by_purgeEligibleAt', (query) => query.lt('purgeEligibleAt', args.now))
      .take(limit);

    return jobs
      .filter(
        (job) => typeof job.purgeEligibleAt === 'number' && typeof job.resultStorageId === 'string',
      )
      .map((job) => ({
        _id: job._id,
        organizationId: job.organizationId,
        purgeEligibleAt: job.purgeEligibleAt ?? args.now,
        resultStorageId: job.resultStorageId as string,
        sourceStorageId: job.storageId,
      }));
  },
});

export const listThreadAttachmentsForRetentionInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.array(
    v.object({
      _id: v.id('chatAttachments'),
      extractedTextStorageId: v.union(v.string(), v.null()),
      name: v.string(),
      organizationId: v.string(),
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const attachments = await ctx.db
      .query('chatAttachments')
      .withIndex('by_threadId_and_createdAt', (query) => query.eq('threadId', args.threadId))
      .collect();

    return attachments
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => ({
        _id: attachment._id,
        extractedTextStorageId: attachment.extractedTextStorageId ?? null,
        name: attachment.name,
        organizationId: attachment.organizationId,
        storageId: attachment.storageId,
      }));
  },
});

export const recordRetentionDeletionBatchInternal = internalMutation({
  args: {
    completedAt: v.number(),
    deletedCount: v.number(),
    detailsJson: v.string(),
    failedCount: v.number(),
    jobKind: v.union(v.literal('temporary_artifact_purge'), v.literal('phi_record_purge')),
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

async function deleteStoredFileOnce(
  ctx: ActionCtx,
  deletedStorageIds: Set<string>,
  storageId: string | null | undefined,
) {
  if (!storageId || deletedStorageIds.has(storageId)) {
    return;
  }
  deletedStorageIds.add(storageId);
  await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
    storageId,
  });
}

async function deletePdfParseJobArtifactsForSourceStorageId(
  ctx: ActionCtx,
  args: {
    deletedStorageIds: Set<string>;
    handledSourceStorageIds: Set<string>;
    sourceStorageId: string;
  },
) {
  const job = (await ctx.runQuery(internal.pdfParse.getPdfParseJobByStorageIdInternal, {
    storageId: args.sourceStorageId,
  })) as Doc<'pdfParseJobs'> | null;
  if (!job) {
    return;
  }

  await deleteStoredFileOnce(ctx, args.deletedStorageIds, job.resultStorageId ?? null);

  if (!args.handledSourceStorageIds.has(job.storageId)) {
    const attachment = (await ctx.runQuery(internal.agentChat.getAttachmentByStorageIdInternal, {
      storageId: job.storageId,
    })) as Doc<'chatAttachments'> | null;
    if (!attachment) {
      await deleteStoredFileOnce(ctx, args.deletedStorageIds, job.storageId);
    }
  }

  await ctx.runMutation(internal.pdfParse.deletePdfParseJobInternal, {
    jobId: job._id,
  });
}

async function purgeThreadRecordSet(
  ctx: ActionCtx,
  args: {
    deletedStorageIds: Set<string>;
    handledSourceStorageIds: Set<string>;
    threadId: Doc<'chatThreads'>['_id'];
  },
) {
  const attachments = (await ctx.runQuery(
    internal.retention.listThreadAttachmentsForRetentionInternal,
    {
      threadId: args.threadId,
    },
  )) as Array<{
    _id: Doc<'chatAttachments'>['_id'];
    extractedTextStorageId: string | null;
    name: string;
    organizationId: string;
    storageId: string;
  }>;

  for (const attachment of attachments) {
    args.handledSourceStorageIds.add(attachment.storageId);
    await deleteStoredFileOnce(ctx, args.deletedStorageIds, attachment.storageId);
    await deleteStoredFileOnce(ctx, args.deletedStorageIds, attachment.extractedTextStorageId);
    await deletePdfParseJobArtifactsForSourceStorageId(ctx, {
      deletedStorageIds: args.deletedStorageIds,
      handledSourceStorageIds: args.handledSourceStorageIds,
      sourceStorageId: attachment.storageId,
    });
  }

  await ctx.runMutation(internal.agentChat.deleteThreadForCleanupInternal, {
    threadId: args.threadId,
  });
}

async function purgeStandaloneAttachment(
  ctx: ActionCtx,
  args: {
    attachmentId: Doc<'chatAttachments'>['_id'];
    deletedStorageIds: Set<string>;
    extractedTextStorageId: string | null;
    handledSourceStorageIds: Set<string>;
    storageId: string;
  },
) {
  args.handledSourceStorageIds.add(args.storageId);
  await deleteStoredFileOnce(ctx, args.deletedStorageIds, args.storageId);
  await deleteStoredFileOnce(ctx, args.deletedStorageIds, args.extractedTextStorageId);
  await deletePdfParseJobArtifactsForSourceStorageId(ctx, {
    deletedStorageIds: args.deletedStorageIds,
    handledSourceStorageIds: args.handledSourceStorageIds,
    sourceStorageId: args.storageId,
  });
  await ctx.runMutation(internal.agentChat.deleteAttachmentStorageInternal, {
    attachmentId: args.attachmentId,
  });
}

function buildPolicySnapshotJson(args: {
  dataRetentionDays: number;
  decision: HoldAwareOperationDecision;
}) {
  return JSON.stringify({
    dataRetentionDays: args.dataRetentionDays,
    legalHoldId: args.decision.legalHoldId,
    legalHoldStatus: args.decision.legalHoldActive ? 'active' : null,
    retentionScope: args.decision.retentionScopeVersion,
  });
}

function buildBatchDetailsJson(accumulator: OrganizationBatchAccumulator) {
  return JSON.stringify({
    failedMessages: accumulator.failureMessages.slice(0, 20),
    sampleIds: accumulator.sampleIds,
    typeCounts: accumulator.typeCounts,
  });
}

function buildGroupedCandidates(args: {
  attachments: Array<{
    _id: Doc<'chatAttachments'>['_id'];
    extractedTextStorageId: string | null;
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
  threads: Array<{
    _id: Doc<'chatThreads'>['_id'];
    organizationId: string;
    purgeEligibleAt: number;
    title: string;
  }>;
}) {
  const groupedCandidates = new Map<string, RetentionPurgeCandidate[]>();

  for (const thread of args.threads) {
    const current = groupedCandidates.get(thread.organizationId) ?? [];
    current.push({
      _id: thread._id,
      kind: 'chat_thread_record_set',
      organizationId: thread.organizationId,
      purgeEligibleAt: thread.purgeEligibleAt,
      title: thread.title,
    });
    groupedCandidates.set(thread.organizationId, current);
  }

  for (const attachment of args.attachments) {
    const current = groupedCandidates.get(attachment.organizationId) ?? [];
    current.push({
      _id: attachment._id,
      extractedTextStorageId: attachment.extractedTextStorageId,
      kind: 'chat_attachment',
      name: attachment.name,
      organizationId: attachment.organizationId,
      purgeEligibleAt: attachment.purgeEligibleAt,
      storageId: attachment.storageId,
    });
    groupedCandidates.set(attachment.organizationId, current);
  }

  for (const job of args.pdfParseJobs) {
    const current = groupedCandidates.get(job.organizationId) ?? [];
    current.push({
      _id: job._id,
      kind: 'pdf_parse_job',
      organizationId: job.organizationId,
      purgeEligibleAt: job.purgeEligibleAt,
      resultStorageId: job.resultStorageId,
      sourceStorageId: job.sourceStorageId,
    });
    groupedCandidates.set(job.organizationId, current);
  }

  return groupedCandidates;
}

export const purgeExpiredTemporaryArtifacts = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const startedAt = Date.now();
    const [threads, attachments, pdfParseJobs] = (await Promise.all([
      ctx.runQuery(internal.retention.listPurgeEligibleChatThreadsInternal, {
        limit: RETENTION_LIMIT,
        now: startedAt,
      }),
      ctx.runQuery(internal.retention.listPurgeEligibleStandaloneAttachmentsInternal, {
        limit: RETENTION_LIMIT,
        now: startedAt,
      }),
      ctx.runQuery(internal.retention.listPurgeEligiblePdfParseJobsInternal, {
        limit: RETENTION_LIMIT,
        now: startedAt,
      }),
    ])) as [
      Array<{
        _id: Doc<'chatThreads'>['_id'];
        organizationId: string;
        purgeEligibleAt: number;
        title: string;
      }>,
      Array<{
        _id: Doc<'chatAttachments'>['_id'];
        extractedTextStorageId: string | null;
        name: string;
        organizationId: string;
        purgeEligibleAt: number;
        storageId: string;
      }>,
      Array<{
        _id: Doc<'pdfParseJobs'>['_id'];
        organizationId: string;
        purgeEligibleAt: number;
        resultStorageId: string;
        sourceStorageId: string;
      }>,
    ];

    const groupedCandidates = buildGroupedCandidates({
      attachments,
      pdfParseJobs,
      threads,
    });
    const handledSourceStorageIds = new Set<string>();
    let totalDeletedCount = 0;
    let totalFailedCount = 0;
    let totalSkippedOnHoldCount = 0;

    for (const [organizationId, organizationCandidates] of groupedCandidates) {
      const accumulator = createOrganizationBatchAccumulator();
      const deletedStorageIds = new Set<string>();
      const decision = (await ctx.runQuery(
        internal.retention.getOrganizationHoldAwareOperationDecisionInternal,
        {
          operation: 'purge',
          organizationId,
          resourceType: 'chat_thread_record_set',
        },
      )) as HoldAwareOperationDecision;
      const policies = (await ctx.runQuery(
        internal.organizationManagement.getOrganizationPoliciesInternal,
        {
          organizationId,
        },
      )) as {
        dataRetentionDays: number;
      };

      if (!decision.allowed) {
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
            if (candidate.kind === 'chat_thread_record_set') {
              await purgeThreadRecordSet(ctx, {
                deletedStorageIds,
                handledSourceStorageIds,
                threadId: candidate._id,
              });
            } else if (candidate.kind === 'chat_attachment') {
              await purgeStandaloneAttachment(ctx, {
                attachmentId: candidate._id,
                deletedStorageIds,
                extractedTextStorageId: candidate.extractedTextStorageId,
                handledSourceStorageIds,
                storageId: candidate.storageId,
              });
            } else {
              if (handledSourceStorageIds.has(candidate.sourceStorageId)) {
                continue;
              }
              await deletePdfParseJobArtifactsForSourceStorageId(ctx, {
                deletedStorageIds,
                handledSourceStorageIds,
                sourceStorageId: candidate.sourceStorageId,
              });
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
      const batchId = await ctx.runMutation(
        internal.retention.recordRetentionDeletionBatchInternal,
        {
          completedAt,
          deletedCount: accumulator.deletedCount,
          detailsJson: buildBatchDetailsJson(accumulator),
          failedCount: accumulator.failedCount,
          jobKind: 'phi_record_purge' as RetentionDeletionJobKind,
          organizationId,
          policySnapshotJson: buildPolicySnapshotJson({
            dataRetentionDays: policies.dataRetentionDays,
            decision,
          }),
          skippedOnHoldCount: accumulator.skippedOnHoldCount,
          startedAt,
          status: batchStatus,
        },
      );

      if (accumulator.skippedOnHoldCount > 0) {
        await recordSystemAuditEvent(ctx, {
          emitter: 'retention.phi_record_purge',
          eventType: RETENTION_EVENT_TYPES.purgeSkippedOnHold,
          metadata: JSON.stringify({
            batchId,
            reason: decision.legalHoldReason ?? 'Organization legal hold is active.',
            skippedOnHoldCount: accumulator.skippedOnHoldCount,
          }),
          organizationId,
          outcome: 'success',
          resourceId: String(batchId),
          resourceLabel: 'PHI record retention batch',
          resourceType: 'retention_batch',
          severity: 'info',
          sourceSurface: 'retention.phi_record_purge',
        });
      } else {
        await recordSystemAuditEvent(ctx, {
          emitter: 'retention.phi_record_purge',
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
          resourceLabel: 'PHI record retention batch',
          resourceType: 'retention_batch',
          severity: accumulator.failedCount > 0 ? 'warning' : 'info',
          sourceSurface: 'retention.phi_record_purge',
        });
      }
    }

    await ctx.runMutation(internal.securityOps.recordRetentionJob, {
      details: `PHI record purge deleted ${totalDeletedCount}, skipped ${totalSkippedOnHoldCount}, failed ${totalFailedCount}.`,
      jobKind: 'phi_record_purge',
      processedCount: totalDeletedCount,
      status: totalFailedCount > 0 ? 'failure' : 'success',
    });

    return null;
  },
});
