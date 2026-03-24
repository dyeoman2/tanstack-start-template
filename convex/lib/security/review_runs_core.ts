import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { ANNUAL_REVIEW_TASK_BLUEPRINTS } from './securityReviewConfig';
import {
  addDays,
  deleteSecurityRelationships,
  getSecurityRelationshipObjectTypeFromEvidenceSourceType,
  getSecurityRelationshipObjectTypeFromSourceRecordType,
  getSecurityScopeFields,
  upsertSecurityRelationship,
} from './core';
import {
  listReviewTaskEvidenceLinksBySource,
  recordSecurityControlEvidenceAuditEvent,
} from './operations_core';
import {
  buildReviewRunSnapshot,
  buildReviewRunTaskCounts,
  deriveReviewRunStatus,
  listReviewTasksByRunId,
  syncAnnualPolicyReviewTasks,
  syncReviewRunStatus,
  type ReviewRunDoc,
  type ReviewTaskDoc,
  upsertAnnualReviewTasks,
} from './review_runs_task_sync';
import {
  buildEvidenceReportDetail,
  buildReviewRunDetail,
  buildReviewRunSummary,
  getAutomationEvidenceLabel,
} from './review_runs_read_models';
import {
  buildVendorWorkspaceRows,
  runSecurityWorkspaceMigration as runSecurityWorkspaceMigrationInternal,
  syncSecurityVendorWorkspaceRecords,
} from './review_runs_migrations';

function shouldMaterializeReviewOutcomeEvidence(args: {
  mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
  status: 'ready' | 'completed' | 'exception' | 'blocked';
  satisfiedAt: number | null;
  satisfiedThroughAt: number | null;
}) {
  if (typeof args.satisfiedAt !== 'number' || typeof args.satisfiedThroughAt !== 'number') {
    return false;
  }
  if (args.status === 'completed') {
    return true;
  }
  return args.status === 'exception' && args.mode === 'exception';
}

function getReviewOutcomeEvidenceMetadata(args: {
  mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
  task: ReviewTaskDoc;
}) {
  switch (args.mode) {
    case 'automated_check':
      return {
        evidenceType: 'automated_review_result' as const,
        source: 'automated_review_result' as const,
        sufficiency: 'sufficient' as const,
        title: `${args.task.title} result`,
      };
    case 'attestation':
      return {
        evidenceType: 'review_attestation' as const,
        source: 'review_attestation' as const,
        sufficiency: 'sufficient' as const,
        title: `${args.task.title} attestation`,
      };
    case 'document_upload':
      return {
        evidenceType: 'review_document' as const,
        source: 'review_document' as const,
        sufficiency: 'sufficient' as const,
        title: `${args.task.title} document`,
      };
    case 'follow_up':
      return {
        evidenceType: 'follow_up_resolution' as const,
        source: 'follow_up_resolution' as const,
        sufficiency: 'sufficient' as const,
        title: `${args.task.title} follow-up`,
      };
    case 'exception':
      return {
        evidenceType: 'exception_record' as const,
        source: 'review_exception' as const,
        sufficiency: 'partial' as const,
        title: `${args.task.title} exception`,
      };
  }
}

async function clearChecklistReviewOutcomeEvidence(
  ctx: MutationCtx,
  task: ReviewTaskDoc,
  args: {
    clearedAt: number;
    clearedByUserId: string;
  },
) {
  const now = Date.now();
  await Promise.all(
    task.controlLinks.map(async (link) => {
      const existingEvidence = await ctx.db
        .query('securityControlEvidence')
        .withIndex('by_internal_control_id_and_item_id', (q) =>
          q.eq('internalControlId', link.internalControlId).eq('itemId', link.itemId),
        )
        .collect();

      await Promise.all(
        existingEvidence
          .filter(
            (entry) =>
              entry.reviewOriginReviewTaskId === task._id &&
              (entry.lifecycleStatus ?? 'active') === 'active',
          )
          .map(async (entry) => {
            await ctx.db.patch(entry._id, {
              archivedAt: now,
              archivedByUserId: args.clearedByUserId,
              lifecycleStatus: 'superseded',
              updatedAt: now,
            });
            await recordSecurityControlEvidenceAuditEvent(ctx, {
              actorUserId: args.clearedByUserId,
              eventType: 'security_control_evidence_archived',
              evidenceId: entry._id,
              evidenceTitle: entry.title,
              evidenceType: entry.evidenceType,
              internalControlId: entry.internalControlId,
              itemId: entry.itemId,
              lifecycleStatus: 'superseded',
              organizationId: undefined,
              replacedByEvidenceId: undefined,
              reviewStatus: entry.reviewStatus ?? null,
            });
          }),
      );
    }),
  );
}

async function materializeReviewTaskSatisfactionEvidence(
  ctx: MutationCtx,
  task: ReviewTaskDoc,
  args: {
    actorUserId: string;
    latestAttestationId?: Id<'reviewAttestations'>;
    mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
    note?: string;
    resultId: Id<'reviewTaskResults'>;
    satisfiedAt: number;
    satisfiedThroughAt: number;
  },
) {
  const now = Date.now();
  const metadata = getReviewOutcomeEvidenceMetadata({
    mode: args.mode,
    task,
  });
  const [taskLinks, attestation] = await Promise.all([
    ctx.db
      .query('reviewTaskEvidenceLinks')
      .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', task._id))
      .collect(),
    args.latestAttestationId ? ctx.db.get(args.latestAttestationId) : Promise.resolve(null),
  ]);
  const primarySource =
    taskLinks.find((entry) => entry.role === 'primary') ??
    taskLinks.find((entry) => entry.role === 'supporting') ??
    taskLinks[0] ??
    null;

  await Promise.all(
    task.controlLinks.map(async (link) => {
      const existingEvidence = await ctx.db
        .query('securityControlEvidence')
        .withIndex('by_internal_control_id_and_item_id', (q) =>
          q.eq('internalControlId', link.internalControlId).eq('itemId', link.itemId),
        )
        .collect();
      const activeArtifacts = existingEvidence.filter(
        (entry) =>
          entry.reviewOriginReviewTaskId === task._id &&
          (entry.lifecycleStatus ?? 'active') === 'active',
      );

      const evidenceId = await ctx.db.insert('securityControlEvidence', {
        ...getSecurityScopeFields(),
        createdAt: now,
        description:
          args.note?.trim() ||
          attestation?.statementText ||
          `Review outcome recorded from ${task.title}.`,
        evidenceDate: args.satisfiedAt,
        evidenceType: metadata.evidenceType,
        fileName: undefined,
        itemId: link.itemId,
        internalControlId: link.internalControlId,
        lifecycleStatus: 'active',
        mimeType: undefined,
        renewedFromEvidenceId: undefined,
        replacedByEvidenceId: undefined,
        reviewDueIntervalMonths: undefined,
        reviewOriginReviewAttestationId: args.latestAttestationId,
        reviewOriginReviewRunId: task.reviewRunId,
        reviewOriginReviewTaskId: task._id,
        reviewOriginReviewTaskResultId: args.resultId,
        reviewOriginSourceId: primarySource?.sourceId,
        reviewOriginSourceLabel: primarySource?.sourceLabel,
        reviewOriginSourceType: primarySource?.sourceType,
        reviewStatus: 'reviewed',
        reviewedAt: args.satisfiedAt,
        reviewedByUserId: args.actorUserId,
        validUntil: args.satisfiedThroughAt,
        sizeBytes: undefined,
        source: metadata.source,
        storageId: undefined,
        sufficiency: metadata.sufficiency,
        title:
          args.mode === 'document_upload' && attestation?.documentLabel
            ? attestation.documentLabel
            : metadata.title,
        updatedAt: now,
        uploadedByUserId: args.actorUserId,
        url:
          args.mode === 'document_upload'
            ? attestation?.documentUrl
            : primarySource?.sourceType === 'external_document'
              ? primarySource.sourceId
              : undefined,
      });

      await Promise.all(
        activeArtifacts.map(async (entry) => {
          await ctx.db.patch(entry._id, {
            archivedAt: now,
            archivedByUserId: args.actorUserId,
            lifecycleStatus: 'superseded',
            replacedByEvidenceId: evidenceId,
            updatedAt: now,
          });
          await recordSecurityControlEvidenceAuditEvent(ctx, {
            actorUserId: args.actorUserId,
            eventType: 'security_control_evidence_archived',
            evidenceId: entry._id,
            evidenceTitle: entry.title,
            evidenceType: entry.evidenceType,
            internalControlId: entry.internalControlId,
            itemId: entry.itemId,
            lifecycleStatus: 'superseded',
            organizationId: undefined,
            replacedByEvidenceId: evidenceId,
            reviewStatus: entry.reviewStatus ?? null,
          });
        }),
      );

      await recordSecurityControlEvidenceAuditEvent(ctx, {
        actorUserId: args.actorUserId,
        eventType: 'security_control_evidence_created',
        evidenceId,
        evidenceTitle:
          args.mode === 'document_upload' && attestation?.documentLabel
            ? attestation.documentLabel
            : metadata.title,
        evidenceType: metadata.evidenceType,
        internalControlId: link.internalControlId,
        itemId: link.itemId,
        lifecycleStatus: 'active',
        organizationId: undefined,
        reviewStatus: 'reviewed',
      });
    }),
  );
}

async function removeReviewTaskEvidenceLinkRelationships(
  ctx: MutationCtx,
  args: {
    link: Doc<'reviewTaskEvidenceLinks'>;
    reviewTask: ReviewTaskDoc;
  },
) {
  const { link, reviewTask } = args;
  const sourceObjectType = getSecurityRelationshipObjectTypeFromEvidenceSourceType(link.sourceType);
  if (!sourceObjectType) {
    return;
  }

  const taskLinks = await ctx.db
    .query('reviewTaskEvidenceLinks')
    .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', reviewTask._id))
    .collect();
  const hasSameSourceOnTask = taskLinks.some(
    (entry) =>
      entry._id !== link._id &&
      entry.sourceId === link.sourceId &&
      entry.sourceType === link.sourceType,
  );

  if (!hasSameSourceOnTask) {
    await deleteSecurityRelationships(ctx, {
      fromId: reviewTask._id,
      fromType: 'review_task',
      relationshipType: link.sourceType === 'evidence_report' ? 'satisfies' : 'supports',
      toId: link.sourceId,
      toType: sourceObjectType,
    });
    await deleteSecurityRelationships(ctx, {
      fromId: link.sourceId,
      fromType: sourceObjectType,
      relationshipType: 'supports',
      toId: reviewTask._id,
      toType: 'review_task',
    });
  }

  if (link.sourceType !== 'evidence_report' && link.sourceType !== 'vendor') {
    return;
  }

  const sourceLinks = await listReviewTaskEvidenceLinksBySource(ctx, {
    sourceId: link.sourceId,
    sourceType: link.sourceType,
  });
  const otherLinkedTasks = await Promise.all(
    sourceLinks
      .filter((entry) => entry._id !== link._id)
      .map(async (entry) => await ctx.db.get(entry.reviewTaskId)),
  );
  const remainingControlLinkKeys = new Set(
    otherLinkedTasks
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .flatMap((task) =>
        task.controlLinks.map(
          (controlLink) => `${controlLink.internalControlId}:${controlLink.itemId}`,
        ),
      ),
  );

  await Promise.all(
    reviewTask.controlLinks.map(async (controlLink) => {
      const controlKey = `${controlLink.internalControlId}:${controlLink.itemId}`;
      if (remainingControlLinkKeys.has(controlKey)) {
        return;
      }

      if (link.sourceType === 'evidence_report') {
        await deleteSecurityRelationships(ctx, {
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'has_report',
          toId: link.sourceId,
          toType: 'evidence_report',
        });
        await deleteSecurityRelationships(ctx, {
          fromId: `${controlLink.internalControlId}:${controlLink.itemId}`,
          fromType: 'checklist_item',
          relationshipType: 'has_report',
          toId: link.sourceId,
          toType: 'evidence_report',
        });
        return;
      }

      await deleteSecurityRelationships(ctx, {
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_vendor',
        toId: link.sourceId,
        toType: 'vendor',
      });
    }),
  );
}

async function applyReviewTaskState(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    mode: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up' | 'exception';
    note?: string;
    reviewTaskId: Id<'reviewTasks'>;
    satisfiedAt?: number | null;
    satisfiedThroughAt?: number | null;
    status: 'ready' | 'completed' | 'exception' | 'blocked';
    resultType:
      | 'automated_check'
      | 'attested'
      | 'document_linked'
      | 'exception_marked'
      | 'follow_up_opened'
      | 'resolved';
    latestAttestationId?: Id<'reviewAttestations'>;
  },
) {
  const task = await ctx.db.get(args.reviewTaskId);
  if (!task) {
    throw new Error('Review task not found.');
  }
  const now = Date.now();
  const trimmedNote = args.note?.trim() || undefined;
  const resultId = await ctx.db.insert('reviewTaskResults', {
    ...getSecurityScopeFields(),
    actorUserId: args.actorUserId,
    createdAt: now,
    note: trimmedNote,
    resultType: args.resultType,
    reviewRunId: task.reviewRunId,
    reviewTaskId: task._id,
    statusAfter: args.status,
  });

  await ctx.db.patch(task._id, {
    latestAttestationId: args.latestAttestationId,
    latestNote: trimmedNote,
    latestResultId: resultId,
    satisfiedAt: args.satisfiedAt ?? undefined,
    satisfiedThroughAt: args.satisfiedThroughAt ?? undefined,
    status: args.status,
    updatedAt: now,
  });

  if (
    shouldMaterializeReviewOutcomeEvidence({
      mode: args.mode,
      satisfiedAt: args.satisfiedAt ?? null,
      satisfiedThroughAt: args.satisfiedThroughAt ?? null,
      status: args.status,
    })
  ) {
    await materializeReviewTaskSatisfactionEvidence(ctx, task, {
      actorUserId: args.actorUserId,
      latestAttestationId: args.latestAttestationId,
      mode: args.mode,
      note: args.note,
      resultId,
      satisfiedAt: args.satisfiedAt as number,
      satisfiedThroughAt: args.satisfiedThroughAt as number,
    });
  } else {
    await clearChecklistReviewOutcomeEvidence(ctx, task, {
      clearedAt: now,
      clearedByUserId: args.actorUserId,
    });
  }

  await syncReviewRunStatus(ctx, task.reviewRunId);
}

async function upsertReviewTaskEvidenceLinkRecord(
  ctx: MutationCtx,
  args: {
    freshAt?: number;
    linkedByUserId?: string;
    reviewRunId: Id<'reviewRuns'>;
    reviewTaskId: Id<'reviewTasks'>;
    role: 'primary' | 'supporting' | 'blocking';
    sourceId: string;
    sourceLabel: string;
    sourceType:
      | 'security_control_evidence'
      | 'evidence_report'
      | 'security_finding'
      | 'backup_verification_report'
      | 'external_document'
      | 'review_task'
      | 'vendor';
  },
) {
  const now = Date.now();
  const task = await ctx.db.get(args.reviewTaskId);
  if (!task) {
    throw new Error('Review task not found.');
  }
  const existing = (
    await ctx.db
      .query('reviewTaskEvidenceLinks')
      .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', args.reviewTaskId))
      .collect()
  ).find(
    (link) =>
      link.sourceId === args.sourceId &&
      link.sourceType === args.sourceType &&
      link.role === args.role,
  );

  if (existing) {
    await ctx.db.patch(existing._id, {
      freshAt: args.freshAt,
      linkedAt: now,
      linkedByUserId: args.linkedByUserId,
      sourceLabel: args.sourceLabel,
    });
    const sourceObjectType = getSecurityRelationshipObjectTypeFromEvidenceSourceType(
      args.sourceType,
    );
    if (sourceObjectType) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: args.linkedByUserId ?? 'system:security-graph',
        fromId: task._id,
        fromType: 'review_task',
        relationshipType: args.sourceType === 'evidence_report' ? 'satisfies' : 'supports',
        toId: args.sourceId,
        toType: sourceObjectType,
      });
      await upsertSecurityRelationship(ctx, {
        createdByUserId: args.linkedByUserId ?? 'system:security-graph',
        fromId: args.sourceId,
        fromType: sourceObjectType,
        relationshipType: 'supports',
        toId: task._id,
        toType: 'review_task',
      });
      for (const controlLink of task.controlLinks) {
        if (args.sourceType === 'evidence_report') {
          await upsertSecurityRelationship(ctx, {
            createdByUserId: args.linkedByUserId ?? 'system:security-graph',
            fromId: controlLink.internalControlId,
            fromType: 'control',
            relationshipType: 'has_report',
            toId: args.sourceId,
            toType: 'evidence_report',
          });
          await upsertSecurityRelationship(ctx, {
            createdByUserId: args.linkedByUserId ?? 'system:security-graph',
            fromId: `${controlLink.internalControlId}:${controlLink.itemId}`,
            fromType: 'checklist_item',
            relationshipType: 'has_report',
            toId: args.sourceId,
            toType: 'evidence_report',
          });
        }
        if (args.sourceType === 'vendor') {
          await upsertSecurityRelationship(ctx, {
            createdByUserId: args.linkedByUserId ?? 'system:security-graph',
            fromId: controlLink.internalControlId,
            fromType: 'control',
            relationshipType: 'tracks_vendor',
            toId: args.sourceId,
            toType: 'vendor',
          });
        }
      }
    }
    return existing._id;
  }

  const linkId = await ctx.db.insert('reviewTaskEvidenceLinks', {
    ...getSecurityScopeFields(),
    freshAt: args.freshAt,
    linkedAt: now,
    linkedByUserId: args.linkedByUserId,
    reviewRunId: args.reviewRunId,
    reviewTaskId: args.reviewTaskId,
    role: args.role,
    sourceId: args.sourceId,
    sourceLabel: args.sourceLabel,
    sourceType: args.sourceType,
  });
  const sourceObjectType = getSecurityRelationshipObjectTypeFromEvidenceSourceType(args.sourceType);
  if (sourceObjectType) {
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.linkedByUserId ?? 'system:security-graph',
      fromId: task._id,
      fromType: 'review_task',
      relationshipType: args.sourceType === 'evidence_report' ? 'satisfies' : 'supports',
      toId: args.sourceId,
      toType: sourceObjectType,
    });
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.linkedByUserId ?? 'system:security-graph',
      fromId: args.sourceId,
      fromType: sourceObjectType,
      relationshipType: 'supports',
      toId: task._id,
      toType: 'review_task',
    });
    for (const controlLink of task.controlLinks) {
      if (args.sourceType === 'evidence_report') {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: args.linkedByUserId ?? 'system:security-graph',
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'has_report',
          toId: args.sourceId,
          toType: 'evidence_report',
        });
        await upsertSecurityRelationship(ctx, {
          createdByUserId: args.linkedByUserId ?? 'system:security-graph',
          fromId: `${controlLink.internalControlId}:${controlLink.itemId}`,
          fromType: 'checklist_item',
          relationshipType: 'has_report',
          toId: args.sourceId,
          toType: 'evidence_report',
        });
      }
      if (args.sourceType === 'vendor') {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: args.linkedByUserId ?? 'system:security-graph',
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'tracks_vendor',
          toId: args.sourceId,
          toType: 'vendor',
        });
      }
    }
  }
  return linkId;
}

async function clearReviewTaskEvidenceLinksBySourceType(
  ctx: MutationCtx,
  reviewTaskId: Id<'reviewTasks'>,
  sourceTypes: Array<
    | 'security_control_evidence'
    | 'evidence_report'
    | 'security_finding'
    | 'backup_verification_report'
    | 'external_document'
    | 'review_task'
    | 'vendor'
  >,
) {
  if (sourceTypes.length === 0) {
    return;
  }

  const reviewTask = await ctx.db.get(reviewTaskId);
  if (!reviewTask) {
    throw new Error('Review task not found.');
  }

  const existingLinks = await ctx.db
    .query('reviewTaskEvidenceLinks')
    .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', reviewTaskId))
    .collect();

  for (const link of existingLinks.filter((entry) => sourceTypes.includes(entry.sourceType))) {
    await removeReviewTaskEvidenceLinkRelationships(ctx, {
      link,
      reviewTask,
    });
    await ctx.db.delete(link._id);
  }
}

async function createTriggeredReviewRunRecord(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    controlLinks?: Array<{ internalControlId: string; itemId: string }>;
    dedupeKey?: string;
    sourceRecordId?: string;
    sourceRecordType?: string;
    sourceLink?: {
      freshAt?: number;
      sourceId: string;
      sourceLabel: string;
      sourceType:
        | 'security_control_evidence'
        | 'evidence_report'
        | 'security_finding'
        | 'backup_verification_report'
        | 'external_document'
        | 'review_task'
        | 'vendor';
    };
    title: string;
    triggerType: string;
  },
) {
  const existing = args.dedupeKey
    ? await ctx.db
        .query('reviewRuns')
        .withIndex('by_dedupe_key', (q) => q.eq('dedupeKey', args.dedupeKey))
        .unique()
    : null;
  const now = Date.now();

  if (existing) {
    const sourceRecordObjectType = getSecurityRelationshipObjectTypeFromSourceRecordType(
      args.sourceRecordType,
    );
    if (sourceRecordObjectType && args.sourceRecordId) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: args.actorUserId,
        fromId: args.sourceRecordId,
        fromType: sourceRecordObjectType,
        relationshipType: 'follow_up_for',
        toId: existing._id,
        toType: 'review_run',
      });
    }
    if (args.sourceLink) {
      const existingTask = await ctx.db
        .query('reviewTasks')
        .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', existing._id))
        .first();
      if (existingTask) {
        await upsertReviewTaskEvidenceLinkRecord(ctx, {
          freshAt: args.sourceLink.freshAt,
          linkedByUserId: args.actorUserId,
          reviewRunId: existing._id,
          reviewTaskId: existingTask._id,
          role: 'primary',
          sourceId: args.sourceLink.sourceId,
          sourceLabel: args.sourceLink.sourceLabel,
          sourceType: args.sourceLink.sourceType,
        });
      }
    }
    return existing._id;
  }

  const snapshot = await buildReviewRunSnapshot();
  const runId = await ctx.db.insert('reviewRuns', {
    ...getSecurityScopeFields(),
    controlRegisterGeneratedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
    controlRegisterSchemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
    createdAt: now,
    createdByUserId: args.actorUserId,
    dedupeKey: args.dedupeKey,
    finalReportId: undefined,
    finalizedAt: undefined,
    finalizedByUserId: undefined,
    kind: 'triggered',
    runKey: `triggered:${args.triggerType}:${crypto.randomUUID()}`,
    snapshotHash: snapshot.snapshotHash,
    snapshotJson: snapshot.snapshotJson,
    sourceRecordId: args.sourceRecordId,
    sourceRecordType: args.sourceRecordType,
    status: 'ready',
    title: args.title.trim(),
    triggerType: args.triggerType.trim(),
    updatedAt: now,
  });

  const taskId = await ctx.db.insert('reviewTasks', {
    ...getSecurityScopeFields(),
    allowException: true,
    controlLinks: args.controlLinks ?? [],
    createdAt: now,
    description: `Follow up on ${args.title.trim().toLowerCase()}.`,
    freshnessWindowDays: undefined,
    latestAttestationId: undefined,
    latestEvidenceLinkedAt: undefined,
    latestNote: undefined,
    latestResultId: undefined,
    policyId: undefined,
    required: true,
    reviewRunId: runId,
    satisfiedAt: undefined,
    satisfiedThroughAt: undefined,
    status: 'ready',
    taskType: 'follow_up',
    templateKey: `triggered:${args.triggerType.trim()}`,
    title: args.title.trim(),
    updatedAt: now,
  });

  if (args.sourceLink) {
    await upsertReviewTaskEvidenceLinkRecord(ctx, {
      freshAt: args.sourceLink.freshAt,
      linkedByUserId: args.actorUserId,
      reviewRunId: runId,
      reviewTaskId: taskId,
      role: 'primary',
      sourceId: args.sourceLink.sourceId,
      sourceLabel: args.sourceLink.sourceLabel,
      sourceType: args.sourceLink.sourceType,
    });
  }
  for (const controlLink of args.controlLinks ?? []) {
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.actorUserId,
      fromId: controlLink.internalControlId,
      fromType: 'control',
      relationshipType: 'has_review_task',
      toId: taskId,
      toType: 'review_task',
    });
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.actorUserId,
      fromId: `${controlLink.internalControlId}:${controlLink.itemId}`,
      fromType: 'checklist_item',
      relationshipType: 'has_review_task',
      toId: taskId,
      toType: 'review_task',
    });
  }
  const sourceRecordObjectType = getSecurityRelationshipObjectTypeFromSourceRecordType(
    args.sourceRecordType,
  );
  if (sourceRecordObjectType && args.sourceRecordId) {
    await upsertSecurityRelationship(ctx, {
      createdByUserId: args.actorUserId,
      fromId: args.sourceRecordId,
      fromType: sourceRecordObjectType,
      relationshipType: 'follow_up_for',
      toId: runId,
      toType: 'review_run',
    });
  }

  await syncReviewRunStatus(ctx, runId);
  return runId;
}

function getReviewBlueprintForTask(task: Pick<Doc<'reviewTasks'>, 'templateKey'>) {
  return (
    ANNUAL_REVIEW_TASK_BLUEPRINTS.find((entry) => entry.templateKey === task.templateKey) ?? null
  );
}

function isReportBackedAutomatedTask(task: Pick<Doc<'reviewTasks'>, 'taskType' | 'templateKey'>) {
  if (task.taskType !== 'automated_check') {
    return false;
  }
  const blueprint = getReviewBlueprintForTask(task);
  if (!blueprint?.automationKind) {
    return false;
  }

  return (
    blueprint.automationKind === 'security_posture' ||
    blueprint.automationKind === 'audit_readiness' ||
    blueprint.automationKind === 'findings_snapshot' ||
    blueprint.automationKind === 'vendor_posture_snapshot' ||
    blueprint.automationKind === 'control_workspace_snapshot'
  );
}

function deriveReportBackedTaskOutcome(
  report: Pick<
    Doc<'evidenceReports'>,
    'contentJson' | 'createdAt' | 'reportKind' | 'reviewStatus' | 'reviewedAt'
  >,
  task: Pick<Doc<'reviewTasks'>, 'freshnessWindowDays'>,
) {
  if (report.reviewStatus === 'needs_follow_up') {
    return {
      note: 'Linked report is marked as needing follow-up.',
      satisfiedAt: null,
      satisfiedThroughAt: null,
      status: 'blocked' as const,
    };
  }

  if (report.reviewStatus !== 'reviewed') {
    return {
      note: 'Awaiting linked report review.',
      satisfiedAt: null,
      satisfiedThroughAt: null,
      status: 'ready' as const,
    };
  }

  const satisfiedAt = report.reviewedAt ?? report.createdAt;
  return {
    note: undefined,
    satisfiedAt,
    satisfiedThroughAt: addDays(satisfiedAt, task.freshnessWindowDays ?? 30),
    status: 'completed' as const,
  };
}

async function reconcileEvidenceReportLinkedTasks(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    report: Doc<'evidenceReports'>;
  },
) {
  const links = await listReviewTaskEvidenceLinksBySource(ctx, {
    sourceId: args.report._id,
    sourceType: 'evidence_report',
  });
  const tasks = await Promise.all(
    Array.from(new Set(links.map((link) => link.reviewTaskId))).map(async (reviewTaskId) => {
      return await ctx.db.get(reviewTaskId);
    }),
  );
  const reviewTasks = tasks.filter((task): task is NonNullable<typeof task> => task !== null);

  if (args.report.reviewStatus === 'needs_follow_up' && reviewTasks.length > 0) {
    const mergedControlLinks = Array.from(
      new Map(
        reviewTasks
          .flatMap((task) => task.controlLinks)
          .map((link) => [`${link.internalControlId}:${link.itemId}`, link] as const),
      ).values(),
    );
    await createTriggeredReviewRunRecord(ctx, {
      actorUserId: args.actorUserId,
      controlLinks: mergedControlLinks,
      dedupeKey: `evidence-report:${args.report._id}`,
      sourceLink: {
        freshAt: args.report.reviewedAt ?? args.report.createdAt,
        sourceId: args.report._id,
        sourceLabel: args.report.reportKind,
        sourceType: 'evidence_report',
      },
      sourceRecordId: args.report._id,
      sourceRecordType: 'evidence_report',
      title: `${args.report.reportKind} follow-up`,
      triggerType: 'evidence_report_follow_up',
    });
  }

  await Promise.all(
    reviewTasks
      .filter((task) => isReportBackedAutomatedTask(task))
      .map(async (task) => {
        const outcome = deriveReportBackedTaskOutcome(args.report, task);
        await applyReviewTaskState(ctx, {
          actorUserId: args.actorUserId,
          mode: 'automated_check',
          note: outcome.note,
          resultType: 'automated_check',
          reviewTaskId: task._id,
          satisfiedAt: outcome.satisfiedAt,
          satisfiedThroughAt: outcome.satisfiedThroughAt,
          status: outcome.status,
        });
      }),
  );
}

async function runSecurityWorkspaceMigration(ctx: MutationCtx, actorUserId: string) {
  return await runSecurityWorkspaceMigrationInternal(ctx, actorUserId, {
    upsertReviewTaskEvidenceLinkRecord,
  });
}

export {
  applyReviewTaskState,
  buildEvidenceReportDetail,
  buildReviewRunDetail,
  buildReviewRunSnapshot,
  buildReviewRunSummary,
  buildReviewRunTaskCounts,
  buildVendorWorkspaceRows,
  clearChecklistReviewOutcomeEvidence,
  clearReviewTaskEvidenceLinksBySourceType,
  createTriggeredReviewRunRecord,
  deriveReportBackedTaskOutcome,
  deriveReviewRunStatus,
  getAutomationEvidenceLabel,
  getReviewBlueprintForTask,
  isReportBackedAutomatedTask,
  listReviewTasksByRunId,
  materializeReviewTaskSatisfactionEvidence,
  reconcileEvidenceReportLinkedTasks,
  removeReviewTaskEvidenceLinkRelationships,
  runSecurityWorkspaceMigration,
  syncSecurityVendorWorkspaceRecords,
  syncAnnualPolicyReviewTasks,
  syncReviewRunStatus,
  upsertAnnualReviewTasks,
  upsertReviewTaskEvidenceLinkRecord,
};
export type { ReviewRunDoc, ReviewTaskDoc };
