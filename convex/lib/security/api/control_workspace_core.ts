import type { Id } from '../../../_generated/dataModel';
import type { QueryCtx } from '../../../_generated/server';
import { getVendorBoundarySnapshot } from '../../../../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../../../../src/lib/shared/compliance/control-register';
import { getSecurityScopeFields, hasActiveReviewSatisfaction } from './core';
import {
  addMonths,
  buildActorDisplayMap,
  deriveChecklistItemStatus,
  deriveEvidenceExpiryStatus,
  deriveEvidenceReadiness,
  deriveItemEvidenceSufficiency,
  getActorDisplayName,
  getSeededEvidenceEntry,
  hasExpiringSoonEvidence,
  resolveSeedSiteAdminActor,
} from './operations_core';

async function listSecurityControlWorkspaceSummaryRecords(ctx: QueryCtx) {
  type ChecklistSummary = {
    evidence: Array<{
      expiryStatus: 'none' | 'current' | 'expiring_soon';
      lifecycleStatus: 'active' | 'archived' | 'superseded';
      reviewStatus: 'pending' | 'reviewed';
    }>;
    hasExpiringSoonEvidence: boolean;
    itemId: string;
    label: string;
    lastReviewedAt: number | null;
    operatorNotes: string | null;
    required: boolean;
    status: 'done' | 'in_progress' | 'not_applicable' | 'not_started';
  };
  const [allChecklistItems, allEvidenceRows] = await Promise.all([
    ctx.db.query('securityControlChecklistItems').collect(),
    ctx.db.query('securityControlEvidence').collect(),
  ]);
  const reviewSatisfactionEntries = allChecklistItems
    .map((item) => item.reviewSatisfaction ?? null)
    .filter(
      (entry): entry is NonNullable<(typeof allChecklistItems)[number]['reviewSatisfaction']> =>
        entry !== null,
    );
  const reviewTaskIds = Array.from(
    new Set(reviewSatisfactionEntries.map((entry) => entry.reviewTaskId)),
  );
  const reviewTasks = await Promise.all(
    reviewTaskIds.map((reviewTaskId) => ctx.db.get(reviewTaskId)),
  );
  const reviewTaskById = new Map(
    reviewTasks
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const reviewRunIds = Array.from(
    new Set(
      reviewSatisfactionEntries.flatMap((entry) => {
        const task = reviewTaskById.get(entry.reviewTaskId);
        return [entry.reviewRunId, task?.reviewRunId].filter(
          (value): value is Id<'reviewRuns'> => value !== undefined,
        );
      }),
    ),
  );
  const reviewRuns = await Promise.all(reviewRunIds.map((reviewRunId) => ctx.db.get(reviewRunId)));
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const checklistStateByKey = new Map(
    allChecklistItems.map((item) => [`${item.internalControlId}:${item.itemId}`, item] as const),
  );
  const evidenceByKey = allEvidenceRows.reduce<
    Map<string, Array<(typeof allEvidenceRows)[number]>>
  >((accumulator, evidence) => {
    const key = `${evidence.internalControlId}:${evidence.itemId}`;
    const current = accumulator.get(key) ?? [];
    current.push(evidence);
    accumulator.set(key, current);
    return accumulator;
  }, new Map());
  const seededReviewedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);

  return ACTIVE_CONTROL_REGISTER.controls.map((control) => {
    const checklistSummaries: ChecklistSummary[] = control.platformChecklistItems.map(
      (item): ChecklistSummary => {
        const itemState = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
        const reviewSatisfactionIsActive =
          itemState?.reviewSatisfaction &&
          hasActiveReviewSatisfaction(
            itemState.reviewSatisfaction,
            reviewTaskById.get(itemState.reviewSatisfaction.reviewTaskId),
            reviewRunById.get(itemState.reviewSatisfaction.reviewRunId),
          );
        const hiddenSeedEvidenceIds = new Set(itemState?.hiddenSeedEvidenceIds ?? []);
        const archivedSeedEvidenceById = new Map(
          (itemState?.archivedSeedEvidence ?? []).map(
            (entry) => [entry.evidenceId, entry] as const,
          ),
        );
        const seededEvidence = item.seed.evidence
          .map((entry, index) => ({
            id: `${control.internalControlId}:${item.itemId}:seed:${index}`,
            lifecycleStatus: 'active' as const,
            reviewStatus: 'reviewed' as const,
            expiryStatus: 'none' as const,
          }))
          .filter((entry) => !hiddenSeedEvidenceIds.has(entry.id));
        const archivedSeedEvidence = Array.from(hiddenSeedEvidenceIds)
          .map((evidenceId) => {
            const seededEntry = getSeededEvidenceEntry(
              control.internalControlId,
              item.itemId,
              evidenceId,
            );
            if (!seededEntry) {
              return null;
            }
            return {
              lifecycleStatus:
                archivedSeedEvidenceById.get(evidenceId)?.lifecycleStatus ?? ('archived' as const),
              reviewStatus: 'reviewed' as const,
              expiryStatus: 'none' as const,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        const persistedEvidence = (
          evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []
        ).map((entry) => {
          const reviewDueIntervalMonths = entry.reviewDueIntervalMonths ?? null;
          const reviewedAt = entry.reviewedAt ?? null;
          const reviewDueAt =
            reviewedAt !== null && reviewDueIntervalMonths !== null
              ? addMonths(reviewedAt, reviewDueIntervalMonths)
              : null;
          return {
            lifecycleStatus: entry.lifecycleStatus ?? ('active' as const),
            reviewStatus:
              entry.reviewStatus ??
              (entry.reviewedAt ? ('reviewed' as const) : ('pending' as const)),
            expiryStatus: deriveEvidenceExpiryStatus({
              reviewDueAt,
              reviewedAt,
            }),
          };
        });
        const evidence = [...seededEvidence, ...persistedEvidence, ...archivedSeedEvidence];
        const evidenceDerivedStatus = deriveChecklistItemStatus(evidence);
        const manualStatus = itemState?.manualStatus ?? itemState?.status ?? null;
        const derivedStatus =
          manualStatus ??
          (evidenceDerivedStatus === 'done' || reviewSatisfactionIsActive
            ? ('done' as const)
            : evidenceDerivedStatus);
        const lastReviewedAtCandidates = [
          item.seed.evidence.length > 0 || derivedStatus !== 'not_started'
            ? seededReviewedAt
            : null,
          ...(evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []).flatMap(
            (entry) => [entry.reviewedAt ?? null, entry.createdAt, entry.archivedAt ?? null],
          ),
        ];
        const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
          if (typeof value !== 'number') {
            return latest;
          }
          return latest === null ? value : Math.max(latest, value);
        }, null);

        return {
          itemId: item.itemId,
          label: item.label,
          operatorNotes: itemState?.internalOperatorNotes ?? itemState?.notes ?? item.seed.notes,
          required: item.required,
          status: derivedStatus,
          hasExpiringSoonEvidence: hasExpiringSoonEvidence(evidence),
          lastReviewedAt,
          evidence,
        };
      },
    );
    const evidenceReadiness = deriveEvidenceReadiness(checklistSummaries);
    const controlHasExpiringSoonEvidence = checklistSummaries.some(
      (item: ChecklistSummary) => item.hasExpiringSoonEvidence,
    );
    const lastReviewedAt = checklistSummaries.reduce<number | null>(
      (latest, item: ChecklistSummary) => {
        if (typeof item.lastReviewedAt !== 'number') {
          return latest;
        }
        return latest === null ? item.lastReviewedAt : Math.max(latest, item.lastReviewedAt);
      },
      null,
    );
    const checklistStats = {
      completeCount: checklistSummaries.filter((item: ChecklistSummary) => item.status === 'done')
        .length,
      totalCount: checklistSummaries.length,
    };

    return {
      internalControlId: control.internalControlId,
      nist80053Id: control.nist80053Id,
      title: control.title,
      familyId: control.familyId,
      familyTitle: control.familyTitle,
      owner: control.owner,
      priority: control.priority,
      responsibility: control.responsibility,
      implementationSummary: control.implementationSummary,
      customerResponsibilityNotes: control.customerResponsibilityNotes,
      controlStatement: control.controlStatement,
      mappings: {
        ...control.mappings,
        hipaa: control.mappings.hipaa.map((mapping) => ({
          ...mapping,
          text: null,
        })),
      },
      evidenceReadiness,
      hasExpiringSoonEvidence: controlHasExpiringSoonEvidence,
      lastReviewedAt,
      checklistStats,
      searchableText: [
        control.nist80053Id,
        control.title,
        control.implementationSummary,
        control.familyId,
        control.familyTitle,
        control.owner,
        control.responsibility ?? '',
        evidenceReadiness,
        control.customerResponsibilityNotes ?? '',
        ...checklistSummaries.map((item: ChecklistSummary) => item.label),
        ...checklistSummaries.map((item: ChecklistSummary) => item.operatorNotes ?? ''),
        ...control.mappings.hipaa.map((mapping) => mapping.citation),
        ...control.mappings.csf20.map((mapping) => mapping.subcategoryId),
        ...control.mappings.nist80066.map((mapping) => mapping.referenceId),
        ...control.mappings.soc2.map((mapping) => mapping.criterionId),
      ]
        .join(' ')
        .toLowerCase(),
    };
  });
}

async function getSecurityControlWorkspaceRecord(
  ctx: QueryCtx,
  internalControlId: string,
  seedActor?: { authUserId: string },
) {
  const control = ACTIVE_CONTROL_REGISTER.controls.find(
    (entry) => entry.internalControlId === internalControlId,
  );
  if (!control) {
    return null;
  }

  const [checklistItems, evidenceRows, controlRelationships] = await Promise.all([
    ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id', (q) =>
        q.eq('internalControlId', control.internalControlId),
      )
      .collect(),
    ctx.db
      .query('securityControlEvidence')
      .withIndex('by_internal_control_id', (q) =>
        q.eq('internalControlId', control.internalControlId),
      )
      .collect(),
    ctx.db
      .query('securityRelationships')
      .withIndex('by_from', (q) =>
        q.eq('fromType', 'control').eq('fromId', control.internalControlId),
      )
      .collect(),
  ]);
  const reviewSatisfactionEntries = checklistItems
    .map((item) => item.reviewSatisfaction ?? null)
    .filter(
      (entry): entry is NonNullable<(typeof checklistItems)[number]['reviewSatisfaction']> =>
        entry !== null,
    );
  const reviewTaskIds = Array.from(
    new Set(reviewSatisfactionEntries.map((entry) => entry.reviewTaskId)),
  );
  const reviewTasks = await Promise.all(
    reviewTaskIds.map((reviewTaskId) => ctx.db.get(reviewTaskId)),
  );
  const reviewTaskById = new Map(
    reviewTasks
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const reviewRunIds = Array.from(
    new Set(
      reviewSatisfactionEntries.flatMap((entry) => {
        const task = reviewTaskById.get(entry.reviewTaskId);
        return [entry.reviewRunId, task?.reviewRunId].filter(
          (value): value is Id<'reviewRuns'> => value !== undefined,
        );
      }),
    ),
  );
  const reviewRuns = await Promise.all(reviewRunIds.map((reviewRunId) => ctx.db.get(reviewRunId)));
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const reviewTaskEvidenceLinks = await Promise.all(
    reviewTaskIds.map(async (reviewTaskId) => {
      const links = await ctx.db
        .query('reviewTaskEvidenceLinks')
        .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', reviewTaskId))
        .collect();
      return [reviewTaskId, links] as const;
    }),
  );
  const reviewTaskEvidenceLinksByTaskId = new Map(reviewTaskEvidenceLinks);
  const linkedReportIds = Array.from(
    new Set(
      reviewTaskEvidenceLinks.flatMap(([, links]) =>
        links
          .filter((link) => link.sourceType === 'evidence_report')
          .map((link) => link.sourceId as Id<'evidenceReports'>),
      ),
    ),
  );
  const relationshipReviewTaskIds = Array.from(
    new Set(
      controlRelationships
        .filter((relationship) => relationship.toType === 'review_task')
        .map((relationship) => relationship.toId as Id<'reviewTasks'>),
    ),
  );
  const missingRelationshipReviewTaskIds = relationshipReviewTaskIds.filter(
    (reviewTaskId) => !reviewTaskById.has(reviewTaskId),
  );
  const additionalReviewTasks = await Promise.all(
    missingRelationshipReviewTaskIds.map((reviewTaskId) => ctx.db.get(reviewTaskId)),
  );
  for (const task of additionalReviewTasks) {
    if (task) {
      reviewTaskById.set(task._id, task);
    }
  }
  const relationshipFindingKeys = Array.from(
    new Set(
      controlRelationships
        .filter((relationship) => relationship.toType === 'finding')
        .map((relationship) => relationship.toId),
    ),
  );
  const relationshipVendorKeys = Array.from(
    new Set(
      controlRelationships
        .filter((relationship) => relationship.toType === 'vendor_review')
        .map((relationship) => relationship.toId as 'openrouter' | 'resend' | 'sentry'),
    ),
  );
  const relationshipReportIds = Array.from(
    new Set(
      controlRelationships
        .filter((relationship) => relationship.toType === 'evidence_report')
        .map((relationship) => relationship.toId as Id<'evidenceReports'>),
    ),
  );
  const reports = await Promise.all(
    Array.from(new Set([...linkedReportIds, ...relationshipReportIds])).map((reportId) =>
      ctx.db.get(reportId),
    ),
  );
  const reportById = new Map(
    reports
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const vendorReviews = await Promise.all(
    relationshipVendorKeys.map(async (vendorKey) => {
      const review = await ctx.db
        .query('securityVendorReviews')
        .withIndex('by_vendor_key', (q) => q.eq('vendorKey', vendorKey))
        .unique();
      return review ? ([vendorKey, review] as const) : null;
    }),
  );
  const vendorReviewByKey = new Map(
    vendorReviews.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const findingRows = await Promise.all(
    relationshipFindingKeys.map(async (findingKey) => {
      const finding = await ctx.db
        .query('securityFindings')
        .withIndex('by_finding_key', (q) => q.eq('findingKey', findingKey))
        .unique();
      return finding ? ([findingKey, finding] as const) : null;
    }),
  );
  const findingByKey = new Map(
    findingRows.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const vendorRuntimeByKey = new Map(
    getVendorBoundarySnapshot()
      .filter((entry) => relationshipVendorKeys.includes(entry.vendor))
      .map((entry) => [entry.vendor, entry] as const),
  );
  const actorIds = Array.from(
    new Set(
      [
        ...evidenceRows.flatMap((row) => [
          row.uploadedByUserId,
          row.reviewedByUserId,
          row.archivedByUserId,
        ]),
        ...checklistItems.flatMap((item) =>
          (item.archivedSeedEvidence ?? []).map((entry) => entry.archivedByUserId),
        ),
        ...checklistItems.flatMap((item) =>
          item.reviewSatisfaction ? [item.reviewSatisfaction.satisfiedByUserId] : [],
        ),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const actorDisplayById = await buildActorDisplayMap(ctx, actorIds);
  const seededActor = await resolveSeedSiteAdminActor(ctx, seedActor?.authUserId);
  const checklistStateByKey = new Map(
    checklistItems.map((item) => [`${item.internalControlId}:${item.itemId}`, item] as const),
  );
  const evidenceByKey = evidenceRows.reduce<Map<string, Array<(typeof evidenceRows)[number]>>>(
    (accumulator, evidence) => {
      const key = `${evidence.internalControlId}:${evidence.itemId}`;
      const current = accumulator.get(key) ?? [];
      current.push(evidence);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const seededReviewedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);
  const platformChecklist = control.platformChecklistItems.map((item) => {
    const itemState = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
    const satisfactionState =
      itemState?.reviewSatisfaction &&
      hasActiveReviewSatisfaction(
        itemState.reviewSatisfaction,
        reviewTaskById.get(itemState.reviewSatisfaction.reviewTaskId),
        reviewRunById.get(itemState.reviewSatisfaction.reviewRunId),
      )
        ? itemState.reviewSatisfaction
        : null;
    const satisfactionTask = satisfactionState
      ? reviewTaskById.get(satisfactionState.reviewTaskId)
      : null;
    const satisfactionRun = satisfactionState
      ? reviewRunById.get(satisfactionState.reviewRunId)
      : null;
    const reviewSatisfaction =
      satisfactionState && satisfactionTask && satisfactionRun
        ? {
            mode: satisfactionState.mode,
            relatedReports: (
              reviewTaskEvidenceLinksByTaskId.get(satisfactionState.reviewTaskId) ?? []
            )
              .filter((link) => link.sourceType === 'evidence_report')
              .map((link) => {
                const report = reportById.get(link.sourceId as Id<'evidenceReports'>);
                if (!report) {
                  return null;
                }
                return {
                  id: report._id,
                  label: link.sourceLabel ?? report.reportKind,
                  reportKind: report.reportKind,
                };
              })
              .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
            reviewRunId: satisfactionState.reviewRunId,
            reviewRunKind: satisfactionRun.kind,
            reviewRunStatus: satisfactionRun.status,
            reviewRunTitle: satisfactionRun.title,
            reviewTaskId: satisfactionState.reviewTaskId,
            reviewTaskTitle: satisfactionTask.title,
            satisfiedAt: satisfactionState.satisfiedAt,
            satisfiedByDisplay: getActorDisplayName(
              actorDisplayById,
              satisfactionState.satisfiedByUserId,
            ),
            satisfiedThroughAt: satisfactionState.satisfiedThroughAt,
          }
        : null;
    const hiddenSeedEvidenceIds = new Set(itemState?.hiddenSeedEvidenceIds ?? []);
    const archivedSeedEvidenceById = new Map(
      (itemState?.archivedSeedEvidence ?? []).map((entry) => [entry.evidenceId, entry] as const),
    );
    const seededEvidence = item.seed.evidence
      .map((entry, index) => ({
        id: `${control.internalControlId}:${item.itemId}:seed:${index}` as Id<'securityControlEvidence'>,
        title: entry.title,
        description: entry.description,
        evidenceType: entry.evidenceType,
        url: entry.url,
        storageId: null,
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        evidenceDate: null,
        reviewDueIntervalMonths: null,
        reviewDueAt: null,
        expiryStatus: 'none' as const,
        source: null,
        sufficiency: entry.sufficiency,
        lifecycleStatus: 'active' as const,
        archivedAt: null,
        archivedByDisplay: null,
        renewedFromEvidenceId: null,
        replacedByEvidenceId: null,
        reviewStatus: 'reviewed' as const,
        reviewedAt: seededReviewedAt,
        reviewedByDisplay: seededActor.displayName,
        createdAt: seededReviewedAt,
        uploadedByDisplay: seededActor.displayName,
      }))
      .filter((entry) => !hiddenSeedEvidenceIds.has(entry.id));
    const archivedSeedEvidence = Array.from(hiddenSeedEvidenceIds)
      .map((evidenceId) => {
        const archivedMetadata = archivedSeedEvidenceById.get(evidenceId);
        const seededEntry = getSeededEvidenceEntry(
          control.internalControlId,
          item.itemId,
          evidenceId,
        );
        if (!seededEntry) {
          return null;
        }
        return {
          id: evidenceId as Id<'securityControlEvidence'>,
          title: seededEntry.entry.title,
          description: seededEntry.entry.description,
          evidenceType: seededEntry.entry.evidenceType,
          url: seededEntry.entry.url,
          storageId: null,
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          evidenceDate: null,
          reviewDueIntervalMonths: null,
          reviewDueAt: null,
          expiryStatus: 'none' as const,
          source: null,
          sufficiency: seededEntry.entry.sufficiency,
          lifecycleStatus: archivedMetadata?.lifecycleStatus ?? ('archived' as const),
          archivedAt: archivedMetadata?.archivedAt ?? null,
          archivedByDisplay: getActorDisplayName(
            actorDisplayById,
            archivedMetadata?.archivedByUserId,
          ),
          renewedFromEvidenceId: null,
          replacedByEvidenceId: archivedMetadata?.replacedByEvidenceId ?? null,
          reviewStatus: 'reviewed' as const,
          reviewedAt: seededReviewedAt,
          reviewedByDisplay: seededActor.displayName,
          createdAt: seededReviewedAt,
          uploadedByDisplay: seededActor.displayName,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const persistedEvidence = (
      evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []
    ).map((entry) => {
      const reviewDueIntervalMonths = entry.reviewDueIntervalMonths ?? null;
      const reviewedAt = entry.reviewedAt ?? null;
      const reviewDueAt =
        reviewedAt !== null && reviewDueIntervalMonths !== null
          ? addMonths(reviewedAt, reviewDueIntervalMonths)
          : null;

      return {
        id: entry._id,
        title: entry.title,
        description: entry.description ?? null,
        evidenceType: entry.evidenceType,
        url: entry.url ?? null,
        storageId: entry.storageId ?? null,
        fileName: entry.fileName ?? null,
        mimeType: entry.mimeType ?? null,
        sizeBytes: entry.sizeBytes ?? null,
        evidenceDate: entry.evidenceDate ?? null,
        reviewDueIntervalMonths,
        reviewDueAt,
        expiryStatus: deriveEvidenceExpiryStatus({
          reviewDueAt,
          reviewedAt,
        }),
        source: entry.source ?? null,
        sufficiency: entry.sufficiency,
        lifecycleStatus: entry.lifecycleStatus ?? ('active' as const),
        archivedAt: entry.archivedAt ?? null,
        archivedByDisplay: getActorDisplayName(actorDisplayById, entry.archivedByUserId),
        renewedFromEvidenceId: entry.renewedFromEvidenceId ?? null,
        replacedByEvidenceId: entry.replacedByEvidenceId ?? null,
        reviewStatus:
          entry.reviewStatus ?? (entry.reviewedAt ? ('reviewed' as const) : ('pending' as const)),
        reviewedAt,
        reviewedByDisplay: getActorDisplayName(actorDisplayById, entry.reviewedByUserId),
        createdAt: entry.createdAt,
        uploadedByDisplay: getActorDisplayName(actorDisplayById, entry.uploadedByUserId),
      };
    });
    const evidence = [...seededEvidence, ...persistedEvidence, ...archivedSeedEvidence];
    const evidenceDerivedStatus = deriveChecklistItemStatus(evidence);
    const manualStatus = itemState?.manualStatus ?? itemState?.status ?? null;
    const derivedStatus =
      manualStatus ??
      (evidenceDerivedStatus === 'done' || reviewSatisfaction !== null
        ? ('done' as const)
        : evidenceDerivedStatus);
    const itemHasExpiringSoonEvidence = hasExpiringSoonEvidence(evidence);
    const completedAt =
      derivedStatus === 'done'
        ? [
            reviewSatisfaction?.satisfiedAt ?? null,
            evidence
              .filter(
                (entry) => entry.lifecycleStatus === 'active' && entry.reviewStatus === 'reviewed',
              )
              .reduce<number | null>((latest, entry) => {
                const candidate = entry.reviewedAt ?? entry.createdAt;
                return latest === null ? candidate : Math.max(latest, candidate);
              }, null),
          ].reduce<number | null>((latest, value) => {
            if (typeof value !== 'number') {
              return latest;
            }
            return latest === null ? value : Math.max(latest, value);
          }, null)
        : null;
    const lastReviewedAtCandidates = [
      item.seed.evidence.length > 0 || derivedStatus !== 'not_started' ? seededReviewedAt : null,
      completedAt,
      reviewSatisfaction?.satisfiedAt ?? null,
      ...evidence.flatMap((entry) => [entry.reviewedAt, entry.createdAt, entry.archivedAt]),
      ...archivedSeedEvidence.map((entry) => entry.archivedAt),
    ];
    const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
      if (typeof value !== 'number') {
        return latest;
      }
      return latest === null ? value : Math.max(latest, value);
    }, null);

    return {
      itemId: item.itemId,
      label: item.label,
      description: item.description,
      verificationMethod: item.verificationMethod,
      required: item.required,
      suggestedEvidenceTypes: item.suggestedEvidenceTypes,
      status: derivedStatus,
      owner: itemState?.owner ?? item.seed.owner,
      operatorNotes: itemState?.internalOperatorNotes ?? itemState?.notes ?? item.seed.notes,
      completedAt,
      lastReviewedAt,
      evidence,
      evidenceSufficiency: deriveItemEvidenceSufficiency(evidence),
      hasExpiringSoonEvidence: itemHasExpiringSoonEvidence,
      reviewSatisfaction,
    };
  });
  const evidenceReadiness = deriveEvidenceReadiness(platformChecklist);
  const controlHasExpiringSoonEvidence = platformChecklist.some(
    (item) => item.hasExpiringSoonEvidence,
  );
  const lastReviewedAtCandidates = platformChecklist.flatMap((item) => [
    item.lastReviewedAt,
    item.completedAt,
    ...item.evidence.flatMap((evidence) => [
      evidence.reviewedAt,
      evidence.createdAt,
      evidence.archivedAt,
    ]),
  ]);
  const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
    if (typeof value !== 'number') {
      return latest;
    }
    return latest === null ? value : Math.max(latest, value);
  }, null);
  const linkedEntities = controlRelationships
    .map((relationship) => {
      switch (relationship.toType) {
        case 'vendor_review': {
          const vendorReview = vendorReviewByKey.get(
            relationship.toId as 'openrouter' | 'resend' | 'sentry',
          );
          const vendorRuntime = vendorRuntimeByKey.get(
            relationship.toId as 'openrouter' | 'resend' | 'sentry',
          );
          if (!vendorRuntime) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: vendorRuntime.displayName,
            relationshipType: relationship.relationshipType,
            status: vendorReview?.reviewStatus ?? 'pending',
          };
        }
        case 'finding': {
          const finding = findingByKey.get(relationship.toId);
          if (!finding) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: finding.title,
            relationshipType: relationship.relationshipType,
            status: finding.disposition,
          };
        }
        case 'review_task': {
          const task = reviewTaskById.get(relationship.toId as Id<'reviewTasks'>);
          if (!task) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: task.title,
            relationshipType: relationship.relationshipType,
            status: task.status,
          };
        }
        case 'evidence_report': {
          const report = reportById.get(relationship.toId as Id<'evidenceReports'>);
          if (!report) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: report.reportKind,
            relationshipType: relationship.relationshipType,
            status: report.reviewStatus,
          };
        }
        case 'evidence': {
          const evidence = evidenceRows.find((entry) => entry._id === relationship.toId);
          if (!evidence) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: evidence.title,
            relationshipType: relationship.relationshipType,
            status: evidence.reviewStatus ?? 'pending',
          };
        }
        default:
          return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return {
    internalControlId: control.internalControlId,
    nist80053Id: control.nist80053Id,
    title: control.title,
    familyId: control.familyId,
    familyTitle: control.familyTitle,
    owner: control.owner,
    priority: control.priority,
    responsibility: control.responsibility,
    implementationSummary: control.implementationSummary,
    customerResponsibilityNotes: control.customerResponsibilityNotes,
    controlStatement: control.controlStatement,
    mappings: {
      ...control.mappings,
      hipaa: control.mappings.hipaa.map((mapping) => ({
        ...mapping,
        text: null,
      })),
    },
    evidenceReadiness,
    hasExpiringSoonEvidence: controlHasExpiringSoonEvidence,
    linkedEntities,
    lastReviewedAt,
    platformChecklist,
    ...getSecurityScopeFields(),
  };
}

async function _listSecurityControlWorkspaceRecords(
  ctx: QueryCtx,
  options?: {
    controlIds?: string[];
    seedActor?: { authUserId: string };
  },
) {
  const controls = options?.controlIds
    ? ACTIVE_CONTROL_REGISTER.controls.filter((control) =>
        options.controlIds?.includes(control.internalControlId),
      )
    : ACTIVE_CONTROL_REGISTER.controls;
  const [perControlRows, allRelationships, vendorReviews, findingRows, allReviewTasks, allReports] =
    await Promise.all([
      Promise.all(
        controls.map(async (control) => {
          const [checklistItems, evidenceRows] = await Promise.all([
            ctx.db
              .query('securityControlChecklistItems')
              .withIndex('by_internal_control_id', (q) =>
                q.eq('internalControlId', control.internalControlId),
              )
              .collect(),
            ctx.db
              .query('securityControlEvidence')
              .withIndex('by_internal_control_id', (q) =>
                q.eq('internalControlId', control.internalControlId),
              )
              .collect(),
          ]);

          return {
            internalControlId: control.internalControlId,
            checklistItems,
            evidenceRows,
          };
        }),
      ),
      ctx.db.query('securityRelationships').collect(),
      ctx.db.query('securityVendorReviews').collect(),
      ctx.db.query('securityFindings').collect(),
      ctx.db.query('reviewTasks').collect(),
      ctx.db.query('evidenceReports').collect(),
    ]);
  const checklistItems = perControlRows.flatMap((entry) => entry.checklistItems);
  const evidenceRows = perControlRows.flatMap((entry) => entry.evidenceRows);
  const reviewSatisfactionEntries = checklistItems
    .map((item) => item.reviewSatisfaction ?? null)
    .filter(
      (entry): entry is NonNullable<(typeof checklistItems)[number]['reviewSatisfaction']> =>
        entry !== null,
    );
  const reviewTaskIds = Array.from(
    new Set(reviewSatisfactionEntries.map((entry) => entry.reviewTaskId)),
  );
  const reviewTasks = await Promise.all(
    reviewTaskIds.map((reviewTaskId) => ctx.db.get(reviewTaskId)),
  );
  const reviewTaskById = new Map(
    reviewTasks
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const reviewRunIds = Array.from(
    new Set(
      reviewSatisfactionEntries.flatMap((entry) => {
        const task = reviewTaskById.get(entry.reviewTaskId);
        return [entry.reviewRunId, task?.reviewRunId].filter(
          (value): value is Id<'reviewRuns'> => value !== undefined,
        );
      }),
    ),
  );
  const reviewRuns = await Promise.all(reviewRunIds.map((reviewRunId) => ctx.db.get(reviewRunId)));
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const reviewTaskEvidenceLinks = await Promise.all(
    reviewTaskIds.map(async (reviewTaskId) => {
      const links = await ctx.db
        .query('reviewTaskEvidenceLinks')
        .withIndex('by_review_task_id', (q) => q.eq('reviewTaskId', reviewTaskId))
        .collect();
      return [reviewTaskId, links] as const;
    }),
  );
  const reviewTaskEvidenceLinksByTaskId = new Map(reviewTaskEvidenceLinks);
  const linkedReportIds = Array.from(
    new Set(
      reviewTaskEvidenceLinks.flatMap(([, links]) =>
        links
          .filter((link) => link.sourceType === 'evidence_report')
          .map((link) => link.sourceId as Id<'evidenceReports'>),
      ),
    ),
  );
  const linkedReports = await Promise.all(linkedReportIds.map((reportId) => ctx.db.get(reportId)));
  const linkedReportById = new Map(
    linkedReports
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const allReviewTaskById = new Map(allReviewTasks.map((entry) => [entry._id, entry] as const));
  const allReportById = new Map(allReports.map((entry) => [entry._id, entry] as const));
  const vendorReviewByKey = new Map(
    vendorReviews.map((entry) => [entry.vendorKey, entry] as const),
  );
  const vendorRuntimeByKey = new Map(
    getVendorBoundarySnapshot().map((entry) => [entry.vendor, entry] as const),
  );
  const findingByKey = new Map(findingRows.map((entry) => [entry.findingKey, entry] as const));
  const relationshipsByFromKey = allRelationships.reduce<Map<string, typeof allRelationships>>(
    (accumulator, relationship) => {
      const key = `${relationship.fromType}:${relationship.fromId}`;
      const current = accumulator.get(key) ?? [];
      current.push(relationship);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const actorIds = Array.from(
    new Set(
      [
        ...evidenceRows.flatMap((row) => [
          row.uploadedByUserId,
          row.reviewedByUserId,
          row.archivedByUserId,
        ]),
        ...checklistItems.flatMap((item) =>
          (item.archivedSeedEvidence ?? []).map((entry) => entry.archivedByUserId),
        ),
        ...checklistItems.flatMap((item) =>
          item.reviewSatisfaction ? [item.reviewSatisfaction.satisfiedByUserId] : [],
        ),
        ...vendorReviews
          .map((row) => row.reviewedByUserId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ...findingRows
          .map((row) => row.reviewedByUserId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const actorDisplayById = await buildActorDisplayMap(ctx, actorIds);
  const seededActor = await resolveSeedSiteAdminActor(ctx, options?.seedActor?.authUserId);
  const checklistStateByKey = new Map(
    checklistItems.map((item) => [`${item.internalControlId}:${item.itemId}`, item] as const),
  );
  const evidenceByKey = evidenceRows.reduce<Map<string, Array<(typeof evidenceRows)[number]>>>(
    (accumulator, evidence) => {
      const key = `${evidence.internalControlId}:${evidence.itemId}`;
      const current = accumulator.get(key) ?? [];
      current.push(evidence);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const seededReviewedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);

  return controls.map((control) => {
    const platformChecklist = control.platformChecklistItems.map((item) => {
      const itemState = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
      const satisfactionState =
        itemState?.reviewSatisfaction &&
        hasActiveReviewSatisfaction(
          itemState.reviewSatisfaction,
          reviewTaskById.get(itemState.reviewSatisfaction.reviewTaskId),
          reviewRunById.get(itemState.reviewSatisfaction.reviewRunId),
        )
          ? itemState.reviewSatisfaction
          : null;
      const satisfactionTask = satisfactionState
        ? reviewTaskById.get(satisfactionState.reviewTaskId)
        : null;
      const satisfactionRun = satisfactionState
        ? reviewRunById.get(satisfactionState.reviewRunId)
        : null;
      const reviewSatisfaction =
        satisfactionState && satisfactionTask && satisfactionRun
          ? {
              mode: satisfactionState.mode,
              relatedReports: (
                reviewTaskEvidenceLinksByTaskId.get(satisfactionState.reviewTaskId) ?? []
              )
                .filter((link) => link.sourceType === 'evidence_report')
                .map((link) => {
                  const report = linkedReportById.get(link.sourceId as Id<'evidenceReports'>);
                  if (!report) {
                    return null;
                  }
                  return {
                    id: report._id,
                    label: link.sourceLabel ?? report.reportKind,
                    reportKind: report.reportKind,
                  };
                })
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
              reviewRunId: satisfactionState.reviewRunId,
              reviewRunKind: satisfactionRun.kind,
              reviewRunStatus: satisfactionRun.status,
              reviewRunTitle: satisfactionRun.title,
              reviewTaskId: satisfactionState.reviewTaskId,
              reviewTaskTitle: satisfactionTask.title,
              satisfiedAt: satisfactionState.satisfiedAt,
              satisfiedByDisplay: getActorDisplayName(
                actorDisplayById,
                satisfactionState.satisfiedByUserId,
              ),
              satisfiedThroughAt: satisfactionState.satisfiedThroughAt,
            }
          : null;
      const hiddenSeedEvidenceIds = new Set(itemState?.hiddenSeedEvidenceIds ?? []);
      const archivedSeedEvidenceById = new Map(
        (itemState?.archivedSeedEvidence ?? []).map((entry) => [entry.evidenceId, entry] as const),
      );
      const seededEvidence = item.seed.evidence
        .map((entry, index) => ({
          id: `${control.internalControlId}:${item.itemId}:seed:${index}` as Id<'securityControlEvidence'>,
          title: entry.title,
          description: entry.description,
          evidenceType: entry.evidenceType,
          url: entry.url,
          storageId: null,
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          evidenceDate: null,
          reviewDueIntervalMonths: null,
          reviewDueAt: null,
          expiryStatus: 'none' as const,
          source: null,
          sufficiency: entry.sufficiency,
          lifecycleStatus: 'active' as const,
          archivedAt: null,
          archivedByDisplay: null,
          renewedFromEvidenceId: null,
          replacedByEvidenceId: null,
          reviewStatus: 'reviewed' as const,
          reviewedAt: seededReviewedAt,
          reviewedByDisplay: seededActor.displayName,
          createdAt: seededReviewedAt,
          uploadedByDisplay: seededActor.displayName,
        }))
        .filter((entry) => !hiddenSeedEvidenceIds.has(entry.id));
      const archivedSeedEvidence = Array.from(hiddenSeedEvidenceIds)
        .map((evidenceId) => {
          const archivedMetadata = archivedSeedEvidenceById.get(evidenceId);
          const seededEntry = getSeededEvidenceEntry(
            control.internalControlId,
            item.itemId,
            evidenceId,
          );
          if (!seededEntry) {
            return null;
          }
          return {
            id: evidenceId as Id<'securityControlEvidence'>,
            title: seededEntry.entry.title,
            description: seededEntry.entry.description,
            evidenceType: seededEntry.entry.evidenceType,
            url: seededEntry.entry.url,
            storageId: null,
            fileName: null,
            mimeType: null,
            sizeBytes: null,
            evidenceDate: null,
            reviewDueIntervalMonths: null,
            reviewDueAt: null,
            expiryStatus: 'none' as const,
            source: null,
            sufficiency: seededEntry.entry.sufficiency,
            lifecycleStatus: archivedMetadata?.lifecycleStatus ?? ('archived' as const),
            archivedAt: archivedMetadata?.archivedAt ?? null,
            archivedByDisplay: getActorDisplayName(
              actorDisplayById,
              archivedMetadata?.archivedByUserId,
            ),
            renewedFromEvidenceId: null,
            replacedByEvidenceId: archivedMetadata?.replacedByEvidenceId ?? null,
            reviewStatus: 'reviewed' as const,
            reviewedAt: seededReviewedAt,
            reviewedByDisplay: seededActor.displayName,
            createdAt: seededReviewedAt,
            uploadedByDisplay: seededActor.displayName,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const persistedEvidence = (
        evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []
      ).map((entry) => {
        const reviewDueIntervalMonths = entry.reviewDueIntervalMonths ?? null;
        const reviewedAt = entry.reviewedAt ?? null;
        const reviewDueAt =
          reviewedAt !== null && reviewDueIntervalMonths !== null
            ? addMonths(reviewedAt, reviewDueIntervalMonths)
            : null;

        return {
          id: entry._id,
          title: entry.title,
          description: entry.description ?? null,
          evidenceType: entry.evidenceType,
          url: entry.url ?? null,
          storageId: entry.storageId ?? null,
          fileName: entry.fileName ?? null,
          mimeType: entry.mimeType ?? null,
          sizeBytes: entry.sizeBytes ?? null,
          evidenceDate: entry.evidenceDate ?? null,
          reviewDueIntervalMonths,
          reviewDueAt,
          expiryStatus: deriveEvidenceExpiryStatus({
            reviewDueAt,
            reviewedAt,
          }),
          source: entry.source ?? null,
          sufficiency: entry.sufficiency,
          lifecycleStatus: entry.lifecycleStatus ?? ('active' as const),
          archivedAt: entry.archivedAt ?? null,
          archivedByDisplay: getActorDisplayName(actorDisplayById, entry.archivedByUserId),
          renewedFromEvidenceId: entry.renewedFromEvidenceId ?? null,
          replacedByEvidenceId: entry.replacedByEvidenceId ?? null,
          reviewStatus:
            entry.reviewStatus ?? (entry.reviewedAt ? ('reviewed' as const) : ('pending' as const)),
          reviewedAt,
          reviewedByDisplay: getActorDisplayName(actorDisplayById, entry.reviewedByUserId),
          createdAt: entry.createdAt,
          uploadedByDisplay: getActorDisplayName(actorDisplayById, entry.uploadedByUserId),
        };
      });
      const evidence = [...seededEvidence, ...persistedEvidence, ...archivedSeedEvidence];
      const evidenceDerivedStatus = deriveChecklistItemStatus(evidence);
      const manualStatus = itemState?.manualStatus ?? itemState?.status ?? null;
      const derivedStatus =
        manualStatus ??
        (evidenceDerivedStatus === 'done' || reviewSatisfaction !== null
          ? ('done' as const)
          : evidenceDerivedStatus);
      const itemHasExpiringSoonEvidence = hasExpiringSoonEvidence(evidence);
      const completedAt =
        derivedStatus === 'done'
          ? [
              reviewSatisfaction?.satisfiedAt ?? null,
              evidence
                .filter(
                  (entry) =>
                    entry.lifecycleStatus === 'active' && entry.reviewStatus === 'reviewed',
                )
                .reduce<number | null>((latest, entry) => {
                  const candidate = entry.reviewedAt ?? entry.createdAt;
                  return latest === null ? candidate : Math.max(latest, candidate);
                }, null),
            ].reduce<number | null>((latest, value) => {
              if (typeof value !== 'number') {
                return latest;
              }
              return latest === null ? value : Math.max(latest, value);
            }, null)
          : null;
      const lastReviewedAtCandidates = [
        item.seed.evidence.length > 0 || derivedStatus !== 'not_started' ? seededReviewedAt : null,
        completedAt,
        reviewSatisfaction?.satisfiedAt ?? null,
        ...evidence.flatMap((entry) => [entry.reviewedAt, entry.createdAt, entry.archivedAt]),
        ...archivedSeedEvidence.map((entry) => entry.archivedAt),
      ];
      const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
        if (typeof value !== 'number') {
          return latest;
        }
        return latest === null ? value : Math.max(latest, value);
      }, null);

      return {
        itemId: item.itemId,
        label: item.label,
        description: item.description,
        verificationMethod: item.verificationMethod,
        required: item.required,
        suggestedEvidenceTypes: item.suggestedEvidenceTypes,
        status: derivedStatus,
        owner: itemState?.owner ?? item.seed.owner,
        operatorNotes: itemState?.internalOperatorNotes ?? itemState?.notes ?? item.seed.notes,
        completedAt,
        lastReviewedAt,
        evidence,
        evidenceSufficiency: deriveItemEvidenceSufficiency(evidence),
        hasExpiringSoonEvidence: itemHasExpiringSoonEvidence,
        reviewSatisfaction,
      };
    });

    const evidenceReadiness = deriveEvidenceReadiness(platformChecklist);
    const controlHasExpiringSoonEvidence = platformChecklist.some(
      (item) => item.hasExpiringSoonEvidence,
    );
    const lastReviewedAtCandidates = platformChecklist.flatMap((item) => [
      item.lastReviewedAt,
      item.completedAt,
      ...item.evidence.flatMap((evidence) => [
        evidence.reviewedAt,
        evidence.createdAt,
        evidence.archivedAt,
      ]),
    ]);
    const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
      if (typeof value !== 'number') {
        return latest;
      }
      return latest === null ? value : Math.max(latest, value);
    }, null);
    const linkedEntities = (
      relationshipsByFromKey.get(`control:${control.internalControlId}`) ?? []
    )
      .map((relationship) => {
        switch (relationship.toType) {
          case 'vendor_review': {
            const vendorReview = vendorReviewByKey.get(
              relationship.toId as 'openrouter' | 'resend' | 'sentry',
            );
            const vendorRuntime = vendorRuntimeByKey.get(
              relationship.toId as 'openrouter' | 'resend' | 'sentry',
            );
            if (!vendorRuntime) {
              return null;
            }
            return {
              entityId: relationship.toId,
              entityType: relationship.toType,
              label: vendorRuntime.displayName,
              relationshipType: relationship.relationshipType,
              status: vendorReview?.reviewStatus ?? 'pending',
            };
          }
          case 'finding': {
            const finding = findingByKey.get(relationship.toId);
            if (!finding) {
              return null;
            }
            return {
              entityId: relationship.toId,
              entityType: relationship.toType,
              label: finding.title,
              relationshipType: relationship.relationshipType,
              status: finding.disposition,
            };
          }
          case 'review_task': {
            const task = allReviewTaskById.get(relationship.toId as Id<'reviewTasks'>);
            if (!task) {
              return null;
            }
            return {
              entityId: relationship.toId,
              entityType: relationship.toType,
              label: task.title,
              relationshipType: relationship.relationshipType,
              status: task.status,
            };
          }
          case 'evidence_report': {
            const report = allReportById.get(relationship.toId as Id<'evidenceReports'>);
            if (!report) {
              return null;
            }
            return {
              entityId: relationship.toId,
              entityType: relationship.toType,
              label: report.reportKind,
              relationshipType: relationship.relationshipType,
              status: report.reviewStatus,
            };
          }
          case 'evidence': {
            const evidence = evidenceRows.find((entry) => entry._id === relationship.toId);
            if (!evidence) {
              return null;
            }
            return {
              entityId: relationship.toId,
              entityType: relationship.toType,
              label: evidence.title,
              relationshipType: relationship.relationshipType,
              status: evidence.reviewStatus ?? 'pending',
            };
          }
          default:
            return null;
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      internalControlId: control.internalControlId,
      nist80053Id: control.nist80053Id,
      title: control.title,
      familyId: control.familyId,
      familyTitle: control.familyTitle,
      owner: control.owner,
      priority: control.priority,
      responsibility: control.responsibility,
      implementationSummary: control.implementationSummary,
      customerResponsibilityNotes: control.customerResponsibilityNotes,
      controlStatement: control.controlStatement,
      mappings: {
        ...control.mappings,
        hipaa: control.mappings.hipaa.map((mapping) => ({
          ...mapping,
          text: null,
        })),
      },
      evidenceReadiness,
      hasExpiringSoonEvidence: controlHasExpiringSoonEvidence,
      linkedEntities,
      lastReviewedAt,
      platformChecklist,
      ...getSecurityScopeFields(),
    };
  });
}

export {
  _listSecurityControlWorkspaceRecords,
  getSecurityControlWorkspaceRecord,
  listSecurityControlWorkspaceSummaryRecords,
};
