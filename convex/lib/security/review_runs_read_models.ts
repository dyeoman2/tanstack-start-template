import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { listSecurityPolicyGovernanceContexts } from './governance_context';
import type { ReviewTaskBlueprint } from './securityReviewConfig';
import {
  getLatestEvidenceReportExportForReport,
  normalizeSecurityScope,
  resolveControlLinkMetadata,
} from './core';
import {
  buildActorDisplayMap,
  buildCurrentSecurityFindings,
  getActorDisplayName,
  listReviewTaskEvidenceLinksBySource,
} from './operations_core';
import {
  buildReviewRunTaskCounts,
  deriveReviewRunStatus,
  listReviewTasksByRunId,
  type ReviewRunDoc,
  type ReviewTaskDoc,
} from './review_runs_task_sync';
import { buildVendorWorkspaceRows } from './review_runs_migrations';

export function getAutomationEvidenceLabel(blueprint: ReviewTaskBlueprint) {
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

export async function buildReviewRunSummary(ctx: QueryCtx, run: ReviewRunDoc) {
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

export async function buildReviewRunDetail(ctx: QueryCtx, reviewRunId: Id<'reviewRuns'>) {
  const run = await ctx.db.get(reviewRunId);
  if (!run) {
    return null;
  }

  const [
    tasks,
    evidenceLinks,
    attestations,
    policyGovernanceContexts,
    vendorWorkspaces,
    currentFindings,
    storedFindings,
  ] = await Promise.all([
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
    run.kind === 'annual' ? buildVendorWorkspaceRows(ctx) : Promise.resolve([]),
    run.kind === 'annual' ? buildCurrentSecurityFindings(ctx) : Promise.resolve([]),
    run.kind === 'annual' ? ctx.db.query('securityFindings').collect() : Promise.resolve([]),
  ]);
  const policyGovernanceContextById = new Map(
    policyGovernanceContexts.map((entry) => [entry.policy.policyId, entry] as const),
  );
  const vendorWorkspaceByKey = new Map(
    vendorWorkspaces.map((entry) => [entry.vendor, entry] as const),
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
  const buildReviewTaskVendorSummary = (task: ReviewTaskDoc) => {
    if (!task.vendorKey) {
      return null;
    }
    const vendor = vendorWorkspaceByKey.get(task.vendorKey as 'openrouter' | 'resend' | 'sentry');
    if (!vendor) {
      return null;
    }
    return {
      reviewStatus: vendor.reviewStatus,
      title: vendor.title,
      vendorKey: vendor.vendor,
    };
  };
  const findingsSummary = (() => {
    const storedFindingByKey = new Map(
      storedFindings.map((finding) => [finding.findingKey, finding] as const),
    );
    const openFindings = currentFindings.filter((finding) => finding.status === 'open');
    const criticalOpenCount = openFindings.filter(
      (finding) => finding.severity === 'critical',
    ).length;
    const undispositionedCount = openFindings.filter((finding) => {
      const disposition =
        storedFindingByKey.get(finding.findingKey)?.disposition ?? 'pending_review';
      return disposition === 'pending_review' || disposition === 'investigating';
    }).length;
    return {
      criticalOpenCount,
      lowerSeverityOpenCount: Math.max(0, openFindings.length - criticalOpenCount),
      totalOpenCount: openFindings.length,
      undispositionedCount,
    };
  })();

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
        vendor: buildReviewTaskVendorSummary(task),
        findingsSummary:
          task.templateKey === 'annual:attest:findings-review' ? findingsSummary : null,
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

export async function buildEvidenceReportDetail(ctx: QueryCtx, reportId: Id<'evidenceReports'>) {
  const report = await ctx.db.get(reportId);
  if (!report) {
    return null;
  }
  const latestExport = await getLatestEvidenceReportExportForReport(ctx, reportId);

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
    generatedByUserId: report.generatedByUserId,
    id: report._id,
    latestExport,
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
