import { internalMutation, mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';
import { siteAdminAction } from './auth/authorized';
import { getVerifiedCurrentSiteAdminUserOrThrow } from './auth/access';
import {
  ANNUAL_REVIEW_TASK_BLUEPRINTS,
  ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
} from './lib/security/securityReviewConfig';
import {
  addDays,
  getAnnualReviewRunKey,
  getAnnualReviewRunTitle,
  getCurrentAnnualReviewYear,
  getSecurityScopeFields,
} from './lib/security/core';
import {
  finalizeReviewRunHandler,
  refreshReviewRunAutomationHandler,
} from './lib/security/reports';
import {
  applyReviewTaskState,
  buildReviewRunDetail,
  buildReviewRunSnapshot,
  buildReviewRunSummary,
  clearReviewTaskEvidenceLinksBySourceType,
  createTriggeredReviewRunRecord,
  syncReviewRunStatus,
  upsertAnnualReviewTasks,
  upsertReviewTaskEvidenceLinkRecord,
} from './lib/security/review_runs_core';
import {
  reviewRunDetailValidator,
  reviewRunSummaryListValidator,
  reviewRunSummaryValidator,
  reviewSatisfactionModeValidator,
  reviewTaskControlReferenceValidator,
  reviewTaskEvidenceRoleValidator,
  reviewTaskEvidenceSourceTypeValidator,
  reviewTaskResultTypeValidator,
  reviewTaskStatusValidator,
} from './lib/security/validators';

export const getCurrentAnnualReviewRun = query({
  args: {},
  returns: v.union(reviewRunSummaryValidator, v.null()),
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('reviewRuns')
      .withIndex('by_run_key', (q) =>
        q.eq('runKey', getAnnualReviewRunKey(getCurrentAnnualReviewYear())),
      )
      .unique();
    if (!existing) {
      return null;
    }
    return await buildReviewRunSummary(ctx, existing);
  },
});

export const ensureCurrentAnnualReviewRun = mutation({
  args: {},
  returns: reviewRunSummaryValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const year = getCurrentAnnualReviewYear();
    const runKey = getAnnualReviewRunKey(year);
    let run = await ctx.db
      .query('reviewRuns')
      .withIndex('by_run_key', (q) => q.eq('runKey', runKey))
      .unique();

    if (!run) {
      const snapshot = await buildReviewRunSnapshot();
      const now = Date.now();
      const runId = await ctx.db.insert('reviewRuns', {
        ...getSecurityScopeFields(),
        controlRegisterGeneratedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
        controlRegisterSchemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
        createdAt: now,
        createdByUserId: currentUser.authUserId,
        finalReportId: undefined,
        finalizedAt: undefined,
        finalizedByUserId: undefined,
        kind: 'annual',
        runKey,
        snapshotHash: snapshot.snapshotHash,
        snapshotJson: snapshot.snapshotJson,
        status: 'ready',
        title: getAnnualReviewRunTitle(year),
        updatedAt: now,
        year,
      });
      await upsertAnnualReviewTasks(ctx, runId);
      run = await ctx.db.get(runId);
    } else {
      await upsertAnnualReviewTasks(ctx, run._id);
    }

    if (!run) {
      throw new Error('Failed to ensure current annual review run.');
    }
    await syncReviewRunStatus(ctx, run._id);
    const latestRun = await ctx.db.get(run._id);
    if (!latestRun) {
      throw new Error('Review run not found after ensure.');
    }
    return await buildReviewRunSummary(ctx as unknown as QueryCtx, latestRun);
  },
});

export const listTriggeredReviewRuns = query({
  args: {},
  returns: reviewRunSummaryListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const runs = await ctx.db
      .query('reviewRuns')
      .withIndex('by_kind_and_created_at', (q) => q.eq('kind', 'triggered'))
      .order('desc')
      .collect();
    return await Promise.all(runs.map(async (run) => await buildReviewRunSummary(ctx, run)));
  },
});

export const getReviewRunDetail = query({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await buildReviewRunDetail(ctx, args.reviewRunId);
  },
});

export const upsertReviewTaskEvidenceLinkInternal = internalMutation({
  args: {
    freshAt: v.optional(v.number()),
    linkedByUserId: v.optional(v.string()),
    reviewRunId: v.id('reviewRuns'),
    reviewTaskId: v.id('reviewTasks'),
    role: reviewTaskEvidenceRoleValidator,
    sourceId: v.string(),
    sourceLabel: v.string(),
    sourceType: reviewTaskEvidenceSourceTypeValidator,
  },
  returns: v.id('reviewTaskEvidenceLinks'),
  handler: async (ctx, args) => {
    return await upsertReviewTaskEvidenceLinkRecord(ctx, args);
  },
});

export const replaceReviewTaskEvidenceLinksInternal = internalMutation({
  args: {
    reviewTaskId: v.id('reviewTasks'),
    sourceTypes: v.array(reviewTaskEvidenceSourceTypeValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await clearReviewTaskEvidenceLinksBySourceType(ctx, args.reviewTaskId, args.sourceTypes);
    return null;
  },
});

export const applyReviewTaskStateInternal = internalMutation({
  args: {
    actorUserId: v.string(),
    latestAttestationId: v.optional(v.id('reviewAttestations')),
    mode: reviewSatisfactionModeValidator,
    note: v.optional(v.string()),
    reviewTaskId: v.id('reviewTasks'),
    resultType: reviewTaskResultTypeValidator,
    satisfiedAt: v.optional(v.union(v.number(), v.null())),
    satisfiedThroughAt: v.optional(v.union(v.number(), v.null())),
    status: reviewTaskStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyReviewTaskState(ctx, {
      actorUserId: args.actorUserId,
      latestAttestationId: args.latestAttestationId,
      mode: args.mode,
      note: args.note,
      resultType: args.resultType,
      reviewTaskId: args.reviewTaskId,
      satisfiedAt: args.satisfiedAt ?? null,
      satisfiedThroughAt: args.satisfiedThroughAt ?? null,
      status: args.status,
    });
    return null;
  },
});

export const createTriggeredReviewRun = mutation({
  args: {
    controlLinks: v.optional(v.array(reviewTaskControlReferenceValidator)),
    dedupeKey: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
    sourceRecordType: v.optional(v.string()),
    title: v.string(),
    triggerType: v.string(),
  },
  returns: reviewRunSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const runId = await createTriggeredReviewRunRecord(ctx, {
      actorUserId: currentUser.authUserId,
      controlLinks: args.controlLinks,
      dedupeKey: args.dedupeKey,
      sourceRecordId: args.sourceRecordId,
      sourceRecordType: args.sourceRecordType,
      title: args.title,
      triggerType: args.triggerType,
    });
    const latestRun = await ctx.db.get(runId);
    if (!latestRun) {
      throw new Error('Triggered review run not found after create.');
    }
    return await buildReviewRunSummary(ctx as unknown as QueryCtx, latestRun);
  },
});

export const linkReviewTaskEvidence = mutation({
  args: {
    freshAt: v.optional(v.number()),
    reviewTaskId: v.id('reviewTasks'),
    role: v.optional(reviewTaskEvidenceRoleValidator),
    sourceId: v.string(),
    sourceLabel: v.string(),
    sourceType: reviewTaskEvidenceSourceTypeValidator,
  },
  returns: v.id('reviewTaskEvidenceLinks'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    const linkId = await upsertReviewTaskEvidenceLinkRecord(ctx, {
      freshAt: args.freshAt,
      linkedByUserId: currentUser.authUserId,
      reviewRunId: task.reviewRunId,
      reviewTaskId: args.reviewTaskId,
      role: args.role ?? 'primary',
      sourceId: args.sourceId.trim(),
      sourceLabel: args.sourceLabel.trim(),
      sourceType: args.sourceType,
    });
    await ctx.db.patch(task._id, {
      latestEvidenceLinkedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await syncReviewRunStatus(ctx, task.reviewRunId);
    return linkId;
  },
});

export const attestReviewTask = mutation({
  args: {
    documentLabel: v.optional(v.string()),
    documentUrl: v.optional(v.string()),
    documentVersion: v.optional(v.string()),
    note: v.optional(v.string()),
    reviewTaskId: v.id('reviewTasks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    const blueprint = ANNUAL_REVIEW_TASK_BLUEPRINTS.find(
      (entry) => entry.templateKey === task.templateKey,
    );
    if (!blueprint || blueprint.statementKey === null || blueprint.statementText === null) {
      throw new Error('This task does not support attestation.');
    }

    if (task.taskType === 'document_upload') {
      const documentLabel = args.documentLabel?.trim() ?? '';
      const documentUrl = args.documentUrl?.trim() ?? '';
      if (!documentLabel || !documentUrl) {
        throw new Error('Document-upload tasks require both a document label and URL.');
      }
      await upsertReviewTaskEvidenceLinkRecord(ctx, {
        linkedByUserId: currentUser.authUserId,
        reviewRunId: task.reviewRunId,
        reviewTaskId: task._id,
        role: 'primary',
        sourceId: documentUrl,
        sourceLabel: documentLabel,
        sourceType: 'external_document',
      });
    }

    const now = Date.now();
    const attestationId = await ctx.db.insert('reviewAttestations', {
      ...getSecurityScopeFields(),
      attestedAt: now,
      attestedByUserId: currentUser.authUserId,
      createdAt: now,
      documentLabel: args.documentLabel?.trim() || undefined,
      documentUrl: args.documentUrl?.trim() || undefined,
      documentVersion: args.documentVersion?.trim() || undefined,
      reviewRunId: task.reviewRunId,
      reviewTaskId: task._id,
      statementKey: blueprint.statementKey,
      statementText: blueprint.statementText,
    });

    const satisfiedThroughAt = addDays(
      now,
      task.freshnessWindowDays ?? ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
    );
    await applyReviewTaskState(ctx, {
      actorUserId: currentUser.authUserId,
      latestAttestationId: attestationId,
      mode: task.taskType,
      note: args.note,
      resultType: task.taskType === 'document_upload' ? 'document_linked' : 'attested',
      reviewTaskId: task._id,
      satisfiedAt: now,
      satisfiedThroughAt,
      status: 'completed',
    });
    return null;
  },
});

export const setReviewTaskException = mutation({
  args: {
    note: v.string(),
    reviewTaskId: v.id('reviewTasks'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    if (!task.allowException) {
      throw new Error('This task does not allow exceptions.');
    }
    const trimmedNote = args.note.trim();
    if (!trimmedNote) {
      throw new Error('Exception note is required.');
    }
    const now = Date.now();
    await applyReviewTaskState(ctx, {
      actorUserId: currentUser.authUserId,
      mode: 'exception',
      note: trimmedNote,
      resultType: 'exception_marked',
      reviewTaskId: task._id,
      satisfiedAt: now,
      satisfiedThroughAt: addDays(
        now,
        task.freshnessWindowDays ?? ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
      ),
      status: 'exception',
    });
    return null;
  },
});

export const openTriggeredFollowUp = mutation({
  args: {
    note: v.optional(v.string()),
    reviewTaskId: v.id('reviewTasks'),
  },
  returns: reviewRunSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const task = await ctx.db.get(args.reviewTaskId);
    if (!task) {
      throw new Error('Review task not found.');
    }
    const runId = await createTriggeredReviewRunRecord(ctx, {
      actorUserId: currentUser.authUserId,
      controlLinks: task.controlLinks,
      dedupeKey: `review-task:${task._id}`,
      sourceLink: {
        freshAt: Date.now(),
        sourceId: task._id,
        sourceLabel: task.title,
        sourceType: 'review_task',
      },
      sourceRecordId: task._id,
      sourceRecordType: 'review_task',
      title: `${task.title} follow-up`,
      triggerType: 'review_task_follow_up',
    });
    const run = await ctx.db.get(runId);
    if (!run) {
      throw new Error('Follow-up review run not found after create.');
    }
    const summary = await buildReviewRunSummary(ctx as unknown as QueryCtx, run);

    await applyReviewTaskState(ctx, {
      actorUserId: currentUser.authUserId,
      mode: 'follow_up',
      note: args.note,
      resultType: 'follow_up_opened',
      reviewTaskId: task._id,
      satisfiedAt: Date.now(),
      satisfiedThroughAt: addDays(
        Date.now(),
        task.freshnessWindowDays ?? ANNUAL_REVIEW_TASK_FRESHNESS_DAYS,
      ),
      status: 'exception',
    });
    return summary;
  },
});

export const storeReviewRunFinalization = internalMutation({
  args: {
    finalReportId: v.id('evidenceReports'),
    finalizedAt: v.number(),
    finalizedByUserId: v.string(),
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reviewRunId, {
      finalReportId: args.finalReportId,
      finalizedAt: args.finalizedAt,
      finalizedByUserId: args.finalizedByUserId,
      status: 'completed',
      updatedAt: args.finalizedAt,
    });
    return null;
  },
});

export const refreshReviewRunAutomation = siteAdminAction({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: refreshReviewRunAutomationHandler,
});

export const finalizeReviewRun = siteAdminAction({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: finalizeReviewRunHandler,
});
