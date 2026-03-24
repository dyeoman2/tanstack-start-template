import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { getVendorBoundarySnapshot } from '../../../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { getSecurityScopeFields, normalizeSecurityRelationshipType } from './core';
import {
  buildNormalizedChecklistEvidence,
  buildActorDisplayMap,
  deriveEvidenceExpiryStatus,
  getActorDisplayName,
  getSeededEvidenceEntry,
  hasExpiringSoonEvidence,
  resolveChecklistSupport,
  resolveControlSupport,
  resolveEvidenceValidUntil,
  resolveEvidenceValidity,
  resolveSeededEvidenceValidUntil,
  resolveSeedSiteAdminActor,
} from './operations_core';
import { deriveVendorReviewStatus } from './vendors_core';

async function listSecurityControlWorkspaceSummaryRecords(ctx: QueryCtx) {
  const controls = await listSecurityControlWorkspaceExportRecords(ctx);

  return controls.map((control) => ({
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
    mappings: control.mappings,
    support: control.support,
    hasExpiringSoonEvidence: control.hasExpiringSoonEvidence,
    lastReviewedAt: control.lastReviewedAt,
    checklistStats: {
      completeCount: control.platformChecklist.filter((item) => item.support === 'complete').length,
      totalCount: control.platformChecklist.length,
    },
    searchableText: [
      control.nist80053Id,
      control.title,
      control.implementationSummary,
      control.familyId,
      control.familyTitle,
      control.owner,
      control.responsibility ?? '',
      control.support,
      control.customerResponsibilityNotes ?? '',
      ...control.platformChecklist.map((item) => item.label),
      ...control.platformChecklist.map((item) => item.operatorNotes ?? ''),
      ...control.mappings.hipaa.map((mapping) => mapping.citation),
      ...control.mappings.csf20.map((mapping) => mapping.subcategoryId),
      ...control.mappings.nist80066.map((mapping) => mapping.referenceId),
      ...control.mappings.soc2.map((mapping) => mapping.criterionId),
    ]
      .join(' ')
      .toLowerCase(),
  }));
}

async function getSecurityControlWorkspaceRecord(
  ctx: QueryCtx,
  internalControlId: string,
  seedActor?: { authUserId: string },
) {
  const [record] = await _listSecurityControlWorkspaceRecords(ctx, {
    controlIds: [internalControlId],
    includeLinkedEntities: true,
    seedActor,
  });
  return record ?? null;
}

async function listSecurityControlWorkspaceExportRecords(
  ctx: QueryCtx,
  options?: {
    controlIds?: string[];
    seedActor?: { authUserId: string };
  },
) {
  return (
    await _listSecurityControlWorkspaceRecords(ctx, {
      controlIds: options?.controlIds,
      includeLinkedEntities: false,
      seedActor: options?.seedActor,
    })
  ).map(({ linkedEntities: _linkedEntities, ...record }) => record);
}

async function _listSecurityControlWorkspaceRecords(
  ctx: QueryCtx,
  options?: {
    controlIds?: string[];
    includeLinkedEntities?: boolean;
    seedActor?: { authUserId: string };
  },
) {
  const includeLinkedEntities = options?.includeLinkedEntities ?? true;
  const controls = options?.controlIds
    ? ACTIVE_CONTROL_REGISTER.controls.filter((control) =>
        options.controlIds?.includes(control.internalControlId),
      )
    : ACTIVE_CONTROL_REGISTER.controls;
  const [perControlRows, controlRelationshipsEntries] = await Promise.all([
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
    includeLinkedEntities
      ? Promise.all(
          controls.map(async (control) => {
            const relationships = await ctx.db
              .query('securityRelationships')
              .withIndex('by_from', (q) =>
                q.eq('fromType', 'control').eq('fromId', control.internalControlId),
              )
              .collect();
            return [control.internalControlId, relationships] as const;
          }),
        ).then((entries) => new Map(entries))
      : [],
  ]);
  const controlRelationshipsById = new Map(controlRelationshipsEntries);
  const checklistItems = perControlRows.flatMap((entry) => entry.checklistItems);
  const evidenceRows = perControlRows.flatMap((entry) => entry.evidenceRows);
  const allRelationships = includeLinkedEntities
    ? Array.from(controlRelationshipsById.values()).flat()
    : [];
  const reviewTaskIdsFromEvidence = Array.from(
    new Set(
      evidenceRows
        .map((entry) => entry.reviewOriginReviewTaskId ?? null)
        .filter((entry): entry is Id<'reviewTasks'> => entry !== null),
    ),
  );
  const linkedReviewTaskIds = includeLinkedEntities
    ? Array.from(
        new Set(
          allRelationships
            .filter((relationship) => relationship.toType === 'review_task')
            .map((relationship) => relationship.toId as Id<'reviewTasks'>),
        ),
      )
    : [];
  const reviewTaskIds = Array.from(new Set([...reviewTaskIdsFromEvidence, ...linkedReviewTaskIds]));
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
      evidenceRows.flatMap((entry) => {
        const task = entry.reviewOriginReviewTaskId
          ? reviewTaskById.get(entry.reviewOriginReviewTaskId)
          : null;
        return [entry.reviewOriginReviewRunId, task?.reviewRunId].filter(
          (value): value is Id<'reviewRuns'> => value !== undefined && value !== null,
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
  const linkedReportIds = Array.from(
    new Set([
      ...reviewTaskEvidenceLinks.flatMap(([, links]) =>
        links
          .filter((link) => link.sourceType === 'evidence_report')
          .map((link) => link.sourceId as Id<'evidenceReports'>),
      ),
      ...evidenceRows
        .filter((entry) => entry.reviewOriginSourceType === 'evidence_report')
        .map((entry) => entry.reviewOriginSourceId as Id<'evidenceReports'> | null)
        .filter((entry): entry is Id<'evidenceReports'> => entry !== null),
    ]),
  );
  const relatedReportIds = includeLinkedEntities
    ? allRelationships
        .filter((relationship) => relationship.toType === 'evidence_report')
        .map((relationship) => relationship.toId as Id<'evidenceReports'>)
    : [];
  const reportIds = Array.from(new Set([...linkedReportIds, ...relatedReportIds]));
  const linkedReports = await Promise.all(reportIds.map((reportId) => ctx.db.get(reportId)));
  const linkedReportById = new Map(
    linkedReports
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const allReviewTaskById = reviewTaskById;
  const allReportById = linkedReportById;
  const vendorMappings = includeLinkedEntities
    ? await ctx.db.query('securityVendorControlMappings').collect()
    : [];
  const vendorKeys = includeLinkedEntities
    ? Array.from(new Set(vendorMappings.map((mapping) => mapping.vendorKey)))
    : [];
  const vendorEntries = await Promise.all(
    vendorKeys.map(async (vendorKey) => {
      const vendor = await ctx.db
        .query('securityVendors')
        .withIndex('by_vendor_key', (q) => q.eq('vendorKey', vendorKey))
        .unique();
      return [vendorKey, vendor] as const;
    }),
  );
  const vendorByKey = new Map(
    vendorEntries
      .filter(
        (entry): entry is [(typeof entry)[0], NonNullable<(typeof entry)[1]>] => entry[1] !== null,
      )
      .map(([vendorKey, vendor]) => [vendorKey, vendor] as const),
  );
  const vendorRuntimeByKey = includeLinkedEntities
    ? new Map(getVendorBoundarySnapshot().map((entry) => [entry.vendor, entry] as const))
    : new Map();
  const findingKeys = includeLinkedEntities
    ? Array.from(
        new Set(
          allRelationships
            .filter((relationship) => relationship.toType === 'finding')
            .map((relationship) => relationship.toId),
        ),
      )
    : [];
  const findingEntries = await Promise.all(
    findingKeys.map(async (findingKey) => {
      const finding = await ctx.db
        .query('securityFindings')
        .withIndex('by_finding_key', (q) => q.eq('findingKey', findingKey))
        .unique();
      return [findingKey, finding] as const;
    }),
  );
  const findingByKey = new Map(
    findingEntries
      .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== null)
      .map(([findingKey, finding]) => [findingKey, finding] as const),
  );
  const findingRows = Array.from(findingByKey.values());
  const relationshipsByFromKey = includeLinkedEntities ? controlRelationshipsById : new Map();
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
        ...(includeLinkedEntities ? [] : []),
        ...(includeLinkedEntities
          ? findingRows
              .map((row) => row.reviewedByUserId)
              .filter((value): value is string => typeof value === 'string' && value.length > 0)
          : []),
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
  const seededValidUntil = resolveSeededEvidenceValidUntil(seededReviewedAt);

  return controls.map((control) => {
    type LinkedEntity = {
      entityId: string;
      entityType: 'evidence' | 'evidence_report' | 'finding' | 'review_task' | 'vendor';
      label: string;
      relationshipType:
        | 'follow_up_for'
        | 'has_evidence'
        | 'has_report'
        | 'has_review_task'
        | 'related_control'
        | 'satisfies'
        | 'supports'
        | 'tracks_finding'
        | 'tracks_vendor';
      status: string | null;
    };
    const platformChecklist = control.platformChecklistItems.map((item) => {
      const itemState = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
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
          expiryStatus: deriveEvidenceExpiryStatus({
            validUntil: seededValidUntil,
          }),
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
          reviewOriginReviewRunId: null,
          reviewOriginReviewTaskId: null,
          reviewOriginReviewTaskResultId: null,
          reviewOriginReviewAttestationId: null,
          reviewOriginSourceType: null,
          reviewOriginSourceId: null,
          reviewOriginSourceLabel: null,
          validUntil: seededValidUntil,
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
            expiryStatus: deriveEvidenceExpiryStatus({
              validUntil: seededValidUntil,
            }),
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
            reviewOriginReviewRunId: null,
            reviewOriginReviewTaskId: null,
            reviewOriginReviewTaskResultId: null,
            reviewOriginReviewAttestationId: null,
            reviewOriginSourceType: null,
            reviewOriginSourceId: null,
            reviewOriginSourceLabel: null,
            validUntil: seededValidUntil,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const persistedEvidence = (
        evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []
      ).map((entry) => {
        const reviewDueIntervalMonths = entry.reviewDueIntervalMonths ?? null;
        const reviewedAt = entry.reviewedAt ?? null;
        const validUntil = resolveEvidenceValidUntil({
          reviewDueIntervalMonths,
          reviewedAt,
          validUntil: entry.validUntil ?? null,
        });
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
          expiryStatus: deriveEvidenceExpiryStatus({
            validUntil,
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
          reviewOriginReviewRunId: entry.reviewOriginReviewRunId ?? null,
          reviewOriginReviewTaskId: entry.reviewOriginReviewTaskId ?? null,
          reviewOriginReviewTaskResultId: entry.reviewOriginReviewTaskResultId ?? null,
          reviewOriginReviewAttestationId: entry.reviewOriginReviewAttestationId ?? null,
          reviewOriginSourceType: entry.reviewOriginSourceType ?? null,
          reviewOriginSourceId: entry.reviewOriginSourceId ?? null,
          reviewOriginSourceLabel: entry.reviewOriginSourceLabel ?? null,
          validUntil,
        };
      });
      const evidence = [...seededEvidence, ...persistedEvidence, ...archivedSeedEvidence];
      const normalizedEvidence = buildNormalizedChecklistEvidence({
        archivedSeedEvidence: itemState?.archivedSeedEvidence ?? null,
        hiddenSeedEvidenceIds: itemState?.hiddenSeedEvidenceIds ?? null,
        internalControlId: control.internalControlId,
        itemId: item.itemId,
        persistedEvidence: evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? [],
        seededEvidence: item.seed.evidence,
        seededReviewedAt,
      });
      const reviewArtifactEvidence =
        [...persistedEvidence]
          .filter(
            (entry) =>
              entry.lifecycleStatus === 'active' &&
              entry.reviewStatus === 'reviewed' &&
              entry.reviewOriginReviewTaskId !== null,
          )
          .sort((left, right) => {
            const leftTimestamp = left.reviewedAt ?? left.createdAt;
            const rightTimestamp = right.reviewedAt ?? right.createdAt;
            return rightTimestamp - leftTimestamp;
          })[0] ?? null;
      const reviewTask =
        reviewArtifactEvidence?.reviewOriginReviewTaskId !== null &&
        reviewArtifactEvidence?.reviewOriginReviewTaskId !== undefined
          ? reviewTaskById.get(reviewArtifactEvidence.reviewOriginReviewTaskId)
          : null;
      const reviewRun =
        reviewArtifactEvidence?.reviewOriginReviewRunId !== null &&
        reviewArtifactEvidence?.reviewOriginReviewRunId !== undefined
          ? reviewRunById.get(reviewArtifactEvidence.reviewOriginReviewRunId)
          : reviewTask
            ? reviewRunById.get(reviewTask.reviewRunId)
            : null;
      const relatedReports = reviewArtifactEvidence
        ? persistedEvidence
            .filter(
              (entry) =>
                entry.lifecycleStatus === 'active' &&
                entry.reviewOriginReviewTaskId ===
                  reviewArtifactEvidence.reviewOriginReviewTaskId &&
                entry.reviewOriginSourceType === 'evidence_report' &&
                entry.reviewOriginSourceId !== null,
            )
            .map((entry) => {
              const report = linkedReportById.get(
                entry.reviewOriginSourceId as Id<'evidenceReports'>,
              );
              if (!report) {
                return null;
              }
              return {
                id: report._id,
                label: entry.reviewOriginSourceLabel ?? report.reportKind,
                reportKind: report.reportKind,
              };
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        : [];
      const reviewArtifact =
        reviewArtifactEvidence && reviewTask && reviewRun
          ? {
              evidenceId: reviewArtifactEvidence.id,
              evidenceType: reviewArtifactEvidence.evidenceType,
              relatedReports,
              reviewRunId: reviewRun._id,
              reviewRunKind: reviewRun.kind,
              reviewRunStatus: reviewRun.status,
              reviewRunTitle: reviewRun.title,
              reviewTaskId: reviewTask._id,
              reviewTaskTitle: reviewTask.title,
              satisfiedAt: reviewArtifactEvidence.reviewedAt ?? reviewArtifactEvidence.createdAt,
              satisfiedByDisplay:
                reviewArtifactEvidence.reviewedByDisplay ??
                reviewArtifactEvidence.uploadedByDisplay,
              validUntil: reviewArtifactEvidence.validUntil,
            }
          : null;
      const support = resolveChecklistSupport(normalizedEvidence);
      const itemHasExpiringSoonEvidence = hasExpiringSoonEvidence(evidence);
      const completedAt =
        support === 'complete'
          ? [
              evidence
                .filter(
                  (entry) =>
                    resolveEvidenceValidity({
                      lifecycleStatus: entry.lifecycleStatus,
                      reviewStatus: entry.reviewStatus,
                      validUntil: entry.validUntil,
                    }).countsForSupport,
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
        item.seed.evidence.length > 0 || support !== 'missing' ? seededReviewedAt : null,
        completedAt,
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
        support,
        owner: itemState?.owner ?? item.seed.owner,
        operatorNotes: itemState?.internalOperatorNotes ?? itemState?.notes ?? item.seed.notes,
        completedAt,
        lastReviewedAt,
        evidence,
        hasExpiringSoonEvidence: itemHasExpiringSoonEvidence,
        reviewArtifact,
      };
    });

    const support = resolveControlSupport(platformChecklist);
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
    const linkedEntities = includeLinkedEntities
      ? [
          ...(relationshipsByFromKey.get(`control:${control.internalControlId}`) ?? []).flatMap(
            (relationship: (typeof allRelationships)[number]): LinkedEntity[] => {
              switch (relationship.toType) {
                case 'vendor':
                case 'vendor_review': {
                  const vendorRecord = vendorByKey.get(
                    relationship.toId as 'openrouter' | 'resend' | 'sentry',
                  );
                  const vendorRuntime = vendorRuntimeByKey.get(
                    relationship.toId as 'openrouter' | 'resend' | 'sentry',
                  );
                  if (!vendorRuntime) {
                    return [];
                  }
                  return [
                    {
                      entityId: relationship.toId,
                      entityType: 'vendor',
                      label: vendorRuntime.displayName,
                      relationshipType:
                        normalizeSecurityRelationshipType(relationship.relationshipType) ??
                        'tracks_vendor',
                      status:
                        vendorRecord !== undefined
                          ? deriveVendorReviewStatus({
                              nextReviewAt: vendorRecord.nextReviewAt ?? null,
                            })
                          : 'overdue',
                    },
                  ];
                }
                case 'finding': {
                  const finding = findingByKey.get(relationship.toId);
                  if (!finding) {
                    return [];
                  }
                  return [
                    {
                      entityId: relationship.toId,
                      entityType: relationship.toType,
                      label: finding.title,
                      relationshipType:
                        normalizeSecurityRelationshipType(relationship.relationshipType) ??
                        'tracks_finding',
                      status: finding.disposition,
                    },
                  ];
                }
                case 'review_task': {
                  const task = allReviewTaskById.get(relationship.toId as Id<'reviewTasks'>);
                  if (!task) {
                    return [];
                  }
                  return [
                    {
                      entityId: relationship.toId,
                      entityType: relationship.toType,
                      label: task.title,
                      relationshipType:
                        normalizeSecurityRelationshipType(relationship.relationshipType) ??
                        'has_review_task',
                      status: task.status,
                    },
                  ];
                }
                case 'evidence_report': {
                  const report = allReportById.get(relationship.toId as Id<'evidenceReports'>);
                  if (!report) {
                    return [];
                  }
                  return [
                    {
                      entityId: relationship.toId,
                      entityType: relationship.toType,
                      label: report.reportKind,
                      relationshipType:
                        normalizeSecurityRelationshipType(relationship.relationshipType) ??
                        'has_report',
                      status: report.reviewStatus,
                    },
                  ];
                }
                case 'evidence': {
                  const evidence = evidenceRows.find((entry) => entry._id === relationship.toId);
                  if (!evidence) {
                    return [];
                  }
                  return [
                    {
                      entityId: relationship.toId,
                      entityType: relationship.toType,
                      label: evidence.title,
                      relationshipType:
                        normalizeSecurityRelationshipType(relationship.relationshipType) ??
                        'has_evidence',
                      status: evidence.reviewStatus ?? 'pending',
                    },
                  ];
                }
                default:
                  return [];
              }
            },
          ),
          ...vendorMappings
            .filter((mapping) => mapping.internalControlId === control.internalControlId)
            .flatMap((mapping): LinkedEntity[] => {
              const vendorRuntime = vendorRuntimeByKey.get(mapping.vendorKey);
              if (!vendorRuntime) {
                return [];
              }
              const vendorRecord = vendorByKey.get(mapping.vendorKey);
              return [
                {
                  entityId: mapping.vendorKey,
                  entityType: 'vendor',
                  label: vendorRuntime.displayName,
                  relationshipType: 'tracks_vendor',
                  status:
                    vendorRecord !== undefined
                      ? deriveVendorReviewStatus({
                          nextReviewAt: vendorRecord.nextReviewAt ?? null,
                        })
                      : 'overdue',
                },
              ];
            }),
        ]
      : [];

    return {
      internalControlId: control.internalControlId,
      nist80053Id: control.nist80053Id,
      title: control.title,
      familyId: control.familyId,
      familyTitle: control.familyTitle,
      owner: seededActor.displayName,
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
      support,
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
  listSecurityControlWorkspaceExportRecords,
  listSecurityControlWorkspaceSummaryRecords,
};
