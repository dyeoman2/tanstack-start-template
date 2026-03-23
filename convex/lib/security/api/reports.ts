import type { Id } from '../../../_generated/dataModel';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../../../_generated/server';
import type { ActionCtx, QueryCtx } from '../../../_generated/server';
import { getRetentionPolicyConfig } from '../../../../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../../../../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../../../../src/lib/shared/compliance/control-register';
import {
  ALWAYS_ON_REGULATED_BASELINE,
  REGULATED_ORGANIZATION_POLICY_DEFAULTS,
} from '../../../../src/lib/shared/security-baseline';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
} from '../../../auth/access';
import {
  ANNUAL_REVIEW_TASK_BLUEPRINTS,
  BACKUP_DRILL_STALE_WINDOW_MS,
  EXPORT_ARTIFACT_SCHEMA_VERSION,
  REVIEW_RUN_SOURCE_SURFACE,
} from '../securityReviewConfig';
import {
  addDays,
  buildExportManifest,
  buildVendorRelatedControls,
  deleteSecurityRelationships,
  getSecurityScopeFields,
  getVendorRelatedControlLinks,
  hashContent,
  normalizeSecurityScope,
  stringifyStable,
  summarizeIntegrityCheck,
  upsertSecurityRelationship,
} from './core';
import {
  buildEvidenceReportDetail,
  buildVendorWorkspaceRows,
  createTriggeredReviewRunRecord,
  deriveReportBackedTaskOutcome,
  getAutomationEvidenceLabel,
  isReportBackedAutomatedTask,
  reconcileEvidenceReportLinkedTasks,
  syncVendorReviewOverlayRecords,
} from './review_runs_core';
import {
  SECURITY_SCOPE_ID,
  SECURITY_SCOPE_TYPE,
  evidenceReportDetailValidator,
  evidenceReportKindValidator,
  evidenceReportListValidator,
  evidenceReportRecordValidator,
  evidenceReportValidator,
  reviewRunDetailValidator,
  vendorKeyValidator,
  vendorReviewStatusValidator,
  vendorWorkspaceListValidator,
  vendorWorkspaceValidator,
} from './validators';
import { anyApi } from 'convex/server';
import { v } from 'convex/values';

export const listEvidenceReports = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: evidenceReportListValidator,
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const reports = await ctx.db
      .query('evidenceReports')
      .withIndex('by_created_at')
      .order('desc')
      .take(limit);
    return reports.map((report) => ({
      id: report._id,
      createdAt: report.createdAt,
      generatedByUserId: report.generatedByUserId,
      internalReviewNotes: report.internalReviewNotes ?? report.reviewNotes ?? null,
      scopeId: normalizeSecurityScope(report).scopeId,
      scopeType: normalizeSecurityScope(report).scopeType,
      reportKind: report.reportKind,
      contentHash: report.contentHash,
      exportHash: report.exportHash ?? null,
      exportManifestHash: report.exportManifestHash ?? null,
      exportedAt: report.exportedAt ?? null,
      exportedByUserId: report.exportedByUserId ?? null,
      reviewStatus: report.reviewStatus,
      reviewedAt: report.reviewedAt ?? null,
      reviewedByUserId: report.reviewedByUserId ?? null,
    }));
  },
});

export const getEvidenceReportDetail = query({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: v.union(evidenceReportDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await buildEvidenceReportDetail(ctx, args.id);
  },
});

export const reviewEvidenceReport = mutation({
  args: {
    customerSummary: v.optional(v.string()),
    id: v.id('evidenceReports'),
    internalNotes: v.optional(v.string()),
    internalReviewNotes: v.optional(v.string()),
    reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_follow_up')),
  },
  returns: evidenceReportRecordValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const report = await ctx.db.get(args.id);
    if (!report) {
      throw new Error('Evidence report not found');
    }

    const reviewedAt = Date.now();
    const internalReviewNotes =
      args.internalNotes?.trim() || args.internalReviewNotes?.trim() || null;
    await ctx.db.patch(args.id, {
      customerSummary: args.customerSummary?.trim() || null,
      internalReviewNotes,
      reviewStatus: args.reviewStatus,
      reviewedAt,
      reviewedByUserId: currentUser.authUserId,
    });

    if (args.reviewStatus === 'needs_follow_up') {
      await createTriggeredReviewRunRecord(ctx, {
        actorUserId: currentUser.authUserId,
        dedupeKey: `evidence-report:${report._id}`,
        sourceLink: {
          freshAt: reviewedAt,
          sourceId: report._id,
          sourceLabel: report.reportKind,
          sourceType: 'evidence_report',
        },
        sourceRecordId: report._id,
        sourceRecordType: 'evidence_report',
        title: `${report.reportKind} follow-up`,
        triggerType: 'evidence_report_follow_up',
      });
    }

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'evidence_report_reviewed',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: report._id,
      resourceLabel: report.reportKind,
      resourceType: 'evidence_report',
      severity: args.reviewStatus === 'reviewed' ? 'info' : 'warning',
      sourceSurface: 'admin.security',
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        customerSummary: args.customerSummary?.trim() || null,
        internalReviewNotes,
        reviewStatus: args.reviewStatus,
      }),
    });

    const updated = await ctx.db.get(args.id);
    if (!updated) {
      throw new Error('Evidence report not found after update');
    }

    await reconcileEvidenceReportLinkedTasks(ctx, {
      actorUserId: currentUser.authUserId,
      report: updated,
    });

    return updated;
  },
});

export const listVendorReviewWorkspaces = query({
  args: {},
  returns: vendorWorkspaceListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await buildVendorWorkspaceRows(ctx);
  },
});

export const syncVendorReviewRecords = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await syncVendorReviewOverlayRecords(ctx);
  },
});

export const reviewVendorWorkspace = mutation({
  args: {
    customerSummary: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    internalReviewNotes: v.optional(v.string()),
    owner: v.optional(v.string()),
    reviewStatus: vendorReviewStatusValidator,
    vendorKey: vendorKeyValidator,
  },
  returns: vendorWorkspaceValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('securityVendorReviews')
      .withIndex('by_vendor_key', (q) => q.eq('vendorKey', args.vendorKey))
      .unique();
    const now = Date.now();
    const linkedFollowUpRunId =
      args.reviewStatus === 'needs_follow_up'
        ? await createTriggeredReviewRunRecord(ctx, {
            actorUserId: currentUser.authUserId,
            controlLinks: buildVendorRelatedControls(args.vendorKey).map((control) => ({
              internalControlId: control.internalControlId,
              itemId: control.itemId ?? '',
            })),
            dedupeKey: `vendor-review:${args.vendorKey}`,
            sourceLink: {
              freshAt: now,
              sourceId: args.vendorKey,
              sourceLabel: args.vendorKey,
              sourceType: 'vendor_review',
            },
            sourceRecordId: args.vendorKey,
            sourceRecordType: 'vendor_review',
            title: `${args.vendorKey} vendor follow-up`,
            triggerType: 'vendor_review_follow_up',
          })
        : null;

    if (existing) {
      if (existing.linkedFollowUpRunId && existing.linkedFollowUpRunId !== linkedFollowUpRunId) {
        await deleteSecurityRelationships(ctx, {
          fromId: args.vendorKey,
          fromType: 'vendor_review',
          relationshipType: 'follow_up_for',
          toId: existing.linkedFollowUpRunId,
          toType: 'review_run',
        });
      }
      const internalReviewNotes =
        args.internalNotes?.trim() || args.internalReviewNotes?.trim() || null;
      await ctx.db.patch(existing._id, {
        customerSummary: args.customerSummary?.trim() || null,
        internalReviewNotes,
        linkedFollowUpRunId: linkedFollowUpRunId ?? undefined,
        owner: args.owner?.trim() || undefined,
        reviewStatus: args.reviewStatus,
        reviewedAt: now,
        reviewedByUserId: currentUser.authUserId,
        updatedAt: now,
      });
    } else {
      const internalReviewNotes =
        args.internalNotes?.trim() || args.internalReviewNotes?.trim() || null;
      await ctx.db.insert('securityVendorReviews', {
        ...getSecurityScopeFields(),
        createdAt: now,
        customerSummary: args.customerSummary?.trim() || null,
        internalReviewNotes,
        linkedFollowUpRunId: linkedFollowUpRunId ?? undefined,
        owner: args.owner?.trim() || undefined,
        reviewStatus: args.reviewStatus,
        reviewedAt: now,
        reviewedByUserId: currentUser.authUserId,
        updatedAt: now,
        vendorKey: args.vendorKey,
      });
    }

    const workspaces = await buildVendorWorkspaceRows(ctx as unknown as QueryCtx);
    const updated = workspaces.find((workspace) => workspace.vendor === args.vendorKey);
    if (!updated) {
      throw new Error('Vendor workspace not found after review update.');
    }
    for (const controlLink of getVendorRelatedControlLinks(args.vendorKey)) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: currentUser.authUserId,
        fromId: args.vendorKey,
        fromType: 'vendor_review',
        relationshipType: 'related_control',
        toId: controlLink.internalControlId,
        toType: 'control',
      });
      await upsertSecurityRelationship(ctx, {
        createdByUserId: currentUser.authUserId,
        fromId: controlLink.internalControlId,
        fromType: 'control',
        relationshipType: 'tracks_vendor_review',
        toId: args.vendorKey,
        toType: 'vendor_review',
      });
    }
    if (linkedFollowUpRunId) {
      await upsertSecurityRelationship(ctx, {
        createdByUserId: currentUser.authUserId,
        fromId: args.vendorKey,
        fromType: 'vendor_review',
        relationshipType: 'follow_up_for',
        toId: linkedFollowUpRunId,
        toType: 'review_run',
      });
    }

    return updated;
  },
});

export async function exportEvidenceReportHandler(
  ctx: ActionCtx,
  args: {
    id: Id<'evidenceReports'>;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const report = await ctx.runQuery(anyApi.security.getEvidenceReportInternal, {
    id: args.id,
  });
  if (!report) {
    throw new Error('Evidence report not found');
  }

  const exportedAt = Date.now();
  const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditIntegrityInternal, {
    limit: 250,
  });
  const exportBundle = stringifyStable({
    contentHash: report.contentHash,
    exportedAt: new Date(exportedAt).toISOString(),
    integritySummary: {
      contentHash: report.contentHash,
      checkedAt: integrityCheck.checkedAt,
      failureCount: integrityCheck.failures.length,
      reviewedAt: report.reviewedAt ?? null,
      reviewStatus: report.reviewStatus,
    },
    report: JSON.parse(report.contentJson),
    reportId: report._id,
  });
  const exportHash = await hashContent(exportBundle);
  const exportId = crypto.randomUUID();
  const manifest = buildExportManifest({
    actorUserId: currentUser.authUserId,
    contentHash: report.contentHash,
    exactFilters: {
      reportId: report._id,
      reportKind: report.reportKind,
    },
    exportHash,
    exportId,
    exportedAt,
    integritySummary: summarizeIntegrityCheck(integrityCheck),
    organizationScope: report.organizationId ?? currentUser.activeOrganizationId ?? null,
    reviewStatusAtExport: report.reviewStatus,
    rowCount: 1,
    sourceReportId: report._id,
  });
  const manifestJson = stringifyStable(manifest);
  const manifestHash = await hashContent(manifestJson);
  const exportIntegritySummary = stringifyStable({
    contentHash: report.contentHash,
    exportHash,
    manifestHash,
    reviewStatus: report.reviewStatus,
  });
  const artifactId = await ctx.runMutation(anyApi.security.storeExportArtifact, {
    artifactType: 'evidence_report_export',
    exportedAt,
    exportedByUserId: currentUser.authUserId,
    manifestHash,
    manifestJson,
    organizationId: report.organizationId ?? currentUser.activeOrganizationId ?? undefined,
    payloadHash: exportHash,
    payloadJson: exportBundle,
    schemaVersion: EXPORT_ARTIFACT_SCHEMA_VERSION,
    sourceReportId: args.id,
  });

  await ctx.runMutation(anyApi.security.storeEvidenceReportExport, {
    id: args.id,
    exportBundleJson: exportBundle,
    exportHash,
    exportIntegritySummary,
    exportManifestHash: manifestHash,
    exportManifestJson: manifestJson,
    exportedAt,
    exportedByUserId: currentUser.authUserId,
    latestExportArtifactId: artifactId,
  });

  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    actorUserId: currentUser.authUserId,
    eventType: 'evidence_report_exported',
    identifier: currentUser.authUser.email ?? undefined,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: report._id,
    resourceLabel: report.reportKind,
    resourceType: 'evidence_report',
    severity: 'info',
    sourceSurface: 'admin.security',
    userId: currentUser.authUserId,
    metadata: stringifyStable({
      exportHash,
      exportId,
      filters: manifest.exactFilters,
      manifestHash,
      rowCount: manifest.rowCount,
      scope: manifest.organizationScope,
    }),
  });

  return {
    createdAt: report.createdAt,
    exportHash,
    id: report._id,
    report: exportBundle,
    scopeId: normalizeSecurityScope(report).scopeId,
    scopeType: normalizeSecurityScope(report).scopeType,
    reportKind: report.reportKind,
    reviewStatus: report.reviewStatus,
  };
}

export const exportEvidenceReport = action({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: evidenceReportValidator,
  handler: exportEvidenceReportHandler,
});

export const getEvidenceReportInternal = internalQuery({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: v.union(evidenceReportRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.id)) ?? null;
  },
});

export const storeEvidenceReportExport = internalMutation({
  args: {
    id: v.id('evidenceReports'),
    exportBundleJson: v.string(),
    exportHash: v.string(),
    exportIntegritySummary: v.string(),
    exportManifestHash: v.string(),
    exportManifestJson: v.string(),
    exportedAt: v.number(),
    exportedByUserId: v.string(),
    latestExportArtifactId: v.id('exportArtifacts'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      exportBundleJson: args.exportBundleJson,
      exportHash: args.exportHash,
      exportIntegritySummary: args.exportIntegritySummary,
      exportManifestHash: args.exportManifestHash,
      exportManifestJson: args.exportManifestJson,
      exportedAt: args.exportedAt,
      exportedByUserId: args.exportedByUserId,
      latestExportArtifactId: args.latestExportArtifactId,
    });
    return null;
  },
});

export async function generateEvidenceReportHandler(
  ctx: ActionCtx,
  args: {
    reportKind?:
      | 'security_posture'
      | 'audit_integrity'
      | 'audit_readiness'
      | 'annual_review'
      | 'findings_snapshot'
      | 'vendor_posture_snapshot'
      | 'control_workspace_snapshot';
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  await ctx.runMutation(anyApi.security.syncCurrentSecurityFindingsInternal, {
    actorUserId: currentUser.authUserId,
  });
  const reportKind = args.reportKind ?? 'security_posture';
  const needsControlWorkspace =
    reportKind === 'security_posture' ||
    reportKind === 'annual_review' ||
    reportKind === 'control_workspace_snapshot';
  const summary = await ctx.runQuery(anyApi.security.getSecurityPostureSummary, {});
  const controlWorkspace = (
    needsControlWorkspace
      ? (
          await Promise.all(
            ACTIVE_CONTROL_REGISTER.controls.map(async (control) => {
              return await ctx.runQuery(anyApi.security.getSecurityControlWorkspaceDetail, {
                internalControlId: control.internalControlId,
              });
            }),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : []
  ) as Array<{
    evidenceReadiness: 'missing' | 'partial' | 'ready';
    internalControlId: string;
    platformChecklist: Array<{
      evidence: Array<{
        createdAt: number;
        id: string;
        lifecycleStatus: 'active' | 'archived' | 'superseded';
        reviewStatus: 'pending' | 'reviewed';
        reviewedAt: number | null;
        sufficiency: 'missing' | 'partial' | 'sufficient';
        title: string;
      }>;
      itemId: string;
    }>;
  }>;
  const recentAuditLogs: Array<{
    createdAt: number;
    eventType: string;
    organizationId?: string;
    outcome?: 'success' | 'failure';
    resourceType?: string;
    sourceSurface?: string;
  }> = await ctx.runQuery(anyApi.audit.getRecentAuditLogsInternal, {
    limit: 25,
  });
  const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditIntegrityInternal, {
    limit: 250,
  });
  const auditReadinessSnapshot = await ctx.runQuery(anyApi.security.getAuditReadinessSnapshot, {});
  const currentOrganizationPolicies = currentUser.activeOrganizationId
    ? await ctx.runQuery(anyApi.organizationManagement.getOrganizationPoliciesInternal, {
        organizationId: currentUser.activeOrganizationId,
      })
    : null;
  const vendorPosture = getVendorBoundarySnapshot();
  const vendorWorkspaces = (
    reportKind === 'vendor_posture_snapshot' || reportKind === 'annual_review'
      ? await ctx.runQuery(anyApi.security.listVendorReviewWorkspaces, {})
      : []
  ) as Array<{
    approved: boolean;
    approvedByDefault: boolean;
    allowedDataClasses: string[];
    allowedEnvironments: Array<'development' | 'production' | 'test'>;
    approvalEnvVar: string | null;
    displayName: string;
    linkedEntities: Array<{
      entityId: string;
      entityType: 'control' | 'review_run';
      label: string;
      relationshipType: 'follow_up_for' | 'related_control';
      status: string | null;
    }>;
    linkedFollowUpRunId: Id<'reviewRuns'> | null;
    owner: string | null;
    relatedControls: Array<{
      internalControlId: string;
      itemId: string | null;
      itemLabel: string | null;
      nist80053Id: string;
      title: string;
    }>;
    customerSummary: string | null;
    internalReviewNotes: string | null;
    reviewStatus: 'pending' | 'reviewed' | 'needs_follow_up';
    reviewedAt: number | null;
    reviewedByDisplay: string | null;
    scopeId: string;
    scopeType: 'provider_global';
    vendor: 'openrouter' | 'resend' | 'sentry';
  }>;
  const currentFindings = (
    reportKind === 'findings_snapshot' || reportKind === 'annual_review'
      ? await ctx.runQuery(anyApi.security.listSecurityFindings, {})
      : []
  ) as Array<{
    disposition:
      | 'accepted_risk'
      | 'false_positive'
      | 'investigating'
      | 'pending_review'
      | 'resolved';
    status: 'open' | 'resolved';
  }>;
  const createdAt = Date.now();
  const reportPayload =
    reportKind === 'audit_readiness'
      ? {
          generatedAt: new Date(createdAt).toISOString(),
          generatedByUserId: currentUser.authUserId,
          integrityCheck,
          retention: {
            lastJobAt: auditReadinessSnapshot.latestRetentionJob?.createdAt ?? null,
            lastJobStatus: auditReadinessSnapshot.latestRetentionJob?.status ?? null,
            processedCount: auditReadinessSnapshot.latestRetentionJob?.processedCount ?? null,
          },
          recentDeniedActions: auditReadinessSnapshot.recentDeniedActions,
          recentExports: auditReadinessSnapshot.recentExports,
          backupDrill: {
            isStale:
              auditReadinessSnapshot.latestBackupDrill === null ||
              createdAt - auditReadinessSnapshot.latestBackupDrill.checkedAt >
                BACKUP_DRILL_STALE_WINDOW_MS,
            latest: auditReadinessSnapshot.latestBackupDrill,
          },
          metadataGaps: auditReadinessSnapshot.metadataGaps,
          summary: {
            backupDrillStatus: auditReadinessSnapshot.latestBackupDrill?.status ?? null,
            deniedActionCount: auditReadinessSnapshot.recentDeniedActions.length,
            exportCount: auditReadinessSnapshot.recentExports.length,
            integrityFailureCount: integrityCheck.failures.length,
            metadataGapCount: auditReadinessSnapshot.metadataGaps.length,
          },
        }
      : reportKind === 'findings_snapshot'
        ? {
            findings: currentFindings,
            generatedAt: new Date(createdAt).toISOString(),
            generatedByUserId: currentUser.authUserId,
            summary: {
              openCount: currentFindings.filter((finding) => finding.status === 'open').length,
              totalCount: currentFindings.length,
              unresolvedCount: currentFindings.filter(
                (finding) => finding.disposition !== 'resolved',
              ).length,
            },
          }
        : reportKind === 'vendor_posture_snapshot'
          ? {
              generatedAt: new Date(createdAt).toISOString(),
              generatedByUserId: currentUser.authUserId,
              summary: {
                approvedCount: vendorWorkspaces.filter((vendor) => vendor.approved).length,
                needsFollowUpCount: vendorWorkspaces.filter(
                  (vendor) => vendor.reviewStatus === 'needs_follow_up',
                ).length,
                totalCount: vendorWorkspaces.length,
              },
              vendorBoundary: vendorWorkspaces,
            }
          : reportKind === 'control_workspace_snapshot'
            ? {
                controls: controlWorkspace,
                generatedAt: new Date(createdAt).toISOString(),
                generatedByUserId: currentUser.authUserId,
                summary: {
                  readyCount: controlWorkspace.filter(
                    (control) => control.evidenceReadiness === 'ready',
                  ).length,
                  totalCount: controlWorkspace.length,
                },
              }
            : reportKind === 'annual_review'
              ? {
                  controls: controlWorkspace,
                  findings: currentFindings,
                  generatedAt: new Date(createdAt).toISOString(),
                  generatedByUserId: currentUser.authUserId,
                  summary,
                  vendorBoundary: vendorWorkspaces,
                }
              : {
                  generatedAt: new Date(createdAt).toISOString(),
                  generatedByUserId: currentUser.authUserId,
                  baselineDefaults: {
                    organizationPolicies: REGULATED_ORGANIZATION_POLICY_DEFAULTS,
                  },
                  sessionPolicy: {
                    sessionExpiryHours: 24,
                    sessionRefreshHours: 4,
                    recentStepUpWindowMinutes: getRetentionPolicyConfig().recentStepUpWindowMinutes,
                    temporaryLinkTtlMinutes: getRetentionPolicyConfig().attachmentUrlTtlMinutes,
                  },
                  telemetryPosture: {
                    sentryApproved: vendorPosture.some(
                      (vendor) => vendor.vendor === 'sentry' && vendor.approved,
                    ),
                    sentryEnabled:
                      vendorPosture.some(
                        (vendor) => vendor.vendor === 'sentry' && vendor.approved,
                      ) && Boolean(process.env.VITE_SENTRY_DSN),
                  },
                  vendorBoundary: vendorPosture,
                  verificationPosture: {
                    emailVerificationRequired: ALWAYS_ON_REGULATED_BASELINE.requireVerifiedEmail,
                    mfaRequired: ALWAYS_ON_REGULATED_BASELINE.requireMfaOrPasskey,
                  },
                  integrityCheck,
                  recentAuditEvents: recentAuditLogs.slice(0, 10).map((log) => ({
                    createdAt: log.createdAt,
                    eventType: log.eventType,
                    outcome: log.outcome ?? null,
                    organizationId: log.organizationId ?? null,
                    resourceType: log.resourceType ?? null,
                    sourceSurface: log.sourceSurface ?? null,
                  })),
                  scopedOrganizationPolicies: currentOrganizationPolicies,
                  summary,
                  controls: controlWorkspace,
                };
  const report = stringifyStable(reportPayload);
  const contentHash = await hashContent(report);

  const id = await ctx.runMutation(anyApi.security.createEvidenceReport, {
    contentJson: report,
    contentHash,
    generatedByUserId: currentUser.authUserId,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reportKind,
  });

  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    actorUserId: currentUser.authUserId,
    eventType: 'evidence_report_generated',
    identifier: currentUser.authUser.email ?? undefined,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: id,
    resourceLabel: reportKind,
    resourceType: 'evidence_report',
    severity: 'info',
    sourceSurface: 'admin.security',
    userId: currentUser.authUserId,
    metadata: stringifyStable({
      contentHash,
      filters: { reportKind },
    }),
  });

  return {
    createdAt,
    exportHash: null,
    id,
    report,
    scopeId: SECURITY_SCOPE_ID,
    scopeType: SECURITY_SCOPE_TYPE,
    reportKind,
    reviewStatus: 'pending' as const,
  };
}

export const generateEvidenceReport = action({
  args: {
    reportKind: v.optional(evidenceReportKindValidator),
  },
  returns: evidenceReportValidator,
  handler: generateEvidenceReportHandler,
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

export const refreshReviewRunAutomation = action({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const detail = (await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    })) as {
      id: Id<'reviewRuns'>;
      kind: 'annual' | 'triggered';
      tasks: Array<{
        freshnessWindowDays: number | null;
        id: Id<'reviewTasks'>;
        taskType: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up';
        templateKey: string;
        title: string;
      }>;
    } | null;
    if (!detail) {
      return null;
    }
    if (detail.kind !== 'annual') {
      return detail;
    }

    const auditReadiness = await ctx.runQuery(anyApi.security.getAuditReadinessOverview, {});

    for (const task of detail.tasks.filter((entry) => entry.taskType === 'automated_check')) {
      const blueprint = ANNUAL_REVIEW_TASK_BLUEPRINTS.find(
        (entry) => entry.templateKey === task.templateKey,
      );
      if (!blueprint?.automationKind) {
        continue;
      }

      if (
        blueprint.automationKind === 'security_posture' ||
        blueprint.automationKind === 'audit_readiness' ||
        blueprint.automationKind === 'findings_snapshot' ||
        blueprint.automationKind === 'vendor_posture_snapshot' ||
        blueprint.automationKind === 'control_workspace_snapshot'
      ) {
        const reportKind =
          blueprint.automationKind === 'security_posture'
            ? 'security_posture'
            : blueprint.automationKind === 'audit_readiness'
              ? 'audit_readiness'
              : blueprint.automationKind;
        const report = await generateEvidenceReportHandler(ctx, {
          reportKind,
        });
        await ctx.runMutation(anyApi.security.replaceReviewTaskEvidenceLinksInternal, {
          reviewTaskId: task.id,
          sourceTypes: ['evidence_report'],
        });
        await ctx.runMutation(anyApi.security.upsertReviewTaskEvidenceLinkInternal, {
          freshAt: report.createdAt,
          reviewRunId: detail.id,
          reviewTaskId: task.id,
          role: 'primary',
          sourceId: report.id,
          sourceLabel: getAutomationEvidenceLabel(blueprint),
          sourceType: 'evidence_report',
        });
        const outcome = deriveReportBackedTaskOutcome(
          {
            contentJson: report.report,
            createdAt: report.createdAt,
            reportKind,
            reviewStatus: report.reviewStatus,
            reviewedAt: null,
          },
          {
            freshnessWindowDays: task.freshnessWindowDays ?? undefined,
          },
        );
        await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
          actorUserId: 'system:automation',
          mode: 'automated_check',
          note: outcome.note,
          reviewTaskId: task.id,
          resultType: 'automated_check',
          satisfiedAt: outcome.satisfiedAt,
          satisfiedThroughAt: outcome.satisfiedThroughAt,
          status: outcome.status,
        });
        continue;
      }

      if (blueprint.automationKind === 'backup_verification') {
        const latestBackupDrill = auditReadiness.latestBackupDrill;
        await ctx.runMutation(anyApi.security.replaceReviewTaskEvidenceLinksInternal, {
          reviewTaskId: task.id,
          sourceTypes: ['backup_verification_report'],
        });
        if (!latestBackupDrill) {
          await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
            actorUserId: 'system:automation',
            mode: 'automated_check',
            note: 'No backup verification evidence is currently recorded.',
            reviewTaskId: task.id,
            resultType: 'automated_check',
            satisfiedAt: null,
            satisfiedThroughAt: null,
            status: 'blocked',
          });
          continue;
        }

        await ctx.runMutation(anyApi.security.upsertReviewTaskEvidenceLinkInternal, {
          freshAt: latestBackupDrill.checkedAt,
          reviewRunId: detail.id,
          reviewTaskId: task.id,
          role: 'primary',
          sourceId: latestBackupDrill.drillId,
          sourceLabel: getAutomationEvidenceLabel(blueprint),
          sourceType: 'backup_verification_report',
        });
        await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
          actorUserId: 'system:automation',
          mode: 'automated_check',
          reviewTaskId: task.id,
          resultType: 'automated_check',
          satisfiedAt: latestBackupDrill.checkedAt,
          satisfiedThroughAt: addDays(latestBackupDrill.checkedAt, task.freshnessWindowDays ?? 90),
          status: 'completed',
        });
        continue;
      }

      if (blueprint.automationKind === 'release_provenance') {
        await ctx.runMutation(anyApi.security.replaceReviewTaskEvidenceLinksInternal, {
          reviewTaskId: task.id,
          sourceTypes: ['security_control_evidence'],
        });
        const latestEvidence = (await ctx.runQuery(
          anyApi.security.getLatestReleaseProvenanceEvidenceInternal,
          {},
        )) as {
          createdAt: number;
          id: string;
          reviewedAt: number | null;
          sufficiency: 'missing' | 'partial' | 'sufficient';
          title: string;
        } | null;

        if (!latestEvidence) {
          await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
            actorUserId: 'system:automation',
            mode: 'automated_check',
            note: 'No release provenance evidence is currently linked.',
            reviewTaskId: task.id,
            resultType: 'automated_check',
            satisfiedAt: null,
            satisfiedThroughAt: null,
            status: 'blocked',
          });
          continue;
        }

        await ctx.runMutation(anyApi.security.upsertReviewTaskEvidenceLinkInternal, {
          freshAt: latestEvidence.reviewedAt ?? latestEvidence.createdAt,
          reviewRunId: detail.id,
          reviewTaskId: task.id,
          role: latestEvidence.sufficiency === 'sufficient' ? 'primary' : 'blocking',
          sourceId: latestEvidence.id,
          sourceLabel: latestEvidence.title,
          sourceType: 'security_control_evidence',
        });
        await ctx.runMutation(anyApi.security.applyReviewTaskStateInternal, {
          actorUserId: 'system:automation',
          mode: 'automated_check',
          note:
            latestEvidence.sufficiency === 'sufficient'
              ? undefined
              : 'The latest release provenance evidence is partial and still needs follow-up.',
          reviewTaskId: task.id,
          resultType: 'automated_check',
          satisfiedAt:
            latestEvidence.sufficiency === 'sufficient'
              ? (latestEvidence.reviewedAt ?? latestEvidence.createdAt)
              : null,
          satisfiedThroughAt:
            latestEvidence.sufficiency === 'sufficient'
              ? addDays(
                  latestEvidence.reviewedAt ?? latestEvidence.createdAt,
                  task.freshnessWindowDays ?? 90,
                )
              : null,
          status: latestEvidence.sufficiency === 'sufficient' ? 'completed' : 'blocked',
        });
      }
    }

    return await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    });
  },
});

export const finalizeReviewRun = action({
  args: {
    reviewRunId: v.id('reviewRuns'),
  },
  returns: v.union(reviewRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const detail = (await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    })) as {
      id: Id<'reviewRuns'>;
      required?: boolean;
      tasks: Array<{
        evidenceLinks: Array<{
          role: 'primary' | 'supporting' | 'blocking';
          sourceId: string;
          sourceType:
            | 'security_control_evidence'
            | 'evidence_report'
            | 'security_finding'
            | 'backup_verification_report'
            | 'external_document'
            | 'review_task'
            | 'vendor_review';
        }>;
        required: boolean;
        status: 'ready' | 'completed' | 'exception' | 'blocked';
        taskType: 'automated_check' | 'attestation' | 'document_upload' | 'follow_up';
        templateKey: string;
        title: string;
      }>;
      title: string;
    } | null;
    if (!detail) {
      return null;
    }

    const blockingTask = detail.tasks.find((task) => task.required && task.status === 'blocked');
    if (blockingTask) {
      throw new Error(`Finalize is blocked by "${blockingTask.title}".`);
    }
    const incompleteTask = detail.tasks.find(
      (task) => task.required && task.status !== 'completed' && task.status !== 'exception',
    );
    if (incompleteTask) {
      throw new Error(`Finalize requires "${incompleteTask.title}" to be completed first.`);
    }
    for (const task of detail.tasks) {
      if (!task.required || !isReportBackedAutomatedTask(task)) {
        continue;
      }
      const primaryReportLink = task.evidenceLinks.find(
        (link) => link.role === 'primary' && link.sourceType === 'evidence_report',
      );
      if (!primaryReportLink) {
        throw new Error(`Finalize requires "${task.title}" to have a reviewed linked report.`);
      }
      const report = await ctx.runQuery(anyApi.security.getEvidenceReportInternal, {
        id: primaryReportLink.sourceId as Id<'evidenceReports'>,
      });
      if (!report || report.reviewStatus !== 'reviewed') {
        throw new Error(`Finalize requires "${task.title}" to use a reviewed linked report.`);
      }
    }

    const createdAt = Date.now();
    const reportPayload = stringifyStable({
      finalizedAt: new Date(createdAt).toISOString(),
      generatedAt: new Date(createdAt).toISOString(),
      generatedByUserId: currentUser.authUserId,
      reviewRun: detail,
    });
    const reportId = await ctx.runMutation(anyApi.security.createEvidenceReport, {
      contentJson: reportPayload,
      contentHash: await hashContent(reportPayload),
      generatedByUserId: currentUser.authUserId,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reportKind: 'annual_review',
    });
    await exportEvidenceReportHandler(ctx, {
      id: reportId,
    });
    await ctx.runMutation(anyApi.security.storeReviewRunFinalization, {
      finalReportId: reportId,
      finalizedAt: createdAt,
      finalizedByUserId: currentUser.authUserId,
      reviewRunId: args.reviewRunId,
    });

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'security_review_run_finalized',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: args.reviewRunId,
      resourceLabel: detail.title,
      resourceType: 'review_run',
      severity: 'info',
      sourceSurface: REVIEW_RUN_SOURCE_SURFACE,
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        finalReportId: reportId,
        reviewRunId: args.reviewRunId,
      }),
    });

    return await ctx.runQuery(anyApi.security.getReviewRunDetail, {
      reviewRunId: args.reviewRunId,
    });
  },
});
