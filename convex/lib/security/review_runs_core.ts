import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { getVendorBoundarySnapshot } from '../../../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { listSecurityPolicyGovernanceContexts } from './governance_context';
import { ANNUAL_REVIEW_TASK_BLUEPRINTS } from './securityReviewConfig';
import type { ReviewTaskBlueprint } from './securityReviewConfig';
import {
  addDays,
  buildVendorRelatedControls,
  deleteSecurityRelationships,
  getSecurityFindingControlLinks,
  getSecurityRelationshipObjectTypeFromEvidenceSourceType,
  getSecurityRelationshipObjectTypeFromSourceRecordType,
  getSecurityScopeFields,
  getVendorRelatedControlLinks,
  hashContent,
  normalizeSecurityScope,
  patchSecurityScopeDefaults,
  resolveControlLinkMetadata,
  stringifyStable,
  upsertSecurityRelationship,
} from './core';
import {
  buildActorDisplayMap,
  getActorDisplayName,
  listReviewTaskEvidenceLinksBySource,
  recordSecurityControlEvidenceAuditEvent,
} from './operations_core';

type ReviewRunDoc = Doc<'reviewRuns'>;
type ReviewTaskDoc = Doc<'reviewTasks'>;

function buildPolicyReviewTaskTemplateKey(policyId: string) {
  return `annual:attest:policy:${policyId}`;
}

async function buildReviewRunSnapshot() {
  const snapshotJson = stringifyStable({
    generatedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
    schemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
    controls: ACTIVE_CONTROL_REGISTER.controls,
  });

  return {
    snapshotHash: await hashContent(snapshotJson),
    snapshotJson,
  };
}

function buildReviewRunTaskCounts(tasks: ReviewTaskDoc[]) {
  return tasks.reduce(
    (counts, task) => {
      counts.total += 1;
      counts[task.status] += 1;
      return counts;
    },
    {
      blocked: 0,
      completed: 0,
      exception: 0,
      ready: 0,
      total: 0,
    },
  );
}

function deriveReviewRunStatus(tasks: ReviewTaskDoc[], finalizedAt?: number) {
  if (typeof finalizedAt === 'number') {
    return 'completed' as const;
  }
  if (tasks.some((task) => task.status === 'blocked' || task.status === 'exception')) {
    return 'needs_attention' as const;
  }
  return 'ready' as const;
}

async function listReviewTasksByRunId(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  reviewRunId: Id<'reviewRuns'>,
) {
  return await ctx.db
    .query('reviewTasks')
    .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', reviewRunId))
    .collect();
}

function buildAnnualPolicyReviewTaskPatch(policy: Doc<'securityPolicies'>, now: number) {
  return {
    allowException: false,
    controlLinks: [] as ReviewTaskDoc['controlLinks'],
    description: `Review the ${policy.title} markdown source and attest that it remains current for the annual security review.`,
    freshnessWindowDays: 365,
    policyId: policy.policyId,
    required: true,
    taskType: 'attestation' as const,
    title: `${policy.title} reviewed`,
    updatedAt: now,
  };
}

async function syncAnnualPolicyReviewTasks(
  ctx: MutationCtx,
  args: {
    existingByTemplateKey: Map<string, ReviewTaskDoc>;
    existingTasks: ReviewTaskDoc[];
    reviewRunId: Id<'reviewRuns'>;
  },
) {
  const policies = await ctx.db.query('securityPolicies').collect();
  const now = Date.now();
  const validPolicyTemplateKeys = new Set(
    policies.map((policy) => buildPolicyReviewTaskTemplateKey(policy.policyId)),
  );

  await Promise.all(
    policies.map(async (policy) => {
      const templateKey = buildPolicyReviewTaskTemplateKey(policy.policyId);
      const existing = args.existingByTemplateKey.get(templateKey);
      const patch = buildAnnualPolicyReviewTaskPatch(policy, now);

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return;
      }

      await ctx.db.insert('reviewTasks', {
        ...patch,
        latestAttestationId: undefined,
        latestEvidenceLinkedAt: undefined,
        latestNote: undefined,
        latestResultId: undefined,
        reviewRunId: args.reviewRunId,
        satisfiedAt: undefined,
        satisfiedThroughAt: undefined,
        status: 'ready',
        templateKey,
        createdAt: now,
      });
    }),
  );

  await Promise.all(
    args.existingTasks
      .filter(
        (task) =>
          task.templateKey.startsWith('annual:attest:policy:') &&
          !validPolicyTemplateKeys.has(task.templateKey),
      )
      .map((task) => ctx.db.delete(task._id)),
  );
}

async function upsertAnnualReviewTasks(ctx: MutationCtx, reviewRunId: Id<'reviewRuns'>) {
  const existingTasks = await listReviewTasksByRunId(ctx, reviewRunId);
  const existingByTemplateKey = new Map(
    existingTasks.map((task) => [task.templateKey, task] as const),
  );
  const now = Date.now();

  await Promise.all(
    ANNUAL_REVIEW_TASK_BLUEPRINTS.map(async (blueprint) => {
      const existing = existingByTemplateKey.get(blueprint.templateKey);
      const patch = {
        allowException: blueprint.allowException,
        controlLinks: blueprint.controlLinks,
        description: blueprint.description,
        freshnessWindowDays: blueprint.freshnessWindowDays ?? undefined,
        policyId: undefined,
        required: blueprint.required,
        taskType: blueprint.taskType,
        title: blueprint.title,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return;
      }

      await ctx.db.insert('reviewTasks', {
        ...patch,
        latestAttestationId: undefined,
        latestEvidenceLinkedAt: undefined,
        latestNote: undefined,
        latestResultId: undefined,
        reviewRunId,
        satisfiedAt: undefined,
        satisfiedThroughAt: undefined,
        status: 'ready',
        templateKey: blueprint.templateKey,
        createdAt: now,
      });
    }),
  );

  await syncAnnualPolicyReviewTasks(ctx, {
    existingByTemplateKey,
    existingTasks,
    reviewRunId,
  });
}

async function syncReviewRunStatus(ctx: MutationCtx, reviewRunId: Id<'reviewRuns'>) {
  const run = await ctx.db.get(reviewRunId);
  if (!run) {
    throw new Error('Review run not found.');
  }
  const tasks = await listReviewTasksByRunId(ctx, reviewRunId);
  const status = deriveReviewRunStatus(tasks, run.finalizedAt);
  if (status !== run.status) {
    await ctx.db.patch(reviewRunId, {
      status,
      updatedAt: Date.now(),
    });
  }
  return status;
}

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

  if (link.sourceType !== 'evidence_report' && link.sourceType !== 'vendor_review') {
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
        relationshipType: 'tracks_vendor_review',
        toId: link.sourceId,
        toType: 'vendor_review',
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
      | 'vendor_review';
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
        if (args.sourceType === 'vendor_review') {
          await upsertSecurityRelationship(ctx, {
            createdByUserId: args.linkedByUserId ?? 'system:security-graph',
            fromId: controlLink.internalControlId,
            fromType: 'control',
            relationshipType: 'tracks_vendor_review',
            toId: args.sourceId,
            toType: 'vendor_review',
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
      if (args.sourceType === 'vendor_review') {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: args.linkedByUserId ?? 'system:security-graph',
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'tracks_vendor_review',
          toId: args.sourceId,
          toType: 'vendor_review',
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
    | 'vendor_review'
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

function getAutomationEvidenceLabel(blueprint: ReviewTaskBlueprint) {
  switch (blueprint.automationKind) {
    case 'audit_readiness':
      return 'Audit readiness report';
    case 'backup_verification':
      return 'Backup verification evidence';
    case 'control_workspace_snapshot':
      return 'Control workspace snapshot';
    case 'findings_snapshot':
      return 'Security findings snapshot';
    case 'release_provenance':
      return 'Release provenance evidence';
    case 'security_posture':
      return 'Security posture summary';
    case 'vendor_posture_snapshot':
      return 'Vendor posture snapshot';
    default:
      return blueprint.title;
  }
}

async function buildReviewRunSummary(ctx: QueryCtx, run: ReviewRunDoc) {
  const tasks = await listReviewTasksByRunId(ctx, run._id);
  return {
    createdAt: run.createdAt,
    finalizedAt: run.finalizedAt ?? null,
    id: run._id,
    kind: run.kind,
    scopeId: normalizeSecurityScope(run).scopeId,
    scopeType: normalizeSecurityScope(run).scopeType,
    status: deriveReviewRunStatus(tasks, run.finalizedAt),
    taskCounts: buildReviewRunTaskCounts(tasks),
    title: run.title,
    triggerType: run.triggerType ?? null,
    year: run.year ?? null,
  };
}

async function buildReviewRunDetail(ctx: QueryCtx, reviewRunId: Id<'reviewRuns'>) {
  const run = await ctx.db.get(reviewRunId);
  if (!run) {
    return null;
  }

  const [tasks, evidenceLinks, attestations, policyGovernanceContexts] = await Promise.all([
    listReviewTasksByRunId(ctx, reviewRunId),
    ctx.db
      .query('reviewTaskEvidenceLinks')
      .withIndex('by_review_run_id_and_linked_at', (q) => q.eq('reviewRunId', reviewRunId))
      .collect(),
    ctx.db
      .query('reviewAttestations')
      .withIndex('by_review_run_id_and_attested_at', (q) => q.eq('reviewRunId', reviewRunId))
      .collect(),
    run.kind === 'annual' ? listSecurityPolicyGovernanceContexts(ctx) : Promise.resolve([]),
  ]);
  const policyGovernanceContextById = new Map(
    policyGovernanceContexts.map((entry) => [entry.policy.policyId, entry] as const),
  );

  const actorIds = Array.from(
    new Set([
      ...evidenceLinks
        .map((link) => link.linkedByUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ...attestations
        .map((attestation) => attestation.attestedByUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ]),
  );
  const actorProfiles = await Promise.all(
    actorIds.map(async (authUserId) => {
      const profile = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
      return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
    }),
  );
  const actorDisplayById = new Map(actorProfiles);
  const evidenceLinksByTaskId = evidenceLinks.reduce<Map<string, Doc<'reviewTaskEvidenceLinks'>[]>>(
    (accumulator, link) => {
      const current = accumulator.get(link.reviewTaskId) ?? [];
      current.push(link);
      accumulator.set(link.reviewTaskId, current);
      return accumulator;
    },
    new Map(),
  );
  const attestationByTaskId = new Map(
    attestations.map((attestation) => [attestation.reviewTaskId, attestation] as const),
  );
  const sortedTasks = [...tasks].sort((left, right) =>
    left.templateKey.localeCompare(right.templateKey),
  );
  const buildReviewTaskPolicySummary = (task: ReviewTaskDoc) => {
    if (!task.policyId) {
      return null;
    }
    return policyGovernanceContextById.get(task.policyId)?.policy ?? null;
  };
  const buildReviewTaskPolicyControls = (task: ReviewTaskDoc) => {
    if (!task.policyId) {
      return [];
    }
    return policyGovernanceContextById.get(task.policyId)?.controls ?? [];
  };

  return {
    createdAt: run.createdAt,
    finalReportId: run.finalReportId ?? null,
    finalizedAt: run.finalizedAt ?? null,
    id: run._id,
    kind: run.kind,
    scopeId: normalizeSecurityScope(run).scopeId,
    scopeType: normalizeSecurityScope(run).scopeType,
    sourceRecordId: run.sourceRecordId ?? null,
    sourceRecordType: run.sourceRecordType ?? null,
    status: deriveReviewRunStatus(tasks, run.finalizedAt),
    tasks: sortedTasks.map((task) => {
      const latestAttestation = attestationByTaskId.get(task._id);
      return {
        allowException: task.allowException,
        controlLinks: task.controlLinks.map((link) => ({
          ...link,
          ...resolveControlLinkMetadata(link),
        })),
        description: task.description,
        evidenceLinks: (evidenceLinksByTaskId.get(task._id) ?? [])
          .sort((left, right) => right.linkedAt - left.linkedAt)
          .map((link) => ({
            id: link._id,
            freshAt: link.freshAt ?? null,
            linkedAt: link.linkedAt,
            linkedByDisplay: getActorDisplayName(actorDisplayById, link.linkedByUserId),
            role: link.role,
            sourceId: link.sourceId,
            sourceLabel: link.sourceLabel ?? link.sourceId,
            sourceType: link.sourceType,
          })),
        freshnessWindowDays: task.freshnessWindowDays ?? null,
        id: task._id,
        latestAttestation: latestAttestation
          ? {
              documentLabel: latestAttestation.documentLabel ?? null,
              documentUrl: latestAttestation.documentUrl ?? null,
              documentVersion: latestAttestation.documentVersion ?? null,
              statementKey: latestAttestation.statementKey,
              statementText: latestAttestation.statementText,
              attestedAt: latestAttestation.attestedAt,
              attestedByDisplay: getActorDisplayName(
                actorDisplayById,
                latestAttestation.attestedByUserId,
              ),
            }
          : null,
        latestNote: task.latestNote ?? null,
        policy: buildReviewTaskPolicySummary(task),
        policyControls: buildReviewTaskPolicyControls(task),
        required: task.required,
        satisfiedAt: task.satisfiedAt ?? null,
        satisfiedThroughAt: task.satisfiedThroughAt ?? null,
        status: task.status,
        taskType: task.taskType,
        templateKey: task.templateKey,
        title: task.title,
      };
    }),
    title: run.title,
    triggerType: run.triggerType ?? null,
    year: run.year ?? null,
  };
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
        | 'vendor_review';
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

async function syncVendorReviewOverlayRecords(ctx: MutationCtx) {
  const existing = await ctx.db.query('securityVendorReviews').collect();
  const existingByKey = new Map(existing.map((row) => [row.vendorKey, row] as const));
  const now = Date.now();
  let inserted = 0;

  for (const vendor of getVendorBoundarySnapshot()) {
    if (existingByKey.has(vendor.vendor)) {
      continue;
    }

    await ctx.db.insert('securityVendorReviews', {
      ...getSecurityScopeFields(),
      createdAt: now,
      customerSummary: null,
      internalReviewNotes: null,
      linkedFollowUpRunId: undefined,
      owner: undefined,
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewedByUserId: null,
      updatedAt: now,
      vendorKey: vendor.vendor,
    });
    inserted += 1;
  }

  return inserted;
}

async function buildVendorWorkspaceRows(ctx: QueryCtx) {
  const runtimePosture = getVendorBoundarySnapshot();
  const reviewRows = await ctx.db.query('securityVendorReviews').collect();
  const relationships = await ctx.db.query('securityRelationships').collect();
  const reviewByVendorKey = new Map(reviewRows.map((row) => [row.vendorKey, row] as const));
  const actorDisplayById = await buildActorDisplayMap(
    ctx,
    reviewRows
      .map((row) => row.reviewedByUserId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const controlById = new Map(
    ACTIVE_CONTROL_REGISTER.controls.map(
      (control) => [control.internalControlId, control] as const,
    ),
  );
  const relationshipsByFromKey = relationships.reduce<Map<string, typeof relationships>>(
    (accumulator, relationship) => {
      const key = `${relationship.fromType}:${relationship.fromId}`;
      const current = accumulator.get(key) ?? [];
      current.push(relationship);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const reviewRunIds = Array.from(
    new Set(
      relationships
        .filter((relationship) => relationship.toType === 'review_run')
        .map((relationship) => relationship.toId as Id<'reviewRuns'>),
    ),
  );
  const reviewRuns = await Promise.all(
    reviewRunIds.map(async (reviewRunId) => await ctx.db.get(reviewRunId)),
  );
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );

  return runtimePosture.map((vendor) => {
    const overlay = reviewByVendorKey.get(vendor.vendor);
    const linkedEntities = (relationshipsByFromKey.get(`vendor_review:${vendor.vendor}`) ?? [])
      .map((relationship) => {
        if (relationship.toType === 'control') {
          const control = controlById.get(relationship.toId);
          if (!control) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: `${control.nist80053Id} ${control.title}`,
            relationshipType: relationship.relationshipType,
            status: null,
          };
        }
        if (relationship.toType === 'review_run') {
          const run = reviewRunById.get(relationship.toId as Id<'reviewRuns'>);
          if (!run) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: run.title,
            relationshipType: relationship.relationshipType,
            status: run.status,
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return {
      ...vendor,
      customerSummary: overlay?.customerSummary ?? null,
      linkedFollowUpRunId: overlay?.linkedFollowUpRunId ?? null,
      linkedEntities,
      owner: overlay?.owner ?? null,
      relatedControls: buildVendorRelatedControls(vendor.vendor),
      internalNotes: overlay?.internalReviewNotes ?? null,
      reviewStatus: overlay?.reviewStatus ?? ('pending' as const),
      reviewedAt: overlay?.reviewedAt ?? null,
      reviewedByDisplay: getActorDisplayName(
        actorDisplayById,
        overlay?.reviewedByUserId ?? undefined,
      ),
      ...getSecurityScopeFields(),
    };
  });
}

async function runSecurityWorkspaceMigration(ctx: MutationCtx, actorUserId: string) {
  const scopeTables = [
    'securityFindings',
    'evidenceReports',
    'exportArtifacts',
    'securityControlChecklistItems',
    'securityControlEvidence',
    'securityControlEvidenceActivity',
    'reviewRuns',
    'reviewTasks',
    'reviewTaskResults',
    'reviewAttestations',
    'reviewTaskEvidenceLinks',
    'securityVendorReviews',
    'retentionJobs',
    'backupVerificationReports',
    'securityRelationships',
  ] as const;
  let patchedScopeRecords = 0;
  for (const tableName of scopeTables) {
    patchedScopeRecords += await patchSecurityScopeDefaults(ctx, tableName);
  }

  let patchedChecklistStatuses = 0;
  let migratedReviewArtifacts = 0;

  let patchedReviewNotes = 0;

  const syncedVendorReviewRows = await syncVendorReviewOverlayRecords(ctx);
  const [evidenceRows, findingRows, reviewRuns, reviewTasks, evidenceLinks, vendorReviews] =
    await Promise.all([
      ctx.db.query('securityControlEvidence').collect(),
      ctx.db.query('securityFindings').collect(),
      ctx.db.query('reviewRuns').collect(),
      ctx.db.query('reviewTasks').collect(),
      ctx.db.query('reviewTaskEvidenceLinks').collect(),
      ctx.db.query('securityVendorReviews').collect(),
    ]);

  const reviewTaskById = new Map(reviewTasks.map((task) => [task._id, task] as const));

  for (const evidence of evidenceRows) {
    await upsertSecurityRelationship(ctx, {
      createdByUserId: actorUserId,
      fromId: evidence.internalControlId,
      fromType: 'control',
      relationshipType: 'has_evidence',
      toId: evidence._id,
      toType: 'evidence',
    });
    await upsertSecurityRelationship(ctx, {
      createdByUserId: actorUserId,
      fromId: `${evidence.internalControlId}:${evidence.itemId}`,
      fromType: 'checklist_item',
      relationshipType: 'has_evidence',
      toId: evidence._id,
      toType: 'evidence',
    });
  }

  for (const finding of findingRows) {
    for (const controlLink of getSecurityFindingControlLinks(finding.findingType)) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_finding',
        toId: finding.findingKey,
        toType: 'finding',
      });
    }
  }

  for (const task of reviewTasks) {
    for (const controlLink of task.controlLinks) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'has_review_task',
        toId: task._id,
        toType: 'review_task',
      });
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: `${controlLink.internalControlId}:${controlLink.itemId}`,
        fromType: 'checklist_item',
        relationshipType: 'has_review_task',
        toId: task._id,
        toType: 'review_task',
      });
    }
  }

  for (const link of evidenceLinks) {
    const task = reviewTaskById.get(link.reviewTaskId);
    const sourceObjectType = getSecurityRelationshipObjectTypeFromEvidenceSourceType(
      link.sourceType,
    );
    if (!task || !sourceObjectType) {
      continue;
    }
    await upsertSecurityRelationship(ctx, {
      createdByUserId: actorUserId,
      fromId: task._id,
      fromType: 'review_task',
      relationshipType: link.sourceType === 'evidence_report' ? 'satisfies' : 'supports',
      toId: link.sourceId,
      toType: sourceObjectType,
    });
    await upsertSecurityRelationship(ctx, {
      createdByUserId: actorUserId,
      fromId: link.sourceId,
      fromType: sourceObjectType,
      relationshipType: 'supports',
      toId: task._id,
      toType: 'review_task',
    });
    for (const controlLink of task.controlLinks) {
      if (link.sourceType === 'evidence_report') {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: actorUserId,
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'has_report',
          toId: link.sourceId,
          toType: 'evidence_report',
        });
        await upsertSecurityRelationship(ctx, {
          createdByUserId: actorUserId,
          fromId: `${controlLink.internalControlId}:${controlLink.itemId}`,
          fromType: 'checklist_item',
          relationshipType: 'has_report',
          toId: link.sourceId,
          toType: 'evidence_report',
        });
      }
      if (link.sourceType === 'vendor_review') {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: actorUserId,
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'tracks_vendor_review',
          toId: link.sourceId,
          toType: 'vendor_review',
        });
      }
    }
  }

  for (const vendorReview of vendorReviews) {
    for (const controlLink of getVendorRelatedControlLinks(vendorReview.vendorKey)) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: vendorReview.vendorKey,
        fromType: 'vendor_review',
        relationshipType: 'related_control',
        toId: controlLink.internalControlId,
        toType: 'control',
      });
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_vendor_review',
        toId: vendorReview.vendorKey,
        toType: 'vendor_review',
      });
    }
    if (vendorReview.linkedFollowUpRunId) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: vendorReview.vendorKey,
        fromType: 'vendor_review',
        relationshipType: 'follow_up_for',
        toId: vendorReview.linkedFollowUpRunId,
        toType: 'review_run',
      });
    }
  }

  for (const reviewRun of reviewRuns) {
    const sourceObjectType = getSecurityRelationshipObjectTypeFromSourceRecordType(
      reviewRun.sourceRecordType,
    );
    if (!sourceObjectType || !reviewRun.sourceRecordId) {
      continue;
    }
    await upsertSecurityRelationship(ctx, {
      createdByUserId: actorUserId,
      fromId: reviewRun.sourceRecordId,
      fromType: sourceObjectType,
      relationshipType: 'follow_up_for',
      toId: reviewRun._id,
      toType: 'review_run',
    });
  }

  return {
    migratedReviewArtifacts,
    patchedChecklistStatuses,
    patchedReviewNotes,
    patchedScopeRecords,
    syncedVendorReviewRows,
  };
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
  const parsed = JSON.parse(report.contentJson) as {
    summary?: {
      openCount?: number;
    };
  };
  const findingsOpenCount =
    report.reportKind === 'findings_snapshot' && typeof parsed.summary?.openCount === 'number'
      ? parsed.summary.openCount
      : 0;

  if (findingsOpenCount > 0) {
    return {
      note: `${findingsOpenCount} open finding(s) still require follow-up.`,
      satisfiedAt: null,
      satisfiedThroughAt: null,
      status: 'blocked' as const,
    };
  }

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

async function buildEvidenceReportDetail(ctx: QueryCtx, reportId: Id<'evidenceReports'>) {
  const report = await ctx.db.get(reportId);
  if (!report) {
    return null;
  }

  const links = await listReviewTaskEvidenceLinksBySource(ctx, {
    sourceId: reportId,
    sourceType: 'evidence_report',
  });
  const tasks = await Promise.all(links.map(async (link) => await ctx.db.get(link.reviewTaskId)));
  const reviewTasks = tasks.filter((task): task is NonNullable<typeof task> => task !== null);
  const reviewRunIds = Array.from(new Set(reviewTasks.map((task) => task.reviewRunId)));
  const reviewRuns = await Promise.all(
    reviewRunIds.map(async (reviewRunId) => await ctx.db.get(reviewRunId)),
  );
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const actorDisplayById = await buildActorDisplayMap(
    ctx,
    [report.reviewedByUserId, ...links.map((link) => link.linkedByUserId)].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );

  return {
    contentHash: report.contentHash,
    contentJson: report.contentJson,
    createdAt: report.createdAt,
    exportBundleJson: report.exportBundleJson ?? null,
    exportHash: report.exportHash ?? null,
    exportIntegritySummary: report.exportIntegritySummary ?? null,
    exportManifestHash: report.exportManifestHash ?? null,
    exportManifestJson: report.exportManifestJson ?? null,
    exportedAt: report.exportedAt ?? null,
    exportedByUserId: report.exportedByUserId ?? null,
    generatedByUserId: report.generatedByUserId,
    id: report._id,
    linkedTasks: links
      .map((link) => {
        const task = reviewTasks.find((entry) => entry._id === link.reviewTaskId);
        const run = task ? reviewRunById.get(task.reviewRunId) : null;
        if (!task || !run) {
          return null;
        }
        return {
          controlLinks: task.controlLinks.map((controlLink) => ({
            ...controlLink,
            ...resolveControlLinkMetadata(controlLink),
          })),
          reviewRunId: run._id,
          reviewRunKind: run.kind,
          reviewRunStatus: run.status,
          reviewRunTitle: run.title,
          taskId: task._id,
          taskStatus: task.status,
          taskTitle: task.title,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    scopeId: normalizeSecurityScope(report).scopeId,
    scopeType: normalizeSecurityScope(report).scopeType,
    organizationId: report.organizationId ?? null,
    reportKind: report.reportKind,
    customerSummary: report.customerSummary ?? null,
    internalNotes: report.internalReviewNotes ?? null,
    reviewStatus: report.reviewStatus,
    reviewedAt: report.reviewedAt ?? null,
    reviewedByDisplay: getActorDisplayName(actorDisplayById, report.reviewedByUserId ?? undefined),
  };
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
  syncAnnualPolicyReviewTasks,
  syncReviewRunStatus,
  syncVendorReviewOverlayRecords,
  upsertAnnualReviewTasks,
  upsertReviewTaskEvidenceLinkRecord,
};
export type { ReviewRunDoc, ReviewTaskDoc };
