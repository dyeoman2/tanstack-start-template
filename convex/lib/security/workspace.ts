import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { getVerifiedCurrentSiteAdminUserOrThrow } from '../../auth/access';
import { throwConvexError } from '../../auth/errors';
import {
  getSecurityFindingControlLinks,
  getSecurityScopeFields,
  normalizeSecurityScope,
  upsertSecurityRelationship,
} from './core';
import {
  buildActorDisplayMap,
  buildCurrentSecurityFindings,
  getActorDisplayName,
  getSeededEvidenceEntry,
  recordSecurityControlEvidenceAuditEvent,
  syncCurrentSecurityFindings,
} from './operations_core';

const securityFindingRelatedControlMetadataById = new Map(
  ACTIVE_CONTROL_REGISTER.controls.map((control) => [control.internalControlId, control] as const),
);

function getSecurityControlLinkSummary(controlLink: { internalControlId: string; itemId: string }) {
  const control = securityFindingRelatedControlMetadataById.get(controlLink.internalControlId);
  return {
    internalControlId: controlLink.internalControlId,
    itemId: controlLink.itemId,
    itemLabel:
      control?.platformChecklistItems.find((item) => item.itemId === controlLink.itemId)?.label ??
      null,
    nist80053Id: control?.nist80053Id ?? controlLink.internalControlId,
    title: control?.title ?? controlLink.internalControlId,
  };
}

function getSecurityFindingRelatedControls(
  findingType:
    | 'audit_integrity_failures'
    | 'audit_archive_health'
    | 'audit_request_context_gaps'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation',
) {
  return getSecurityFindingControlLinks(findingType).map((controlLink) =>
    getSecurityControlLinkSummary(controlLink),
  );
}

function hasMatchingControlLink(
  controlLinks: Array<{ internalControlId: string; itemId: string }>,
  input: { internalControlId: string; itemId: string },
) {
  return controlLinks.some(
    (entry) => entry.internalControlId === input.internalControlId && entry.itemId === input.itemId,
  );
}

async function safeCollectTableRows<
  TTableName extends 'followUpActions' | 'securityControlEvidence',
>(ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>, tableName: TTableName) {
  const queryResult = ctx.db.query(tableName) as {
    collect?: () => Promise<unknown[]>;
  };
  return typeof queryResult.collect === 'function' ? await queryResult.collect() : [];
}

async function buildFollowUpActionSummaries(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  options?: {
    findingKey?: string;
  },
) {
  const followUpActions = options?.findingKey
    ? await ctx.db
        .query('followUpActions')
        .withIndex('by_finding_key_and_opened_at', (q) => q.eq('findingKey', options.findingKey!))
        .order('desc')
        .collect()
    : await (async () => {
        return (await safeCollectTableRows(ctx, 'followUpActions')) as Array<{
          _id: Id<'followUpActions'>;
          assigneeUserId?: string | null;
          controlLinks: Array<{ internalControlId: string; itemId: string }>;
          dueAt?: number | null;
          findingId: Id<'securityFindings'>;
          findingKey: string;
          latestNote?: string | null;
          openedAt: number;
          resolutionNote?: string | null;
          resolvedAt?: number | null;
          reviewRunId?: Id<'reviewRuns'>;
          reviewTaskId?: Id<'reviewTasks'>;
          status: 'open' | 'in_progress' | 'blocked' | 'resolved';
          summary?: string | null;
          title: string;
          updatedAt: number;
        }>;
      })();
  const followUpIds = new Set(followUpActions.map((action) => action._id));
  const assigneeIds = Array.from(
    new Set(
      followUpActions
        .map((action) => action.assigneeUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const [actorDisplayById, evidenceRows] = await Promise.all([
    buildActorDisplayMap(ctx, assigneeIds),
    safeCollectTableRows(ctx, 'securityControlEvidence') as Promise<
      Array<{
        _id: Id<'securityControlEvidence'>;
        internalControlId: string;
        itemId: string;
        lifecycleStatus?: 'active' | 'archived' | 'superseded';
        reviewOriginSourceId?: string;
        reviewOriginSourceType?:
          | 'security_control_evidence'
          | 'evidence_report'
          | 'security_finding'
          | 'follow_up_action'
          | 'backup_verification_report'
          | 'external_document'
          | 'review_task'
          | 'vendor';
        reviewStatus?: 'pending' | 'reviewed';
        reviewedAt?: number | null;
        title: string;
      }>
    >,
  ]);
  const reviewedEvidenceByActionId = evidenceRows.reduce<
    Map<
      string,
      Array<{
        id: Id<'securityControlEvidence'>;
        internalControlId: string;
        itemId: string;
        reviewedAt: number | null;
        title: string;
      }>
    >
  >((accumulator, evidence) => {
    if (
      evidence.reviewOriginSourceType !== 'follow_up_action' ||
      !evidence.reviewOriginSourceId ||
      !followUpIds.has(evidence.reviewOriginSourceId as Id<'followUpActions'>) ||
      evidence.reviewStatus !== 'reviewed' ||
      (evidence.lifecycleStatus ?? 'active') !== 'active'
    ) {
      return accumulator;
    }
    const current = accumulator.get(evidence.reviewOriginSourceId) ?? [];
    current.push({
      id: evidence._id,
      internalControlId: evidence.internalControlId,
      itemId: evidence.itemId,
      reviewedAt: evidence.reviewedAt ?? null,
      title: evidence.title,
    });
    accumulator.set(evidence.reviewOriginSourceId, current);
    return accumulator;
  }, new Map());

  const now = Date.now();
  return followUpActions
    .map((action) => {
      const reviewedEvidence = (reviewedEvidenceByActionId.get(action._id) ?? [])
        .filter((entry) => hasMatchingControlLink(action.controlLinks, entry))
        .sort((left, right) => (right.reviewedAt ?? 0) - (left.reviewedAt ?? 0));

      return {
        assigneeDisplay: getActorDisplayName(actorDisplayById, action.assigneeUserId ?? undefined),
        assigneeUserId: action.assigneeUserId ?? null,
        controlLinks: action.controlLinks.map((controlLink) =>
          getSecurityControlLinkSummary(controlLink),
        ),
        dueAt: action.dueAt ?? null,
        findingKey: action.findingKey,
        id: action._id,
        isOverdue:
          action.status !== 'resolved' && typeof action.dueAt === 'number' && action.dueAt < now,
        latestNote: action.latestNote ?? null,
        openedAt: action.openedAt,
        resolutionNote: action.resolutionNote ?? null,
        resolvedAt: action.resolvedAt ?? null,
        reviewedEvidence,
        reviewedEvidenceCount: reviewedEvidence.length,
        reviewRunId: action.reviewRunId ?? null,
        reviewTaskId: action.reviewTaskId ?? null,
        status: action.status,
        summary: action.summary ?? null,
        title: action.title,
        updatedAt: action.updatedAt,
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function getActiveFollowUpByFindingKey(
  followUpActions: Awaited<ReturnType<typeof buildFollowUpActionSummaries>>,
) {
  return followUpActions.reduce<Map<string, (typeof followUpActions)[number]>>(
    (accumulator, action) => {
      if (action.status === 'resolved') {
        return accumulator;
      }
      const existing = accumulator.get(action.findingKey);
      if (existing && existing.updatedAt >= action.updatedAt) {
        return accumulator;
      }
      accumulator.set(action.findingKey, action);
      return accumulator;
    },
    new Map(),
  );
}

function toPublicFollowUpActionSummary(
  followUpAction: Awaited<ReturnType<typeof buildFollowUpActionSummaries>>[number],
) {
  const { findingKey: _findingKey, ...summary } = followUpAction;
  return summary;
}

async function buildSecurityFindingListRecords(ctx: QueryCtx) {
  const [currentFindings, followUpActions, relationships] = await Promise.all([
    buildCurrentSecurityFindings(ctx),
    buildFollowUpActionSummaries(ctx),
    ctx.db
      .query('securityRelationships')
      .withIndex('by_from', (q) => q.eq('fromType', 'finding'))
      .collect(),
  ]);
  const storedFindingEntries = await Promise.all(
    currentFindings.map(async (finding) => {
      const record = await ctx.db
        .query('securityFindings')
        .withIndex('by_finding_key', (q) => q.eq('findingKey', finding.findingKey))
        .unique();
      return [finding.findingKey, record] as const;
    }),
  );
  const storedFindingByKey = new Map(storedFindingEntries);
  const reviewedByIds = Array.from(
    new Set(
      storedFindingEntries
        .map(([, record]) => record?.reviewedByUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const activeFollowUpByFindingKey = getActiveFollowUpByFindingKey(followUpActions);
  const followUpRelationships = relationships.filter(
    (relationship) =>
      relationship.relationshipType === 'follow_up_for' && relationship.toType === 'review_run',
  );
  const reviewRunIds = Array.from(
    new Set(followUpRelationships.map((relationship) => relationship.toId as Id<'reviewRuns'>)),
  );
  const [reviewedByProfiles, reviewRuns] = await Promise.all([
    Promise.all(
      reviewedByIds.map(async (authUserId) => {
        const profile = await ctx.db
          .query('userProfiles')
          .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
          .first();
        return [authUserId, profile?.name?.trim() || profile?.email?.trim() || null] as const;
      }),
    ),
    Promise.all(reviewRunIds.map(async (reviewRunId) => await ctx.db.get(reviewRunId))),
  ]);
  const reviewedByDisplayById = new Map(reviewedByProfiles);
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const latestFollowUpByFindingKey = followUpRelationships.reduce<
    Map<
      string,
      {
        id: Id<'reviewRuns'>;
        status: 'ready' | 'needs_attention' | 'completed';
        title: string;
      }
    >
  >((accumulator, relationship) => {
    const reviewRun = reviewRunById.get(relationship.toId as Id<'reviewRuns'>);
    if (!reviewRun) {
      return accumulator;
    }
    const existing = accumulator.get(relationship.fromId);
    if (existing && reviewRun.createdAt <= reviewRunById.get(existing.id)!.createdAt) {
      return accumulator;
    }
    accumulator.set(relationship.fromId, {
      id: reviewRun._id,
      status: reviewRun.status,
      title: reviewRun.title,
    });
    return accumulator;
  }, new Map());

  return currentFindings.map((finding) => {
    const record = storedFindingByKey.get(finding.findingKey) ?? null;
    const activeFollowUp = activeFollowUpByFindingKey.get(finding.findingKey) ?? null;
    return {
      customerSummary: record?.customerSummary ?? null,
      description: finding.description,
      disposition: record?.disposition ?? ('pending_review' as const),
      findingKey: finding.findingKey,
      findingType: finding.findingType,
      firstObservedAt: record
        ? Math.min(record.firstObservedAt, finding.firstObservedAt)
        : finding.firstObservedAt,
      followUpOverdue: activeFollowUpByFindingKey.get(finding.findingKey)?.isOverdue ?? false,
      hasOpenFollowUp: activeFollowUpByFindingKey.has(finding.findingKey),
      internalNotes: record?.internalReviewNotes ?? null,
      lastObservedAt: Math.max(
        record?.lastObservedAt ?? finding.lastObservedAt,
        finding.lastObservedAt,
      ),
      activeFollowUp: activeFollowUp ? toPublicFollowUpActionSummary(activeFollowUp) : null,
      latestLinkedReviewRun: latestFollowUpByFindingKey.get(finding.findingKey) ?? null,
      relatedControls: getSecurityFindingRelatedControls(finding.findingType),
      scopeId: normalizeSecurityScope(record ?? {}).scopeId,
      scopeType: normalizeSecurityScope(record ?? {}).scopeType,
      reviewedAt: record?.reviewedAt ?? null,
      reviewedByDisplay: getActorDisplayName(
        reviewedByDisplayById,
        record?.reviewedByUserId ?? undefined,
      ),
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
    };
  });
}

export async function listSecurityControlEvidenceActivityHandler(
  ctx: QueryCtx,
  args: {
    internalControlId: string;
    itemId: string;
  },
) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

  type EvidenceActivityRow = {
    actorUserId: string | null;
    auditEventId: string;
    createdAt: number;
    eventType:
      | 'security_control_evidence_created'
      | 'security_control_evidence_reviewed'
      | 'security_control_evidence_archived'
      | 'security_control_evidence_renewed';
    evidenceId: string;
    evidenceTitle: string;
    internalControlId: string;
    itemId: string;
    lifecycleStatus: 'active' | 'archived' | 'superseded' | null;
    renewedFromEvidenceId: string | null;
    replacedByEvidenceId: string | null;
    reviewStatus: 'pending' | 'reviewed' | null;
  };

  const activityLogs = await ctx.db
    .query('securityControlEvidenceActivity')
    .withIndex('by_internal_control_id_and_item_id_and_created_at', (q) =>
      q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
    )
    .order('desc')
    .collect();

  const matchingLogs: EvidenceActivityRow[] = activityLogs.map(
    (log): EvidenceActivityRow => ({
      actorUserId: log.actorUserId,
      auditEventId: log.auditEventId,
      createdAt: log.createdAt,
      eventType: log.eventType,
      evidenceId: log.evidenceId,
      evidenceTitle: log.evidenceTitle,
      internalControlId: log.internalControlId,
      itemId: log.itemId,
      lifecycleStatus:
        log.lifecycleStatus === 'active' ||
        log.lifecycleStatus === 'archived' ||
        log.lifecycleStatus === 'superseded'
          ? log.lifecycleStatus
          : null,
      renewedFromEvidenceId: log.renewedFromEvidenceId,
      replacedByEvidenceId: log.replacedByEvidenceId,
      reviewStatus:
        log.reviewStatus === 'pending' || log.reviewStatus === 'reviewed' ? log.reviewStatus : null,
    }),
  );

  const actorIds = Array.from(
    new Set(
      matchingLogs
        .map((log) => log.actorUserId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
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

  return matchingLogs.map((log) => ({
    id: log.auditEventId,
    eventType: log.eventType,
    actorDisplay: getActorDisplayName(actorDisplayById, log.actorUserId ?? undefined),
    createdAt: log.createdAt,
    evidenceId: log.evidenceId,
    evidenceTitle: log.evidenceTitle,
    internalControlId: log.internalControlId,
    itemId: log.itemId,
    lifecycleStatus: log.lifecycleStatus,
    renewedFromEvidenceId: log.renewedFromEvidenceId,
    replacedByEvidenceId: log.replacedByEvidenceId,
    reviewStatus: log.reviewStatus,
  }));
}

export async function listSecurityFindingsHandler(ctx: QueryCtx) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  return await buildSecurityFindingListRecords(ctx);
}

export async function listFollowUpActionsHandler(
  ctx: QueryCtx,
  args: {
    findingKey?: string;
  },
) {
  await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  return (await buildFollowUpActionSummaries(ctx, args)).map((entry) =>
    toPublicFollowUpActionSummary(entry),
  );
}

async function getStoredFindingRecordOrThrow(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    findingKey: string;
  },
) {
  await syncCurrentSecurityFindings(ctx, args.actorUserId);
  const findingRecord = await ctx.db
    .query('securityFindings')
    .withIndex('by_finding_key', (q) => q.eq('findingKey', args.findingKey))
    .unique();
  if (!findingRecord) {
    throwConvexError('NOT_FOUND', 'Security finding not found.');
  }
  return findingRecord;
}

async function validateFollowUpActionControlLinksOrThrow(args: {
  findingType:
    | 'audit_integrity_failures'
    | 'audit_archive_health'
    | 'audit_request_context_gaps'
    | 'document_scan_quarantines'
    | 'document_scan_rejections'
    | 'release_security_validation';
  controlLinks: Array<{ internalControlId: string; itemId: string }>;
}) {
  if (args.controlLinks.length === 0) {
    throwConvexError('VALIDATION', 'Select at least one checklist item for tracked follow-up.');
  }
  const allowedLinks = getSecurityFindingControlLinks(args.findingType);
  const invalidLink = args.controlLinks.find(
    (controlLink) => !hasMatchingControlLink(allowedLinks, controlLink),
  );
  if (invalidLink) {
    throwConvexError('VALIDATION', 'Follow-up links must match the finding control mapping.');
  }
}

async function assertFollowUpAssigneeOrThrow(
  ctx: MutationCtx,
  assigneeUserId: string | null | undefined,
) {
  if (!assigneeUserId) {
    return null;
  }
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', assigneeUserId))
    .first();
  if (!profile?.isSiteAdmin || profile.banned) {
    throwConvexError('VALIDATION', 'Select an active site admin assignee.');
  }
  return assigneeUserId;
}

export async function createFollowUpActionHandler(
  ctx: MutationCtx,
  args: {
    findingKey: string;
    controlLinks: Array<{ internalControlId: string; itemId: string }>;
    dueAt?: number | null;
    reviewRunId?: Id<'reviewRuns'>;
    reviewTaskId?: Id<'reviewTasks'>;
    summary?: string | null;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const findingRecord = await getStoredFindingRecordOrThrow(ctx, {
    actorUserId: currentUser.authUserId,
    findingKey: args.findingKey,
  });
  if (findingRecord.status !== 'open') {
    throwConvexError('VALIDATION', 'Tracked follow-up can only be opened for open findings.');
  }
  await validateFollowUpActionControlLinksOrThrow({
    controlLinks: args.controlLinks,
    findingType: findingRecord.findingType,
  });
  const existingActions = await ctx.db
    .query('followUpActions')
    .withIndex('by_finding_key_and_opened_at', (q) => q.eq('findingKey', args.findingKey))
    .collect();
  if (existingActions.some((action) => action.status !== 'resolved')) {
    throwConvexError('VALIDATION', 'This finding already has an active tracked follow-up.');
  }

  const now = Date.now();
  await ctx.db.insert('followUpActions', {
    ...getSecurityScopeFields(),
    assigneeUserId: currentUser.authUserId,
    controlLinks: args.controlLinks,
    dueAt: args.dueAt ?? null,
    findingId: findingRecord._id,
    findingKey: findingRecord.findingKey,
    latestNote: null,
    openedAt: now,
    openedByUserId: currentUser.authUserId,
    resolutionNote: null,
    resolvedAt: null,
    resolvedByUserId: null,
    reviewRunId: args.reviewRunId,
    reviewTaskId: args.reviewTaskId,
    status: 'open',
    summary: args.summary?.trim() || undefined,
    title: `${findingRecord.title} remediation`,
    updatedAt: now,
    updatedByUserId: currentUser.authUserId,
  });

  return (await buildSecurityFindingListRecords(ctx as QueryCtx)).find(
    (entry) => entry.findingKey === findingRecord.findingKey,
  )!;
}

export async function updateFollowUpActionHandler(
  ctx: MutationCtx,
  args: {
    assigneeUserId?: string | null;
    dueAt?: number | null;
    followUpActionId: Id<'followUpActions'>;
    latestNote?: string | null;
    status?: 'open' | 'in_progress' | 'blocked';
    summary?: string | null;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const action = await ctx.db.get(args.followUpActionId);
  if (!action) {
    throwConvexError('NOT_FOUND', 'Tracked follow-up not found.');
  }
  if (action.status === 'resolved') {
    throwConvexError('VALIDATION', 'Resolved follow-up actions cannot be edited.');
  }

  const assigneeUserId =
    args.assigneeUserId === undefined
      ? undefined
      : await assertFollowUpAssigneeOrThrow(ctx, args.assigneeUserId);
  const now = Date.now();
  await ctx.db.patch(action._id, {
    assigneeUserId,
    dueAt: args.dueAt ?? undefined,
    latestNote: args.latestNote === undefined ? undefined : args.latestNote?.trim() || null,
    status: args.status ?? undefined,
    summary: args.summary === undefined ? undefined : args.summary?.trim() || undefined,
    updatedAt: now,
    updatedByUserId: currentUser.authUserId,
  });

  return toPublicFollowUpActionSummary(
    (await buildFollowUpActionSummaries(ctx, { findingKey: action.findingKey })).find(
      (entry) => entry.id === action._id,
    )!,
  );
}

export async function resolveFollowUpActionHandler(
  ctx: MutationCtx,
  args: {
    followUpActionId: Id<'followUpActions'>;
    resolutionNote?: string | null;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const action = await ctx.db.get(args.followUpActionId);
  if (!action) {
    throwConvexError('NOT_FOUND', 'Tracked follow-up not found.');
  }
  if (action.status === 'resolved') {
    throwConvexError('VALIDATION', 'Tracked follow-up is already resolved.');
  }
  const evidenceRows = await ctx.db
    .query('securityControlEvidence')
    .withIndex('by_review_origin_source_type_and_source_id', (q) =>
      q.eq('reviewOriginSourceType', 'follow_up_action').eq('reviewOriginSourceId', action._id),
    )
    .collect();
  const reviewedEvidence = evidenceRows.filter(
    (entry) =>
      entry.reviewStatus === 'reviewed' &&
      (entry.lifecycleStatus ?? 'active') === 'active' &&
      hasMatchingControlLink(action.controlLinks, entry),
  );
  if (reviewedEvidence.length === 0) {
    throwConvexError(
      'VALIDATION',
      'Resolve the tracked follow-up only after reviewed closure evidence is attached.',
    );
  }

  const now = Date.now();
  await ctx.db.patch(action._id, {
    resolutionNote: args.resolutionNote?.trim() || null,
    resolvedAt: now,
    resolvedByUserId: currentUser.authUserId,
    status: 'resolved',
    updatedAt: now,
    updatedByUserId: currentUser.authUserId,
  });

  return toPublicFollowUpActionSummary(
    (await buildFollowUpActionSummaries(ctx, { findingKey: action.findingKey })).find(
      (entry) => entry.id === action._id,
    )!,
  );
}

export async function validateFollowUpActionEvidenceContextOrThrow(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  args: {
    followUpActionId?: Id<'followUpActions'>;
    internalControlId: string;
    itemId: string;
  },
) {
  if (!args.followUpActionId) {
    return null;
  }
  const action = await ctx.db.get(args.followUpActionId);
  if (!action) {
    throwConvexError('NOT_FOUND', 'Tracked follow-up not found.');
  }
  if (action.status === 'resolved') {
    throwConvexError('VALIDATION', 'Resolved follow-up actions cannot accept new evidence.');
  }
  if (!hasMatchingControlLink(action.controlLinks, args)) {
    throwConvexError(
      'VALIDATION',
      'Closure evidence must target one of the tracked follow-up checklist items.',
    );
  }
  return action;
}

export async function reviewSecurityFindingHandler(
  ctx: MutationCtx,
  args: {
    customerSummary?: string;
    disposition:
      | 'accepted_risk'
      | 'false_positive'
      | 'investigating'
      | 'pending_review'
      | 'resolved';
    findingKey: string;
    internalNotes?: string;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  await syncCurrentSecurityFindings(ctx, currentUser.authUserId);
  const finding = (await buildCurrentSecurityFindings(ctx)).find(
    (entry) => entry.findingKey === args.findingKey,
  );

  if (!finding) {
    throw new Error('Security finding not found');
  }

  const now = Date.now();
  const existing = await ctx.db
    .query('securityFindings')
    .withIndex('by_finding_key', (q) => q.eq('findingKey', args.findingKey))
    .unique();
  let findingRecordId = existing?._id ?? null;
  const internalNotes = args.internalNotes?.trim() || null;

  if (existing) {
    await ctx.db.patch(existing._id, {
      customerSummary: args.customerSummary?.trim() || null,
      description: finding.description,
      disposition: args.disposition,
      findingType: finding.findingType,
      firstObservedAt: Math.min(existing.firstObservedAt, finding.firstObservedAt),
      internalReviewNotes: internalNotes,
      lastObservedAt: Math.max(existing.lastObservedAt, finding.lastObservedAt),
      reviewedAt: now,
      reviewedByUserId: currentUser.authUserId,
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
      updatedAt: now,
    });
  } else {
    findingRecordId = await ctx.db.insert('securityFindings', {
      ...getSecurityScopeFields(),
      description: finding.description,
      disposition: args.disposition,
      findingKey: finding.findingKey,
      findingType: finding.findingType,
      firstObservedAt: finding.firstObservedAt,
      lastObservedAt: finding.lastObservedAt,
      internalReviewNotes: internalNotes,
      reviewedAt: now,
      reviewedByUserId: currentUser.authUserId,
      severity: finding.severity,
      sourceLabel: finding.sourceLabel,
      sourceRecordId: finding.sourceRecordId,
      sourceType: finding.sourceType,
      status: finding.status,
      title: finding.title,
      customerSummary: args.customerSummary?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
  }
  findingRecordId ??= existing?._id ?? null;
  if (findingRecordId) {
    for (const controlLink of getSecurityFindingControlLinks(finding.findingType)) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: currentUser.authUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_finding',
        toId: finding.findingKey,
        toType: 'finding',
      });
    }
  }

  const reviewerProfile = await ctx.db
    .query('userProfiles')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', currentUser.authUserId))
    .first();
  const updatedFinding = (await buildSecurityFindingListRecords(ctx as QueryCtx)).find(
    (entry) => entry.findingKey === finding.findingKey,
  );
  if (
    updatedFinding &&
    updatedFinding.disposition === args.disposition &&
    updatedFinding.internalNotes === internalNotes
  ) {
    return updatedFinding;
  }

  return {
    activeFollowUp: null,
    customerSummary: args.customerSummary?.trim() || null,
    description: finding.description,
    disposition: args.disposition,
    findingKey: finding.findingKey,
    findingType: finding.findingType,
    firstObservedAt: existing
      ? Math.min(existing.firstObservedAt, finding.firstObservedAt)
      : finding.firstObservedAt,
    followUpOverdue: false,
    hasOpenFollowUp: false,
    internalNotes,
    lastObservedAt: existing
      ? Math.max(existing.lastObservedAt, finding.lastObservedAt)
      : finding.lastObservedAt,
    latestLinkedReviewRun: null,
    relatedControls: getSecurityFindingRelatedControls(finding.findingType),
    scopeId: normalizeSecurityScope(existing ?? {}).scopeId,
    scopeType: normalizeSecurityScope(existing ?? {}).scopeType,
    reviewedAt: now,
    reviewedByDisplay:
      reviewerProfile?.name?.trim() ||
      reviewerProfile?.email?.trim() ||
      getActorDisplayName(new Map(), currentUser.authUserId),
    severity: finding.severity,
    sourceLabel: finding.sourceLabel,
    sourceRecordId: finding.sourceRecordId,
    sourceType: finding.sourceType,
    status: finding.status,
    title: finding.title,
  };
}

export { buildSecurityFindingListRecords };

export async function archiveSecurityControlEvidenceHandler(
  ctx: MutationCtx,
  args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const now = Date.now();

  if (args.evidenceId.includes(':seed:')) {
    const seededEvidence = getSeededEvidenceEntry(
      args.internalControlId,
      args.itemId,
      args.evidenceId,
    );
    if (!seededEvidence) {
      throw new Error('Seeded evidence not found.');
    }

    const existing = await ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
      )
      .unique();
    const archivedSeedEvidence = existing?.archivedSeedEvidence ?? [];
    const nextArchivedSeedEvidence = [
      ...archivedSeedEvidence.filter((entry) => entry.evidenceId !== args.evidenceId),
      {
        evidenceId: args.evidenceId,
        lifecycleStatus: 'archived' as const,
        archivedAt: now,
        archivedByUserId: currentUser.authUserId,
      },
    ];
    const patch = {
      hiddenSeedEvidenceIds: Array.from(
        new Set([...(existing?.hiddenSeedEvidenceIds ?? []), args.evidenceId]),
      ),
      archivedSeedEvidence: nextArchivedSeedEvidence,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlChecklistItems', {
        ...getSecurityScopeFields(),
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        createdAt: now,
        ...patch,
      });
    }

    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_archived',
      evidenceId: args.evidenceId,
      evidenceTitle: seededEvidence.entry.title,
      evidenceType: seededEvidence.entry.evidenceType,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'archived',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'reviewed',
    });

    return null;
  }

  const evidenceId = args.evidenceId as Id<'securityControlEvidence'>;
  const evidence = await ctx.db.get(evidenceId);
  if (!evidence) {
    throw new Error('Evidence not found.');
  }
  if ((evidence.lifecycleStatus ?? 'active') !== 'active') {
    throw new Error('Only active evidence can be archived.');
  }

  await ctx.db.patch(evidenceId, {
    lifecycleStatus: 'archived',
    archivedAt: now,
    archivedByUserId: currentUser.authUserId,
    updatedAt: now,
  });
  await recordSecurityControlEvidenceAuditEvent(ctx, {
    actorUserId: currentUser.authUserId,
    eventType: 'security_control_evidence_archived',
    evidenceId: evidence._id,
    evidenceTitle: evidence.title,
    evidenceType: evidence.evidenceType,
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    lifecycleStatus: 'archived',
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reviewStatus: evidence.reviewStatus ?? 'pending',
  });
  return null;
}

export async function renewSecurityControlEvidenceHandler(
  ctx: MutationCtx,
  args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  },
): Promise<Id<'securityControlEvidence'>> {
  const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
  const now = Date.now();

  if (args.evidenceId.includes(':seed:')) {
    const seededEvidence = getSeededEvidenceEntry(
      args.internalControlId,
      args.itemId,
      args.evidenceId,
    );
    if (!seededEvidence) {
      throw new Error('Seeded evidence not found.');
    }

    const newEvidenceId = await ctx.db.insert('securityControlEvidence', {
      ...getSecurityScopeFields(),
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: seededEvidence.entry.evidenceType,
      title: seededEvidence.entry.title,
      description: seededEvidence.entry.description ?? undefined,
      url: seededEvidence.entry.url ?? undefined,
      sufficiency: seededEvidence.entry.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      renewedFromEvidenceId: args.evidenceId as Id<'securityControlEvidence'>,
      createdAt: now,
      updatedAt: now,
    });

    const existing = await ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
      )
      .unique();
    const nextArchivedSeedEvidence = [
      ...(existing?.archivedSeedEvidence ?? []).filter(
        (entry) => entry.evidenceId !== args.evidenceId,
      ),
      {
        evidenceId: args.evidenceId,
        lifecycleStatus: 'superseded' as const,
        archivedAt: now,
        archivedByUserId: currentUser.authUserId,
        replacedByEvidenceId: newEvidenceId,
      },
    ];
    const patch = {
      hiddenSeedEvidenceIds: Array.from(
        new Set([...(existing?.hiddenSeedEvidenceIds ?? []), args.evidenceId]),
      ),
      archivedSeedEvidence: nextArchivedSeedEvidence,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlChecklistItems', {
        ...getSecurityScopeFields(),
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        createdAt: now,
        ...patch,
      });
    }

    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_created',
      evidenceId: newEvidenceId,
      evidenceTitle: seededEvidence.entry.title,
      evidenceType: seededEvidence.entry.evidenceType,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
      renewedFromEvidenceId: args.evidenceId,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_renewed',
      evidenceId: newEvidenceId,
      evidenceTitle: seededEvidence.entry.title,
      evidenceType: seededEvidence.entry.evidenceType,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
      renewedFromEvidenceId: args.evidenceId,
      replacedByEvidenceId: newEvidenceId,
    });

    return newEvidenceId;
  }

  const evidenceId = args.evidenceId as Id<'securityControlEvidence'>;
  const evidence = await ctx.db.get(evidenceId);
  if (!evidence) {
    throw new Error('Evidence not found.');
  }
  if ((evidence.lifecycleStatus ?? 'active') !== 'active') {
    throw new Error('Only active evidence can be renewed.');
  }

  const newEvidenceId = await ctx.db.insert('securityControlEvidence', {
    ...getSecurityScopeFields(),
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    evidenceType: evidence.evidenceType,
    title: evidence.title,
    description: evidence.description,
    url: evidence.url,
    storageId: evidence.storageId,
    fileName: evidence.fileName,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    evidenceDate: evidence.evidenceDate,
    reviewDueIntervalMonths: evidence.reviewDueIntervalMonths,
    source: evidence.source,
    sufficiency: evidence.sufficiency,
    uploadedByUserId: currentUser.authUserId,
    reviewStatus: 'pending',
    lifecycleStatus: 'active',
    renewedFromEvidenceId: evidence._id,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.patch(evidenceId, {
    lifecycleStatus: 'superseded',
    archivedAt: now,
    archivedByUserId: currentUser.authUserId,
    replacedByEvidenceId: newEvidenceId,
    updatedAt: now,
  });

  await recordSecurityControlEvidenceAuditEvent(ctx, {
    actorUserId: currentUser.authUserId,
    eventType: 'security_control_evidence_created',
    evidenceId: newEvidenceId,
    evidenceTitle: evidence.title,
    evidenceType: evidence.evidenceType,
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    lifecycleStatus: 'active',
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reviewStatus: 'pending',
    renewedFromEvidenceId: evidence._id,
  });
  await recordSecurityControlEvidenceAuditEvent(ctx, {
    actorUserId: currentUser.authUserId,
    eventType: 'security_control_evidence_renewed',
    evidenceId: newEvidenceId,
    evidenceTitle: evidence.title,
    evidenceType: evidence.evidenceType,
    internalControlId: evidence.internalControlId,
    itemId: evidence.itemId,
    lifecycleStatus: 'active',
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reviewStatus: 'pending',
    renewedFromEvidenceId: evidence._id,
    replacedByEvidenceId: newEvidenceId,
  });

  return newEvidenceId;
}
