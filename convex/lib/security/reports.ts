import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { getRetentionPolicyConfig } from '../../../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../../../src/lib/server/vendor-boundary.server';
import {
  ALWAYS_ON_REGULATED_BASELINE,
  REGULATED_ORGANIZATION_POLICY_DEFAULTS,
} from '../../../src/lib/shared/security-baseline';
import { getVerifiedCurrentSiteAdminUserFromActionOrThrow } from '../../auth/access';
import {
  ANNUAL_REVIEW_TASK_BLUEPRINTS,
  BACKUP_DRILL_STALE_WINDOW_MS,
  EXPORT_ARTIFACT_SCHEMA_VERSION,
  REVIEW_RUN_SOURCE_SURFACE,
} from './securityReviewConfig';
import type { HoldAwareOperationDecision } from '../retention';
import {
  addDays,
  buildExportManifest,
  hashContent,
  normalizeSecurityScope,
  stringifyStable,
  summarizeIntegrityCheck,
} from './core';
import {
  deriveReportBackedTaskOutcome,
  getAutomationEvidenceLabel,
  isReportBackedAutomatedTask,
} from './review_runs_core';
import { SECURITY_SCOPE_ID, SECURITY_SCOPE_TYPE } from './validators';
import { anyApi } from 'convex/server';
import { recordSiteAdminAuditEvent } from '../auditEmitters';
import { resolveAuditRequestContext } from '../requestAuditContext';

export async function exportEvidenceReportHandler(
  ctx: ActionCtx,
  args: {
    id: Id<'evidenceReports'>;
    requestContext?: {
      ipAddress?: string | null;
      requestId?: string | null;
      userAgent?: string | null;
    } | null;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const auditRequestContext = resolveAuditRequestContext({
    requestContext: args.requestContext,
    session: currentUser.authSession,
  });
  const report = await ctx.runQuery(anyApi.securityReports.getEvidenceReportInternal, {
    id: args.id,
  });
  if (!report) {
    throw new Error('Evidence report not found');
  }

  const exportedAt = Date.now();
  const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditLedgerIntegrityInternal, {});
  const holdDecision =
    report.organizationId === undefined || report.organizationId === null
      ? null
      : ((await ctx.runQuery(anyApi.retention.getOrganizationHoldAwareOperationDecisionInternal, {
          allowExportDuringHold: true,
          operation: 'export',
          organizationId: report.organizationId,
          resourceId: String(report._id),
          resourceType: 'evidence_report_export',
        })) as HoldAwareOperationDecision);
  const exportBundle = stringifyStable({
    contentHash: report.contentHash,
    exportedAt: new Date(exportedAt).toISOString(),
    integritySummary: {
      contentHash: report.contentHash,
      checkedAt: integrityCheck.checkedAt,
      failureCount: integrityCheck.failure ? 1 : 0,
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
    legalHoldActive: holdDecision?.legalHoldActive ?? false,
    legalHoldId: holdDecision?.legalHoldId ?? null,
    legalHoldReason: holdDecision?.normalizedLegalHoldReason ?? null,
    organizationScope: report.organizationId ?? currentUser.activeOrganizationId ?? null,
    retentionScopeVersion: holdDecision?.retentionScopeVersion ?? 'full_phi_record_set_v2',
    reviewStatusAtExport: report.reviewStatus,
    rowCount: 1,
    sourceDataClassification: 'phi_record_set',
    sourceReportId: report._id,
  });
  const manifestJson = stringifyStable(manifest);
  const manifestHash = await hashContent(manifestJson);
  const artifactId = await ctx.runMutation(anyApi.securityPosture.storeExportArtifact, {
    artifactType: 'evidence_report_export',
    exportedAt,
    exportedByUserId: currentUser.authUserId,
    manifestHash,
    manifestJson,
    organizationId: report.organizationId ?? currentUser.activeOrganizationId ?? undefined,
    payloadHash: exportHash,
    schemaVersion: EXPORT_ARTIFACT_SCHEMA_VERSION,
    sourceReportId: args.id,
  });

  await recordSiteAdminAuditEvent(ctx, {
    actorIdentifier: currentUser.authUser.email ?? undefined,
    actorUserId: currentUser.authUserId,
    emitter: 'security.reports',
    eventType: 'evidence_report_exported',
    metadata: stringifyStable({
      exportHash,
      exportId,
      filters: manifest.exactFilters,
      legalHoldActive: holdDecision?.legalHoldActive ?? false,
      legalHoldId: holdDecision?.legalHoldId ?? null,
      legalHoldReason: holdDecision?.normalizedLegalHoldReason ?? null,
      manifestHash,
      rowCount: manifest.rowCount,
      scope: manifest.organizationScope,
    }),
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: report._id,
    resourceLabel: report.reportKind,
    resourceType: 'evidence_report',
    severity: 'info',
    sourceSurface: 'admin.security',
    userId: currentUser.authUserId,
    ...auditRequestContext,
  });

  return {
    createdAt: report.createdAt,
    id: report._id,
    latestExport: {
      exportHash,
      exportedAt,
      exportedByUserId: currentUser.authUserId,
      id: artifactId,
      manifestHash,
    },
    report: exportBundle,
    scopeId: normalizeSecurityScope(report).scopeId,
    scopeType: normalizeSecurityScope(report).scopeType,
    reportKind: report.reportKind,
    reviewStatus: report.reviewStatus,
  };
}

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
    requestContext?: {
      ipAddress?: string | null;
      requestId?: string | null;
      userAgent?: string | null;
    } | null;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const auditRequestContext = resolveAuditRequestContext({
    requestContext: args.requestContext,
    session: currentUser.authSession,
  });
  await ctx.runMutation(anyApi.securityOps.syncCurrentSecurityFindingsInternal, {
    actorUserId: currentUser.authUserId,
  });
  const reportKind = args.reportKind ?? 'security_posture';
  const needsControlWorkspace =
    reportKind === 'security_posture' ||
    reportKind === 'annual_review' ||
    reportKind === 'control_workspace_snapshot';
  const summary = await ctx.runQuery(anyApi.securityPosture.getSecurityPostureSummary, {});
  const controlWorkspace = (
    needsControlWorkspace
      ? await ctx.runQuery(anyApi.securityWorkspace.listControlWorkspaceSnapshotInternal, {})
      : []
  ) as Array<{
    support: 'missing' | 'partial' | 'complete';
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
  const policyWorkspace = (
    reportKind === 'annual_review'
      ? await ctx.runQuery(anyApi.securityPolicies.listSecurityPolicyExportsInternal, {})
      : []
  ) as Array<{
    contentHash: string;
    customerSummary: string | null;
    internalNotes: string | null;
    lastReviewedAt: number | null;
    linkedAnnualReviewTask: {
      id: Id<'reviewTasks'>;
      status: 'ready' | 'completed' | 'exception' | 'blocked';
      title: string;
    } | null;
    mappedControlCount: number;
    mappedControlCountsBySupport: {
      complete: number;
      missing: number;
      partial: number;
    };
    nextReviewAt: number | null;
    owner: string;
    policyId: string;
    sourcePath: string;
    summary: string;
    support: 'missing' | 'partial' | 'complete';
    title: string;
  }>;
  const recentAuditLogs: Array<{
    recordedAt: number;
    eventType: string;
    organizationId?: string;
    outcome?: 'success' | 'failure';
    resourceType?: string;
    sourceSurface?: string;
  }> = await ctx.runQuery(anyApi.audit.getRecentAuditLedgerEventsInternal, {
    limit: 25,
  });
  const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditLedgerIntegrityInternal, {});
  const auditReadinessSnapshot = await ctx.runQuery(
    anyApi.securityPosture.getAuditReadinessSnapshot,
    {},
  );
  const currentOrganizationPolicies = currentUser.activeOrganizationId
    ? await ctx.runQuery(anyApi.organizationManagement.getOrganizationPoliciesInternal, {
        organizationId: currentUser.activeOrganizationId,
      })
    : null;
  const vendorPosture = getVendorBoundarySnapshot();
  const vendorWorkspaces = (
    reportKind === 'vendor_posture_snapshot' || reportKind === 'annual_review'
      ? await ctx.runQuery(anyApi.securityReports.listSecurityVendors, {})
      : []
  ) as Array<{
    approved: boolean;
    approvedByDefault: boolean;
    allowedDataClasses: string[];
    allowedEnvironments: Array<'development' | 'production' | 'test'>;
    approvalEnvVar: string | null;
    title: string;
    linkedEntities: Array<{
      entityId: string;
      entityType: 'control' | 'review_run';
      label: string;
      relationshipType: 'follow_up_for' | 'related_control';
      status: string | null;
    }>;
    linkedAnnualReviewTask: {
      id: Id<'reviewTasks'>;
      status: 'ready' | 'completed' | 'exception' | 'blocked';
      title: string;
    } | null;
    linkedFollowUpRunId: Id<'reviewRuns'> | null;
    owner: string | null;
    relatedControls: Array<{
      internalControlId: string;
      itemId: string | null;
      itemLabel: string | null;
      nist80053Id: string;
      title: string;
    }>;
    reviewStatus: 'current' | 'due_soon' | 'overdue';
    lastReviewedAt: number | null;
    nextReviewAt: number | null;
    scopeId: string;
    scopeType: 'provider_global';
    vendor: 'openrouter' | 'resend' | 'sentry';
    summary: string | null;
  }>;
  const currentFindings = (
    reportKind === 'findings_snapshot' || reportKind === 'annual_review'
      ? await ctx.runQuery(anyApi.securityWorkspace.listSecurityFindings, {})
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
            integrityFailureCount: integrityCheck.failure ? 1 : 0,
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
                dueSoonCount: vendorWorkspaces.filter(
                  (vendor) => vendor.reviewStatus === 'due_soon',
                ).length,
                overdueCount: vendorWorkspaces.filter((vendor) => vendor.reviewStatus === 'overdue')
                  .length,
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
                  completeCount: controlWorkspace.filter(
                    (control) => control.support === 'complete',
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
                  policies: policyWorkspace,
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
                    createdAt: log.recordedAt,
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

  const id = await ctx.runMutation(anyApi.securityPosture.createEvidenceReport, {
    contentJson: report,
    contentHash,
    generatedByUserId: currentUser.authUserId,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reportKind,
  });

  await recordSiteAdminAuditEvent(ctx, {
    actorIdentifier: currentUser.authUser.email ?? undefined,
    actorUserId: currentUser.authUserId,
    emitter: 'security.reports',
    eventType: 'evidence_report_generated',
    metadata: stringifyStable({
      contentHash,
      filters: { reportKind },
    }),
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: id,
    resourceLabel: reportKind,
    resourceType: 'evidence_report',
    severity: 'info',
    sourceSurface: 'admin.security',
    userId: currentUser.authUserId,
    ...auditRequestContext,
  });

  return {
    createdAt,
    id,
    latestExport: null,
    report,
    scopeId: SECURITY_SCOPE_ID,
    scopeType: SECURITY_SCOPE_TYPE,
    reportKind,
    reviewStatus: 'pending' as const,
  };
}

export async function refreshReviewRunAutomationHandler(
  ctx: ActionCtx,
  args: {
    reviewRunId: Id<'reviewRuns'>;
  },
) {
  await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const detail = (await ctx.runQuery(anyApi.securityReviews.getReviewRunDetail, {
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

  const auditReadiness = await ctx.runQuery(anyApi.securityPosture.getAuditReadinessOverview, {});

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
      await ctx.runMutation(anyApi.securityReviews.replaceReviewTaskEvidenceLinksInternal, {
        reviewTaskId: task.id,
        sourceTypes: ['evidence_report'],
      });
      await ctx.runMutation(anyApi.securityReviews.upsertReviewTaskEvidenceLinkInternal, {
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
      await ctx.runMutation(anyApi.securityReviews.applyReviewTaskStateInternal, {
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
      await ctx.runMutation(anyApi.securityReviews.replaceReviewTaskEvidenceLinksInternal, {
        reviewTaskId: task.id,
        sourceTypes: ['backup_verification_report'],
      });
      if (!latestBackupDrill) {
        await ctx.runMutation(anyApi.securityReviews.applyReviewTaskStateInternal, {
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

      await ctx.runMutation(anyApi.securityReviews.upsertReviewTaskEvidenceLinkInternal, {
        freshAt: latestBackupDrill.checkedAt,
        reviewRunId: detail.id,
        reviewTaskId: task.id,
        role: 'primary',
        sourceId: latestBackupDrill.drillId,
        sourceLabel: getAutomationEvidenceLabel(blueprint),
        sourceType: 'backup_verification_report',
      });
      await ctx.runMutation(anyApi.securityReviews.applyReviewTaskStateInternal, {
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
      await ctx.runMutation(anyApi.securityReviews.replaceReviewTaskEvidenceLinksInternal, {
        reviewTaskId: task.id,
        sourceTypes: ['security_control_evidence'],
      });
      const latestEvidence = (await ctx.runQuery(
        anyApi.securityWorkspace.getLatestReleaseProvenanceEvidenceInternal,
        {},
      )) as {
        createdAt: number;
        id: string;
        reviewedAt: number | null;
        sufficiency: 'missing' | 'partial' | 'sufficient';
        title: string;
      } | null;

      if (!latestEvidence) {
        await ctx.runMutation(anyApi.securityReviews.applyReviewTaskStateInternal, {
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

      await ctx.runMutation(anyApi.securityReviews.upsertReviewTaskEvidenceLinkInternal, {
        freshAt: latestEvidence.reviewedAt ?? latestEvidence.createdAt,
        reviewRunId: detail.id,
        reviewTaskId: task.id,
        role: latestEvidence.sufficiency === 'sufficient' ? 'primary' : 'blocking',
        sourceId: latestEvidence.id,
        sourceLabel: latestEvidence.title,
        sourceType: 'security_control_evidence',
      });
      await ctx.runMutation(anyApi.securityReviews.applyReviewTaskStateInternal, {
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

  return await ctx.runQuery(anyApi.securityReviews.getReviewRunDetail, {
    reviewRunId: args.reviewRunId,
  });
}

export async function finalizeReviewRunHandler(
  ctx: ActionCtx,
  args: {
    reviewRunId: Id<'reviewRuns'>;
    requestContext?: {
      ipAddress?: string | null;
      requestId?: string | null;
      userAgent?: string | null;
    } | null;
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  const auditRequestContext = resolveAuditRequestContext({
    requestContext: args.requestContext,
    session: currentUser.authSession,
  });
  const detail = (await ctx.runQuery(anyApi.securityReviews.getReviewRunDetail, {
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
          | 'vendor';
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
    const report = await ctx.runQuery(anyApi.securityReports.getEvidenceReportInternal, {
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
  const reportId = await ctx.runMutation(anyApi.securityPosture.createEvidenceReport, {
    contentJson: reportPayload,
    contentHash: await hashContent(reportPayload),
    generatedByUserId: currentUser.authUserId,
    organizationId: currentUser.activeOrganizationId ?? undefined,
    reportKind: 'annual_review',
  });
  await exportEvidenceReportHandler(ctx, {
    id: reportId,
    requestContext: args.requestContext,
  });
  await ctx.runMutation(anyApi.securityReviews.storeReviewRunFinalization, {
    finalReportId: reportId,
    finalizedAt: createdAt,
    finalizedByUserId: currentUser.authUserId,
    reviewRunId: args.reviewRunId,
  });

  await recordSiteAdminAuditEvent(ctx, {
    actorIdentifier: currentUser.authUser.email ?? undefined,
    actorUserId: currentUser.authUserId,
    emitter: 'security.reports',
    eventType: 'security_review_run_finalized' as never,
    metadata: stringifyStable({
      finalReportId: reportId,
      reviewRunId: args.reviewRunId,
    }),
    organizationId: currentUser.activeOrganizationId ?? undefined,
    outcome: 'success',
    resourceId: args.reviewRunId,
    resourceLabel: detail.title,
    resourceType: 'review_run',
    severity: 'info',
    sourceSurface: REVIEW_RUN_SOURCE_SURFACE,
    userId: currentUser.authUserId,
    ...auditRequestContext,
  });

  return await ctx.runQuery(anyApi.securityReviews.getReviewRunDetail, {
    reviewRunId: args.reviewRunId,
  });
}
