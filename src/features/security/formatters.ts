import type {
  EvidenceReviewDueIntervalMonths,
  ReviewRunDetail,
  ReviewRunSummary,
  ReviewTaskDetail,
  ReviewTaskEvidenceLink,
  SecurityChecklistEvidence,
  SecurityChecklistEvidenceActivity,
  SecurityChecklistItem,
  SecurityPolicySummary,
  SecurityControlWorkspace,
  SecurityControlWorkspaceExport,
  SecurityControlWorkspaceSummary,
  SecurityFindingListItem,
  StoredEvidenceSource,
  VendorWorkspace,
} from '~/features/security/types';
import {
  type ControlResponsibility,
  getControlResponsibilityDisplayLabel,
} from '~/lib/shared/compliance/control-register';

function countReviewTasksByStatus(tasks: ReviewRunDetail['tasks']) {
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

export function mergeReviewRunSummaryWithDetail(
  summary: ReviewRunSummary | null,
  detail: ReviewRunDetail,
): ReviewRunSummary {
  return {
    createdAt: detail.createdAt,
    finalizedAt: detail.finalizedAt,
    id: detail.id,
    kind: detail.kind,
    scopeId: detail.scopeId,
    scopeType: detail.scopeType,
    status: detail.status,
    taskCounts: countReviewTasksByStatus(detail.tasks),
    title: detail.title,
    triggerType: detail.triggerType,
    year: detail.year,
    ...(summary
      ? {
          createdAt: summary.createdAt,
          finalizedAt: detail.finalizedAt ?? summary.finalizedAt,
          triggerType: summary.triggerType,
          year: summary.year,
        }
      : {}),
  };
}

export function formatHipaaMapping(mapping: SecurityControlWorkspace['mappings']['hipaa'][number]) {
  const description = mapping.text ?? mapping.title;
  return `${mapping.citation}${description ? ` · ${description}` : ''}`;
}

export function formatControlResponsibility(responsibility: ControlResponsibility | null) {
  return getControlResponsibilityDisplayLabel(responsibility);
}

export function getResponsibilityBadgeVariant(
  responsibility: ControlResponsibility | null,
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (responsibility) {
    case 'platform':
      return 'default';
    case 'shared-responsibility':
      return 'secondary';
    case 'customer':
      return 'destructive';
    case null:
      return 'outline';
  }
}

export function getSupportBadgeVariant(
  support: SecurityControlWorkspace['support'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (support) {
    case 'complete':
      return 'default';
    case 'partial':
      return 'outline';
    case 'missing':
      return 'destructive';
  }
}

export function getChecklistStatusBadgeVariant(
  status: SecurityChecklistItem['support'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'complete':
      return 'default';
    case 'partial':
      return 'secondary';
    case 'missing':
      return 'destructive';
  }
}

export function formatSupportStatus(support: SecurityControlWorkspace['support']) {
  switch (support) {
    case 'complete':
      return 'Complete';
    case 'partial':
      return 'Partial';
    case 'missing':
      return 'Missing';
  }
}

export function formatPolicySupportProgress(policy: SecurityPolicySummary) {
  return `${policy.mappedControlCountsBySupport.complete}/${policy.mappedControlCount}`;
}

export function getFindingSeverityBadgeVariant(
  severity: SecurityFindingListItem['severity'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (severity) {
    case 'critical':
      return 'destructive';
    case 'warning':
      return 'secondary';
    case 'info':
      return 'outline';
  }
}

export function formatFindingSeverity(severity: SecurityFindingListItem['severity']) {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'warning':
      return 'Warning';
    case 'info':
      return 'Info';
  }
}

export function formatFindingStatus(status: SecurityFindingListItem['status']) {
  switch (status) {
    case 'open':
      return 'Open';
    case 'resolved':
      return 'Resolved';
  }
}

export function getReviewRunStatusBadgeVariant(
  status: ReviewRunSummary['status'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'needs_attention':
      return 'destructive';
    case 'ready':
      return 'secondary';
  }
}

export function formatReviewRunStatus(status: ReviewRunSummary['status']) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'needs_attention':
      return 'Needs attention';
    case 'ready':
      return 'Ready';
  }
}

export function formatReviewTaskStatus(status: ReviewTaskDetail['status']) {
  switch (status) {
    case 'blocked':
      return 'Blocked';
    case 'completed':
      return 'Completed';
    case 'exception':
      return 'Exception';
    case 'ready':
      return 'Ready';
  }
}

export function getReviewTaskBadgeVariant(
  task: ReviewTaskDetail,
): 'default' | 'destructive' | 'outline' | 'secondary' {
  if (task.status === 'blocked' || task.status === 'exception') {
    return 'destructive';
  }
  if (task.status === 'completed') {
    return 'default';
  }
  if (task.taskType === 'automated_check') {
    return 'secondary';
  }
  return 'outline';
}

export function getReviewTaskStatusLabel(task: ReviewTaskDetail) {
  if (task.status === 'blocked') {
    return 'Blocked';
  }
  if (task.status === 'exception') {
    return 'Exception';
  }
  if (task.status === 'completed') {
    switch (task.taskType) {
      case 'automated_check':
        return 'Satisfied';
      case 'attestation':
        return 'Attested';
      case 'document_upload':
        return 'Document linked';
      case 'follow_up':
        return 'Follow-up opened';
    }
  }

  switch (task.taskType) {
    case 'automated_check':
      return 'Auto-collected';
    case 'attestation':
      return 'Needs attestation';
    case 'document_upload':
      return 'Needs document';
    case 'follow_up':
      return 'Needs follow-up';
  }
}

export function formatReviewTaskEvidenceSourceType(
  sourceType: ReviewTaskEvidenceLink['sourceType'],
) {
  switch (sourceType) {
    case 'backup_verification_report':
      return 'Backup verification evidence';
    case 'evidence_report':
      return 'Evidence report';
    case 'external_document':
      return 'Linked document';
    case 'review_task':
      return 'Review task';
    case 'security_control_evidence':
      return 'Control evidence';
    case 'security_finding':
      return 'Security finding';
    case 'vendor':
      return 'Vendor';
  }
}

export function getEvidenceProgress(
  control:
    | SecurityControlWorkspace
    | SecurityControlWorkspaceExport
    | SecurityControlWorkspaceSummary,
) {
  if ('checklistStats' in control) {
    return {
      completeCount: control.checklistStats.completeCount,
      label: `${control.checklistStats.completeCount}/${control.checklistStats.totalCount}`,
      requiredCount: control.checklistStats.totalCount,
    };
  }

  const checklistItems = control.platformChecklist;
  const completeItems = checklistItems.filter((item) => item.support === 'complete');

  return {
    completeCount: completeItems.length,
    label: `${completeItems.length}/${checklistItems.length}`,
    requiredCount: checklistItems.length,
  };
}

export function formatChecklistStatus(status: SecurityChecklistItem['support']) {
  switch (status) {
    case 'complete':
      return 'Completed';
    case 'partial':
      return 'Partial';
    case 'missing':
      return 'Missing';
  }
}

export function getEvidenceReviewBadgeVariant(
  reviewStatus: SecurityChecklistEvidence['reviewStatus'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (reviewStatus) {
    case 'reviewed':
      return 'default';
    case 'pending':
      return 'outline';
  }
}

export function getEvidenceLifecycleBadgeVariant(
  lifecycleStatus: SecurityChecklistEvidence['lifecycleStatus'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (lifecycleStatus) {
    case 'active':
      return 'outline';
    case 'archived':
      return 'secondary';
    case 'superseded':
      return 'outline';
  }
}

export function formatEvidenceReviewStatus(
  reviewStatus: SecurityChecklistEvidence['reviewStatus'],
) {
  switch (reviewStatus) {
    case 'reviewed':
      return 'Reviewed';
    case 'pending':
      return 'Pending review';
  }
}

export function getEvidenceSufficiencyBadgeVariant(
  sufficiency: SecurityChecklistEvidence['sufficiency'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (sufficiency) {
    case 'sufficient':
      return 'default';
    case 'partial':
      return 'secondary';
    case 'missing':
      return 'destructive';
  }
}

export function formatEvidenceSufficiency(sufficiency: SecurityChecklistEvidence['sufficiency']) {
  switch (sufficiency) {
    case 'sufficient':
      return 'Sufficient';
    case 'partial':
      return 'Partial';
    case 'missing':
      return 'Missing';
  }
}

export function formatEvidenceActivityEvent(
  eventType: SecurityChecklistEvidenceActivity['eventType'],
) {
  switch (eventType) {
    case 'security_control_evidence_created':
      return 'Added';
    case 'security_control_evidence_reviewed':
      return 'Approved';
    case 'security_control_evidence_archived':
      return 'Archived';
    case 'security_control_evidence_renewed':
      return 'Renewed';
  }
}

type VendorBadgeVariant = 'default' | 'destructive' | 'outline' | 'secondary';

export function getVendorPrimaryStatus(vendor: Pick<VendorWorkspace, 'approved'>): {
  label: 'Approved' | 'Blocked';
  variant: VendorBadgeVariant;
} {
  return vendor.approved
    ? { label: 'Approved', variant: 'default' }
    : { label: 'Blocked', variant: 'destructive' };
}

export function getVendorGovernanceState(args: {
  controlCount: number;
  hasDraftReview: boolean;
  owner: string;
  reviewStatus: VendorWorkspace['reviewStatus'];
}): {
  label:
    | 'Current review'
    | 'Draft review'
    | 'Missing controls'
    | 'Review due soon'
    | 'Review overdue'
    | 'Unassigned';
  variant: VendorBadgeVariant;
} {
  if (args.hasDraftReview) {
    return { label: 'Draft review', variant: 'outline' };
  }

  if (args.reviewStatus === 'overdue') {
    return { label: 'Review overdue', variant: 'destructive' };
  }

  if (args.owner.trim().length === 0) {
    return { label: 'Unassigned', variant: 'destructive' };
  }

  if (args.controlCount === 0) {
    return { label: 'Missing controls', variant: 'destructive' };
  }

  if (args.reviewStatus === 'due_soon') {
    return { label: 'Review due soon', variant: 'outline' };
  }

  return { label: 'Current review', variant: 'secondary' };
}

function formatVendorApprovalReason(
  vendor: Pick<
    VendorWorkspace,
    'allowedEnvironments' | 'approvalEnvVar' | 'approved' | 'approvedByDefault'
  >,
) {
  const environmentCount = vendor.allowedEnvironments.length;
  const environmentScope =
    environmentCount > 0
      ? `${environmentCount} configured environment${environmentCount === 1 ? '' : 's'}`
      : 'configured use';

  if (vendor.approved) {
    if (vendor.approvedByDefault) {
      return `Approved for ${environmentScope}`;
    }

    if (vendor.approvalEnvVar) {
      return `Approved because ${vendor.approvalEnvVar} is enabled`;
    }

    return 'Approved because required configuration is present';
  }

  if (vendor.approvalEnvVar) {
    return `Blocked because ${vendor.approvalEnvVar} is not enabled`;
  }

  return 'Blocked until required configuration is present';
}

export function formatVendorRuntimePosture(
  vendor: Pick<
    VendorWorkspace,
    | 'allowedDataClasses'
    | 'allowedEnvironments'
    | 'approvalEnvVar'
    | 'approved'
    | 'approvedByDefault'
  >,
) {
  return {
    dataClasses:
      vendor.allowedDataClasses.length > 0
        ? vendor.allowedDataClasses.join(', ')
        : 'No data classes recorded',
    decision: formatVendorApprovalReason(vendor),
    environments:
      vendor.allowedEnvironments.length > 0
        ? vendor.allowedEnvironments.join(', ')
        : 'No environments recorded',
  };
}

export function formatVendorDecisionSummary(args: {
  controlCount: number;
  hasDraftReview: boolean;
  lastReviewedAt: number | null;
  owner: string;
  reviewStatus: VendorWorkspace['reviewStatus'];
  vendor: Pick<
    VendorWorkspace,
    'allowedEnvironments' | 'approvalEnvVar' | 'approved' | 'approvedByDefault'
  >;
}) {
  const summaryLead = formatVendorApprovalReason(args.vendor);
  const governanceGaps: string[] = [];

  if (args.owner.trim().length === 0) {
    governanceGaps.push('no owner is assigned');
  }

  if (args.controlCount === 0) {
    governanceGaps.push('no controls are linked');
  }

  if (args.hasDraftReview) {
    governanceGaps.push('a draft review is in progress');
  } else if (args.lastReviewedAt === null) {
    governanceGaps.push('no completed review is recorded');
  } else if (args.reviewStatus === 'overdue') {
    governanceGaps.push('the governance review is overdue');
  } else if (args.reviewStatus === 'due_soon') {
    governanceGaps.push('the next review is due soon');
  }

  if (governanceGaps.length === 0) {
    return `${summaryLead}.`;
  }

  return `${summaryLead}, but ${governanceGaps.join(', ')}.`;
}

export function getVendorPrimaryActionLabel(args: {
  controlCount: number;
  hasDraftReview: boolean;
  owner: string;
}) {
  if (args.hasDraftReview) {
    return 'Save changes';
  }

  if (args.owner.trim().length === 0 || args.controlCount === 0) {
    return 'Resolve governance gaps';
  }

  return 'Review now';
}

export function formatEvidenceLifecycleStatus(
  lifecycleStatus: SecurityChecklistEvidence['lifecycleStatus'],
) {
  switch (lifecycleStatus) {
    case 'active':
      return 'Active';
    case 'archived':
      return 'Archived';
    case 'superseded':
      return 'Superseded';
  }
}

export function getTodayDateInputValue() {
  const date = new Date();
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function parseEvidenceDateInput(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function formatEvidenceDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

export function formatEvidenceReviewDueInterval(interval: EvidenceReviewDueIntervalMonths) {
  switch (interval) {
    case 3:
      return '3 months';
    case 6:
      return '6 months';
    case 12:
      return '1 year';
  }
}

export function formatEvidenceSource(source: StoredEvidenceSource) {
  switch (source) {
    case 'manual_upload':
      return 'Manual upload';
    case 'internal_review':
      return 'Internal review';
    case 'automated_system_check':
      return 'Automated system check';
    case 'external_report':
      return 'External report';
    case 'vendor_attestation':
      return 'Vendor attestation';
    case 'review_attestation':
      return 'Review attestation';
    case 'review_document':
      return 'Review document';
    case 'automated_review_result':
      return 'Automated review result';
    case 'follow_up_resolution':
      return 'Follow-up resolution';
    case 'review_exception':
      return 'Accepted exception';
  }
}

export function formatEvidenceTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}
