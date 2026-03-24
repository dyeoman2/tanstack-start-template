import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import {
  getSecurityFindingControlLinks,
  getSecurityRelationshipObjectTypeFromEvidenceSourceType,
  getSecurityRelationshipObjectTypeFromSourceRecordType,
  getVendorRelatedControlLinks,
  normalizeReviewTaskEvidenceSourceType,
  normalizeSecurityRelationshipObjectType,
  normalizeSecurityRelationshipType,
  patchSecurityScopeDefaults,
  upsertSecurityRelationship,
} from './core';
import {
  syncSecurityVendorControlMappings,
  syncSecurityVendorRecords,
  buildVendorWorkspaceRows as buildVendorWorkspaceRowsFromRecords,
} from './vendors_core';

export async function syncSecurityVendorWorkspaceRecords(ctx: MutationCtx) {
  await syncSecurityVendorRecords(ctx);
  await syncSecurityVendorControlMappings(ctx);
  return 0;
}

export async function buildVendorWorkspaceRows(ctx: QueryCtx) {
  return await buildVendorWorkspaceRowsFromRecords(ctx);
}

export async function runSecurityWorkspaceMigration(
  ctx: MutationCtx,
  actorUserId: string,
  _args: {
    upsertReviewTaskEvidenceLinkRecord: (
      ctx: MutationCtx,
      args: {
        freshAt?: number;
        linkedByUserId?: string;
        reviewRunId: Doc<'reviewRuns'>['_id'];
        reviewTaskId: Doc<'reviewTasks'>['_id'];
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
    ) => Promise<Doc<'reviewTaskEvidenceLinks'>['_id']>;
  },
) {
  let normalizedLegacyVendorCompatibilityRows = 0;
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
    'securityVendors',
    'securityVendorControlMappings',
    'retentionJobs',
    'backupVerificationReports',
    'securityRelationships',
  ] as const;
  let patchedScopeRecords = 0;
  for (const tableName of scopeTables) {
    patchedScopeRecords += await patchSecurityScopeDefaults(ctx, tableName);
  }

  const [relationshipRows, reviewTaskEvidenceLinks] = await Promise.all([
    ctx.db.query('securityRelationships').collect(),
    ctx.db.query('reviewTaskEvidenceLinks').collect(),
  ]);

  for (const relationship of relationshipRows) {
    const normalizedFromType = normalizeSecurityRelationshipObjectType(relationship.fromType);
    const normalizedToType = normalizeSecurityRelationshipObjectType(relationship.toType);
    const normalizedRelationshipType = normalizeSecurityRelationshipType(
      relationship.relationshipType,
    );
    if (
      normalizedFromType === relationship.fromType &&
      normalizedToType === relationship.toType &&
      normalizedRelationshipType === relationship.relationshipType
    ) {
      continue;
    }
    await ctx.db.patch(relationship._id, {
      fromType: normalizedFromType ?? relationship.fromType,
      relationshipType: normalizedRelationshipType ?? relationship.relationshipType,
      toType: normalizedToType ?? relationship.toType,
    });
    normalizedLegacyVendorCompatibilityRows += 1;
  }

  for (const link of reviewTaskEvidenceLinks) {
    const normalizedSourceType = normalizeReviewTaskEvidenceSourceType(link.sourceType);
    if (normalizedSourceType === link.sourceType || !normalizedSourceType) {
      continue;
    }
    await ctx.db.patch(link._id, {
      sourceType: normalizedSourceType,
    });
    normalizedLegacyVendorCompatibilityRows += 1;
  }

  const patchedChecklistStatuses = 0;
  const migratedReviewArtifacts = 0;
  const patchedReviewNotes = 0;

  const syncedVendorRows = await syncSecurityVendorWorkspaceRecords(ctx);
  const [evidenceRows, findingRows, reviewRuns, reviewTasks, evidenceLinks, vendors] =
    await Promise.all([
      ctx.db.query('securityControlEvidence').collect(),
      ctx.db.query('securityFindings').collect(),
      ctx.db.query('reviewRuns').collect(),
      ctx.db.query('reviewTasks').collect(),
      ctx.db.query('reviewTaskEvidenceLinks').collect(),
      ctx.db.query('securityVendors').collect(),
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
      if (link.sourceType === 'vendor') {
        await upsertSecurityRelationship(ctx, {
          createdByUserId: actorUserId,
          fromId: controlLink.internalControlId,
          fromType: 'control',
          relationshipType: 'tracks_vendor',
          toId: link.sourceId,
          toType: 'vendor',
        });
      }
    }
  }

  for (const vendor of vendors) {
    for (const controlLink of getVendorRelatedControlLinks(vendor.vendorKey)) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: vendor.vendorKey,
        fromType: 'vendor',
        relationshipType: 'related_control',
        toId: controlLink.internalControlId,
        toType: 'control',
      });
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_vendor',
        toId: vendor.vendorKey,
        toType: 'vendor',
      });
    }
    if (vendor.linkedFollowUpRunId) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: actorUserId,
        fromId: vendor.vendorKey,
        fromType: 'vendor',
        relationshipType: 'follow_up_for',
        toId: vendor.linkedFollowUpRunId,
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
    normalizedLegacyVendorCompatibilityRows,
    patchedChecklistStatuses,
    patchedReviewNotes,
    patchedScopeRecords,
    syncedVendorRows,
  };
}
