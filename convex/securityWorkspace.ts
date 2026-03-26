import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import { evaluateStepUpClaim, STEP_UP_REQUIREMENTS } from '../src/lib/shared/auth-policy';
import { siteAdminMutation, siteAdminQuery } from './auth/authorized';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
  requireStepUpFromActionOrThrow,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import { getActiveStepUpClaim } from './stepUp';
import { createUploadTargetWithMode } from './storagePlatform';
import {
  getSecurityControlWorkspaceRecord,
  listSecurityControlWorkspaceExportRecords,
  listSecurityControlWorkspaceSummaryRecords,
} from './lib/security/control_workspace_core';
import { getSecurityFindingControlLinks, getSecurityScopeFields } from './lib/security/core';
import {
  addMonths,
  buildCurrentSecurityFindings,
  getLatestReleaseProvenanceEvidence,
  recordSecurityControlEvidenceAuditEvent,
  syncCurrentSecurityFindings,
} from './lib/security/operations_core';
import {
  buildReviewRunSummary,
  createTriggeredReviewRunRecord,
} from './lib/security/review_runs_core';
import {
  archiveSecurityControlEvidenceHandler,
  buildSecurityFindingListRecords,
  listSecurityControlEvidenceActivityHandler,
  listSecurityFindingsHandler,
  renewSecurityControlEvidenceHandler,
  reviewSecurityFindingHandler,
} from './lib/security/workspace';
import {
  enforceSecurityEvidenceUploadRateLimit,
  evidenceReviewDueIntervalValidator,
  evidenceSourceValidator,
  evidenceSufficiencyValidator,
  releaseProvenanceEvidenceSummaryValidator,
  securityControlEvidenceActivityListValidator,
  securityControlWorkspaceExportListValidator,
  securityControlWorkspaceSummaryListValidator,
  securityControlWorkspaceValidator,
  securityFindingDispositionValidator,
  securityFindingListItemValidator,
  securityFindingListValidator,
  reviewRunSummaryValidator,
  validateSecurityEvidenceUploadInput,
} from './lib/security/validators';

async function assertFreshEvidenceAdminSessionOrThrow(
  ctx: QueryCtx,
  currentUser: Awaited<ReturnType<typeof getVerifiedCurrentSiteAdminUserOrThrow>>,
) {
  if (currentUser.authSession?.impersonatedBy) {
    throwConvexError('FORBIDDEN', 'Impersonated sessions cannot manage evidence.');
  }

  const sessionId = currentUser.authSession?.id ?? null;
  const claim =
    sessionId === null
      ? null
      : await getActiveStepUpClaim(ctx, {
          authUserId: currentUser.authUserId,
          requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
          sessionId,
        });

  if (
    !evaluateStepUpClaim({
      claim: claim
        ? {
            consumedAt: claim.consumedAt,
            expiresAt: claim.expiresAt,
            method: claim.method,
            requirement: claim.requirement,
            sessionId: claim.sessionId,
            verifiedAt: claim.verifiedAt,
          }
        : null,
      requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
      sessionId,
    }).satisfied
  ) {
    throwConvexError('FORBIDDEN', 'Step-up authentication is required.');
  }
}

export const listSecurityControlWorkspaces = query({
  args: {},
  returns: securityControlWorkspaceSummaryListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityControlWorkspaceSummaryRecords(ctx);
  },
});

export const getSecurityControlWorkspaceDetail = query({
  args: {
    internalControlId: v.string(),
  },
  returns: v.union(securityControlWorkspaceValidator, v.null()),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await getSecurityControlWorkspaceRecord(ctx, args.internalControlId, {
      authUserId: currentUser.authUserId,
    });
  },
});

export const listSecurityControlWorkspaceExports = query({
  args: {
    controlIds: v.optional(v.array(v.string())),
  },
  returns: securityControlWorkspaceExportListValidator,
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityControlWorkspaceExportRecords(ctx, {
      controlIds: args.controlIds,
    });
  },
});

export const listControlWorkspaceSnapshotInternal = internalQuery({
  args: {},
  returns: securityControlWorkspaceExportListValidator,
  handler: async (ctx) => {
    return await listSecurityControlWorkspaceExportRecords(ctx);
  },
});

export const getLatestReleaseProvenanceEvidenceInternal = internalQuery({
  args: {},
  returns: v.union(releaseProvenanceEvidenceSummaryValidator, v.null()),
  handler: async (ctx) => {
    const latestEvidence = await getLatestReleaseProvenanceEvidence(ctx);
    if (!latestEvidence) {
      return null;
    }

    return {
      createdAt: latestEvidence.createdAt,
      id: latestEvidence._id,
      lifecycleStatus: latestEvidence.lifecycleStatus ?? 'active',
      reviewedAt: latestEvidence.reviewedAt ?? null,
      sufficiency: latestEvidence.sufficiency,
      title: latestEvidence.title,
    };
  },
});

export const listSecurityFindings = siteAdminQuery({
  args: {},
  returns: securityFindingListValidator,
  handler: listSecurityFindingsHandler,
});

export const listSecurityFindingsInternal = internalQuery({
  args: {},
  returns: securityFindingListValidator,
  handler: async (ctx) => await buildSecurityFindingListRecords(ctx as QueryCtx),
});

export const reviewSecurityFinding = siteAdminMutation({
  args: {
    customerSummary: v.optional(v.string()),
    disposition: securityFindingDispositionValidator,
    findingKey: v.string(),
    internalNotes: v.optional(v.string()),
  },
  returns: securityFindingListItemValidator,
  handler: reviewSecurityFindingHandler,
});

export const openSecurityFindingFollowUp = mutation({
  args: {
    findingKey: v.string(),
    note: v.optional(v.string()),
  },
  returns: reviewRunSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    await syncCurrentSecurityFindings(ctx, currentUser.authUserId);
    const finding = (await buildCurrentSecurityFindings(ctx)).find(
      (entry) => entry.findingKey === args.findingKey,
    );
    if (!finding) {
      throwConvexError('NOT_FOUND', 'Security finding not found.');
    }

    const runId = await createTriggeredReviewRunRecord(ctx, {
      actorUserId: currentUser.authUserId,
      controlLinks: getSecurityFindingControlLinks(finding.findingType),
      dedupeKey: `security-finding:${finding.findingKey}`,
      sourceLink: {
        freshAt: finding.lastObservedAt,
        sourceId: finding.findingKey,
        sourceLabel: finding.title,
        sourceType: 'security_finding',
      },
      sourceRecordId: finding.findingKey,
      sourceRecordType: 'security_finding',
      title: `${finding.title} follow-up`,
      triggerType: 'security_finding_follow_up',
    });
    const run = await ctx.db.get(runId);
    if (!run) {
      throwConvexError('NOT_FOUND', 'Security finding follow-up run not found after create.');
    }

    return await buildReviewRunSummary(ctx as unknown as QueryCtx, run);
  },
});

export const listSecurityControlEvidenceActivity = query({
  args: {
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: securityControlEvidenceActivityListValidator,
  handler: listSecurityControlEvidenceActivityHandler,
});

export const addSecurityControlEvidenceLink = mutation({
  args: {
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    url: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      ...getSecurityScopeFields(),
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'link',
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      url: args.url.trim(),
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      validUntil: undefined,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title.trim(),
      evidenceType: 'link',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
      session: currentUser.authSession,
    });
    return evidenceId;
  },
});

export const createSecurityControlEvidenceLinkInternal = internalMutation({
  args: {
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    organizationId: v.optional(v.string()),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    uploadedByUserId: v.string(),
    url: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      ...getSecurityScopeFields(),
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'link',
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      url: args.url.trim(),
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: args.uploadedByUserId,
      validUntil: undefined,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: args.uploadedByUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title.trim(),
      evidenceType: 'link',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: args.organizationId,
      reviewStatus: 'pending',
    });
    return evidenceId;
  },
});

export const addSecurityControlEvidenceNote = mutation({
  args: {
    description: v.string(),
    evidenceDate: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      ...getSecurityScopeFields(),
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'note',
      title: args.title.trim(),
      description: args.description.trim(),
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      validUntil: undefined,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title.trim(),
      evidenceType: 'note',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reviewStatus: 'pending',
      session: currentUser.authSession,
    });
    return evidenceId;
  },
});

export const reviewSecurityControlEvidence = mutation({
  args: {
    evidenceId: v.id('securityControlEvidence'),
    reviewStatus: v.union(v.literal('pending'), v.literal('reviewed')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    await assertFreshEvidenceAdminSessionOrThrow(ctx, currentUser);
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) {
      throwConvexError('NOT_FOUND', 'Evidence not found.');
    }
    if ((evidence.lifecycleStatus ?? 'active') !== 'active') {
      throwConvexError('VALIDATION', 'Only active evidence can be reviewed.');
    }

    const now = Date.now();
    await ctx.db.patch(args.evidenceId, {
      reviewStatus: args.reviewStatus,
      reviewedAt: args.reviewStatus === 'reviewed' ? now : undefined,
      reviewedByUserId: args.reviewStatus === 'reviewed' ? currentUser.authUserId : undefined,
      validUntil:
        args.reviewStatus === 'reviewed'
          ? evidence.reviewDueIntervalMonths
            ? addMonths(now, evidence.reviewDueIntervalMonths)
            : undefined
          : undefined,
      updatedAt: now,
    });
    if (args.reviewStatus === 'reviewed') {
      await recordSecurityControlEvidenceAuditEvent(ctx, {
        actorUserId: currentUser.authUserId,
        eventType: 'security_control_evidence_reviewed',
        evidenceId: evidence._id,
        evidenceTitle: evidence.title,
        evidenceType: evidence.evidenceType,
        internalControlId: evidence.internalControlId,
        itemId: evidence.itemId,
        lifecycleStatus: evidence.lifecycleStatus ?? 'active',
        organizationId: currentUser.activeOrganizationId ?? undefined,
        reviewStatus: 'reviewed',
        session: currentUser.authSession,
      });
    }
    return null;
  },
});

export const archiveSecurityControlEvidence = siteAdminMutation({
  args: {
    evidenceId: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertFreshEvidenceAdminSessionOrThrow(ctx as MutationCtx, ctx.user);
    await archiveSecurityControlEvidenceHandler(ctx as MutationCtx, args);
    return null;
  },
});

export const renewSecurityControlEvidence = mutation({
  args: {
    evidenceId: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    await assertFreshEvidenceAdminSessionOrThrow(ctx, currentUser);
    return await renewSecurityControlEvidenceHandler(ctx, args);
  },
});

export const createSecurityControlEvidenceUploadTarget = action({
  args: {
    contentType: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.object({
    backend: v.union(v.literal('convex'), v.literal('s3')),
    backendMode: v.union(v.literal('convex'), v.literal('s3-primary'), v.literal('s3-mirror')),
    expiresAt: v.number(),
    storageId: v.string(),
    uploadFields: v.optional(v.record(v.string(), v.string())),
    uploadHeaders: v.optional(v.record(v.string(), v.string())),
    uploadMethod: v.union(v.literal('POST'), v.literal('PUT')),
    uploadUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    await requireStepUpFromActionOrThrow(ctx, STEP_UP_REQUIREMENTS.organizationAdmin);
    validateSecurityEvidenceUploadInput(args);
    await enforceSecurityEvidenceUploadRateLimit(ctx, currentUser.authUserId);
    const target = await createUploadTargetWithMode(ctx, {
      contentType: args.contentType,
      fileName: args.fileName,
      fileSize: args.fileSize,
      organizationId: currentUser.activeOrganizationId ?? null,
      sourceId: `${args.internalControlId}:${args.itemId}`,
      sourceType: 'security_control_evidence',
    });
    const backendMode: 'convex' | 's3-primary' | 's3-mirror' =
      target.backend === 'convex'
        ? 'convex'
        : process.env.FILE_STORAGE_BACKEND_MODE === 's3-mirror'
          ? 's3-mirror'
          : 's3-primary';

    return {
      ...target,
      backendMode,
    };
  },
});

export const finalizeSecurityControlEvidenceUpload = action({
  args: {
    backendMode: v.union(v.literal('convex'), v.literal('s3-primary'), v.literal('s3-mirror')),
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    mimeType: v.string(),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    storageId: v.string(),
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args): Promise<Id<'securityControlEvidence'>> => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    await requireStepUpFromActionOrThrow(ctx, STEP_UP_REQUIREMENTS.organizationAdmin);
    await ctx.runAction(internal.storagePlatform.finalizeUploadInternal, {
      backendMode: args.backendMode,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
      organizationId: currentUser.activeOrganizationId ?? null,
      sourceId: `${args.internalControlId}:${args.itemId}`,
      sourceType: 'security_control_evidence',
      storageId: args.storageId,
    });

    return await ctx.runMutation(
      internal.securityWorkspace.createSecurityControlEvidenceFileInternal,
      {
        description: args.description?.trim() || undefined,
        evidenceDate: args.evidenceDate,
        fileName: args.fileName,
        fileSize: args.fileSize,
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        mimeType: args.mimeType,
        organizationId: currentUser.activeOrganizationId ?? undefined,
        reviewDueIntervalMonths: args.reviewDueIntervalMonths,
        storageId: args.storageId,
        source: args.source,
        sufficiency: args.sufficiency,
        title: args.title.trim(),
        uploadedByUserId: currentUser.authUserId,
      },
    );
  },
});

export const createSecurityControlEvidenceFileInternal = internalMutation({
  args: {
    description: v.optional(v.string()),
    evidenceDate: v.number(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    mimeType: v.string(),
    organizationId: v.optional(v.string()),
    reviewDueIntervalMonths: evidenceReviewDueIntervalValidator,
    storageId: v.string(),
    source: evidenceSourceValidator,
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    uploadedByUserId: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const now = Date.now();
    const evidenceId = await ctx.db.insert('securityControlEvidence', {
      ...getSecurityScopeFields(),
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'file',
      title: args.title,
      description: args.description,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.fileSize,
      evidenceDate: args.evidenceDate,
      reviewDueIntervalMonths: args.reviewDueIntervalMonths,
      source: args.source,
      sufficiency: args.sufficiency,
      uploadedByUserId: args.uploadedByUserId,
      validUntil: undefined,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await recordSecurityControlEvidenceAuditEvent(ctx, {
      actorUserId: args.uploadedByUserId,
      eventType: 'security_control_evidence_created',
      evidenceId,
      evidenceTitle: args.title,
      evidenceType: 'file',
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      lifecycleStatus: 'active',
      organizationId: args.organizationId,
      reviewStatus: 'pending',
    });
    return evidenceId;
  },
});
