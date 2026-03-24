import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import {
  createSortableHeader,
  DataTable,
  formatTableDate,
  TableFilter,
  type TableFilterOption,
  TableSearch,
} from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { ExportButton } from '~/components/ui/export-button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Spinner } from '~/components/ui/spinner';
import { Textarea } from '~/components/ui/textarea';
import { AdminSecurityReviewTaskGroup } from '~/features/security/components/AdminSecurityReviewTaskGroup';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatVendorDecisionSummary,
  formatPolicySupportProgress,
  formatVendorRuntimePosture,
  formatReviewRunStatus,
  formatReviewTaskEvidenceSourceType,
  formatReviewTaskStatus,
  formatSupportStatus,
  getReviewRunStatusBadgeVariant,
  getSupportBadgeVariant,
  getVendorGovernanceState,
  getVendorPrimaryActionLabel,
  getVendorPrimaryStatus,
} from '~/features/security/formatters';
import type {
  ReviewRunSummary,
  ReviewTaskDetail,
  SecurityPolicySummary,
  SecurityControlWorkspaceSummary,
  SecurityPostureSummary,
  VendorWorkspace,
} from '~/features/security/types';
import { ACTIVE_CONTROL_REGISTER } from '~/lib/shared/compliance/control-register';

type ControlSummary = {
  bySupport: {
    missing: number;
    partial: number;
    complete: number;
  };
  byResponsibility: {
    customer: number;
    platform: number;
    sharedResponsibility: number;
  };
  totalControls: number;
};

type ReviewFinalizeState = {
  canFinalize: boolean;
  requiredBlocked: ReviewTaskDetail[];
  requiredRemaining: ReviewTaskDetail[];
  remainingByType: {
    attestation: number;
    automated_check: number;
    document_upload: number;
    follow_up: number;
  };
};

type ReviewTaskGroups = {
  autoCollected: ReviewTaskDetail[];
  needsAttestation: ReviewTaskDetail[];
  needsDocumentUpload: ReviewTaskDetail[];
  findingsReview: ReviewTaskDetail[];
  vendorReviews: ReviewTaskDetail[];
  blocked: ReviewTaskDetail[];
};

type AutoCollectedEvidenceLink = {
  link: {
    freshAt: number | null;
    id: string;
    linkedAt: number;
    sourceLabel: string;
    sourceType:
      | 'security_control_evidence'
      | 'evidence_report'
      | 'security_finding'
      | 'backup_verification_report'
      | 'external_document'
      | 'review_task'
      | 'vendor';
  };
  taskTitle: string;
};

type PolicyTableSortField = 'title' | 'support' | 'owner' | 'mappedControlCount' | 'nextReviewAt';

export function AdminSecurityOverviewTab(props: {
  controlSummary: ControlSummary | undefined;
  summary: SecurityPostureSummary | undefined;
}) {
  const loadingValue = (
    <>
      <Spinner className="size-5" />
      <span className="sr-only">Loading</span>
    </>
  );

  return (
    <>
      <AdminSecurityTabHeader
        title="Overview"
        description="Program-wide posture across authentication, audit integrity, inspection pipelines, retention jobs, telemetry, and session policy."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <AdminSecuritySummaryCard
          title="MFA Coverage"
          description="Phishing-resistant MFA coverage across Better Auth users, including passkeys."
          value={
            props.summary
              ? `${props.summary.auth.mfaCoveragePercent}% (${props.summary.auth.mfaEnabledUsers}/${props.summary.auth.totalUsers})`
              : loadingValue
          }
          footer={
            props.summary
              ? `${props.summary.auth.passkeyEnabledUsers} users have passkeys; verified email is always required`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="File Inspection"
          description="Attachment and document inspection outcomes from the built-in inspection pipeline."
          value={
            props.summary
              ? `${props.summary.scanner.totalScans} inspected, ${props.summary.scanner.quarantinedCount} quarantined, ${props.summary.scanner.rejectedCount} rejected`
              : loadingValue
          }
          footer={
            props.summary?.scanner.lastScanAt
              ? `Last inspection ${new Date(props.summary.scanner.lastScanAt).toLocaleString()}`
              : 'No inspection events recorded yet'
          }
        />
        <AdminSecuritySummaryCard
          title="Audit Integrity"
          description="Hash-chain failure signal from the audit subsystem."
          value={
            props.summary
              ? `${props.summary.audit.integrityFailures} integrity failures`
              : loadingValue
          }
          footer={
            props.summary?.audit.lastEventAt
              ? `Last audit event ${new Date(props.summary.audit.lastEventAt).toLocaleString()}`
              : 'No audit activity yet'
          }
        />
        <AdminSecuritySummaryCard
          title="Retention Jobs"
          description="Latest retention or cleanup execution status."
          value={
            props.summary?.retention.lastJobStatus
              ? props.summary.retention.lastJobStatus
              : 'No retention job recorded'
          }
          footer={
            props.summary?.retention.lastJobAt
              ? `Last run ${new Date(props.summary.retention.lastJobAt).toLocaleString()}`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Telemetry"
          description="External telemetry posture for the regulated baseline."
          value={
            props.summary
              ? props.summary.telemetry.sentryApproved
                ? 'Sentry approved'
                : 'Sentry blocked by default'
              : loadingValue
          }
          footer={
            props.summary
              ? props.summary.telemetry.sentryEnabled
                ? 'Telemetry sink configured with explicit approval'
                : 'No approved telemetry sink active'
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Session Policy"
          description="Short-lived verification posture applied across the app."
          value={
            props.summary
              ? `${props.summary.sessions.freshWindowMinutes} minute step-up window`
              : loadingValue
          }
          footer={
            props.summary
              ? `${props.summary.sessions.sessionExpiryHours}h sessions, ${props.summary.sessions.temporaryLinkTtlMinutes} minute temporary links`
              : undefined
          }
        />
      </div>

      <SecurityControlSummaryGrid controlSummary={props.controlSummary} />
    </>
  );
}

export function AdminSecurityPoliciesTab(props: {
  busySync: boolean;
  onOpenPolicy: (policyId: string) => void;
  onSyncPolicies: () => Promise<void>;
  policies: SecurityPolicySummary[] | undefined;
  searchTerm: string;
  sortBy: PolicyTableSortField;
  sortOrder: 'asc' | 'desc';
  supportFilter: 'all' | SecurityPolicySummary['support'];
  updatePolicySearch: (updates: {
    policySearch?: string;
    policySortBy?: PolicyTableSortField;
    policySortOrder?: 'asc' | 'desc';
    policySupport?: 'all' | SecurityPolicySummary['support'];
    selectedPolicy?: string | undefined;
  }) => void;
}) {
  const {
    busySync,
    onOpenPolicy,
    onSyncPolicies,
    policies: policyInput,
    searchTerm,
    sortBy,
    sortOrder,
    supportFilter,
    updatePolicySearch,
  } = props;
  const policies = useMemo(() => policyInput ?? [], [policyInput]);
  const counts = policies.reduce(
    (summary, policy) => {
      summary[policy.support] += 1;
      return summary;
    },
    {
      complete: 0,
      missing: 0,
      partial: 0,
    },
  );
  const supportOptions = useMemo<
    Array<TableFilterOption<'all' | SecurityPolicySummary['support']>>
  >(
    () => [
      { label: 'All support', value: 'all' },
      { label: 'Complete', value: 'complete' },
      { label: 'Partial', value: 'partial' },
      { label: 'Missing', value: 'missing' },
    ],
    [],
  );
  const filteredPolicies = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return policies.filter((policy) => {
      if (supportFilter !== 'all' && policy.support !== supportFilter) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      return [
        policy.title,
        policy.summary,
        policy.owner,
        policy.sourcePath,
        policy.linkedAnnualReviewTask?.title ?? '',
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [policies, searchTerm, supportFilter]);
  const sortedPolicies = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sorted = [...filteredPolicies];

    sorted.sort((left, right) => {
      let result = 0;

      switch (sortBy) {
        case 'title':
          result = collator.compare(left.title, right.title);
          break;
        case 'support':
          result = collator.compare(left.support, right.support);
          break;
        case 'owner':
          result = collator.compare(left.owner, right.owner);
          break;
        case 'mappedControlCount':
          result = left.mappedControlCount - right.mappedControlCount;
          break;
        case 'nextReviewAt': {
          const leftTime = left.nextReviewAt ?? Number.MAX_SAFE_INTEGER;
          const rightTime = right.nextReviewAt ?? Number.MAX_SAFE_INTEGER;
          result = leftTime - rightTime;
          break;
        }
      }

      return sortOrder === 'asc' ? result : -result;
    });

    return sorted;
  }, [filteredPolicies, sortBy, sortOrder]);
  const totalPolicies = sortedPolicies.length;
  const policySearchParams = useMemo(
    () => ({
      page: 1,
      pageSize: totalPolicies || policies.length || 1,
      sortBy,
      sortOrder,
    }),
    [policies.length, sortBy, sortOrder, totalPolicies],
  );
  const handlePolicySorting = useCallback(
    (columnId: PolicyTableSortField) => {
      updatePolicySearch({
        policySortBy: columnId,
        policySortOrder: sortBy === columnId ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc',
      });
    },
    [sortBy, sortOrder, updatePolicySearch],
  );
  const policyColumns = useMemo<ColumnDef<SecurityPolicySummary, unknown>[]>(
    () => [
      {
        accessorKey: 'title',
        header: createSortableHeader('Policy', 'title', policySearchParams, handlePolicySorting),
        cell: ({ row }) => <p className="py-1 font-medium">{row.original.title}</p>,
      },
      {
        accessorKey: 'support',
        header: createSortableHeader('Support', 'support', policySearchParams, handlePolicySorting),
        cell: ({ row }) => {
          const policy = row.original;

          return (
            <div className="py-1">
              <Badge variant={getSupportBadgeVariant(policy.support)}>
                {formatSupportStatus(policy.support)} {formatPolicySupportProgress(policy)}
              </Badge>
            </div>
          );
        },
      },
      {
        accessorKey: 'owner',
        header: createSortableHeader('Owner', 'owner', policySearchParams, handlePolicySorting),
        cell: ({ row }) => <p className="py-1 text-sm font-medium">{row.original.owner}</p>,
      },
      {
        accessorKey: 'nextReviewAt',
        header: createSortableHeader(
          'Next Review Date',
          'nextReviewAt',
          policySearchParams,
          handlePolicySorting,
        ),
        cell: ({ row }) => {
          const policy = row.original;

          return (
            <p className="py-1 text-sm font-medium">
              {policy.nextReviewAt ? formatTableDate(policy.nextReviewAt) : 'Unscheduled'}
            </p>
          );
        },
      },
    ],
    [handlePolicySorting, policySearchParams],
  );

  return (
    <>
      <AdminSecurityTabHeader
        title="Policies"
        description="Governance layer backed by repo markdown, mapped controls, and annual policy attestations."
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={busySync}
            onClick={() => {
              void onSyncPolicies();
            }}
          >
            {busySync ? 'Syncing…' : 'Sync policy catalog'}
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <AdminSecuritySummaryCard
          title="Policy Support"
          description="Policies fully supported by mapped controls."
          value={`${counts.complete}`}
          footer={`${policies.length} total policies`}
        />
        <AdminSecuritySummaryCard
          title="Partial Policies"
          description="Policies with mixed mapped-control support."
          value={`${counts.partial}`}
          footer="Review these before annual attestation"
        />
        <AdminSecuritySummaryCard
          title="Missing Policies"
          description="Policies with no currently complete mapped-control support."
          value={`${counts.missing}`}
          footer="These need control remediation or refreshed evidence"
        />
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
          <p className="text-sm text-muted-foreground whitespace-nowrap">{totalPolicies} matches</p>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter<'all' | SecurityPolicySummary['support']>
              value={supportFilter}
              options={supportOptions}
              onValueChange={(value) => {
                updatePolicySearch({ policySupport: value });
              }}
              className="shrink-0"
              ariaLabel="Filter policies by support"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
          <TableSearch
            initialValue={searchTerm}
            onSearch={(value) => {
              updatePolicySearch({ policySearch: value });
            }}
            placeholder="Search by policy, summary, owner, or source path"
            isSearching={false}
            className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
            ariaLabel="Search policies"
          />
        </div>
      </div>

      <DataTable<SecurityPolicySummary, ColumnDef<SecurityPolicySummary, unknown>>
        data={sortedPolicies}
        columns={policyColumns}
        searchParams={policySearchParams}
        isLoading={policyInput === undefined}
        onRowClick={(policy) => {
          onOpenPolicy(policy.policyId);
        }}
        emptyMessage="No policies matched the current filters."
      />
    </>
  );
}

export function AdminSecurityControlsTab(props: {
  controlColumns: ColumnDef<SecurityControlWorkspaceSummary, unknown>[];
  controlSearchParams: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
  controlSearchTerm: string;
  controlSummary: ControlSummary | undefined;
  supportFilter: 'all' | SecurityControlWorkspaceSummary['support'];
  supportOptions: Array<TableFilterOption<'all' | SecurityControlWorkspaceSummary['support']>>;
  familyFilter: string;
  familyOptions: TableFilterOption<string>[];
  isExportingControls: boolean;
  responsibilityFilter: 'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>;
  responsibilityOptions: Array<
    TableFilterOption<'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>>
  >;
  sortedControls: SecurityControlWorkspaceSummary[];
  handleExportControls: () => Promise<void>;
  updateControlSearch: (updates: {
    sortBy?: 'control' | 'support' | 'responsibility' | 'family';
    sortOrder?: 'asc' | 'desc';
    search?: string;
    responsibility?: 'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>;
    support?: 'all' | SecurityControlWorkspaceSummary['support'];
    family?: string;
    selectedControl?: string | undefined;
  }) => void;
}) {
  return (
    <>
      <AdminSecurityTabHeader
        title="Control Register"
        description="Active control register with evidence, responsibility, and framework mapping detail."
      />
      <SecurityControlSummaryGrid controlSummary={props.controlSummary} />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {props.sortedControls.length} matches
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter<string>
              value={props.familyFilter}
              options={props.familyOptions}
              onValueChange={(value) => {
                props.updateControlSearch({ family: value });
              }}
              className="shrink-0"
              ariaLabel="Filter controls by family"
            />
            <TableFilter<'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>>
              value={props.responsibilityFilter}
              options={props.responsibilityOptions}
              onValueChange={(value) => {
                props.updateControlSearch({ responsibility: value });
              }}
              className="shrink-0"
              ariaLabel="Filter controls by responsibility"
            />
            <TableFilter<'all' | SecurityControlWorkspaceSummary['support']>
              value={props.supportFilter}
              options={props.supportOptions}
              onValueChange={(value) => {
                props.updateControlSearch({
                  support: value,
                });
              }}
              className="shrink-0"
              ariaLabel="Filter controls by support"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
          <TableSearch
            initialValue={props.controlSearchTerm}
            onSearch={(value) => {
              props.updateControlSearch({ search: value });
            }}
            placeholder="Search by control, checklist item, owner, responsibility, or framework"
            isSearching={false}
            className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
            ariaLabel="Search controls"
          />
          <ExportButton
            onExport={props.handleExportControls}
            isLoading={props.isExportingControls}
            disabled={props.sortedControls.length === 0}
            label="Export controls to Excel"
          />
        </div>
      </div>

      <DataTable<
        SecurityControlWorkspaceSummary,
        ColumnDef<SecurityControlWorkspaceSummary, unknown>
      >
        data={props.sortedControls}
        columns={props.controlColumns}
        searchParams={props.controlSearchParams}
        isLoading={false}
        onRowClick={(control) => {
          props.updateControlSearch({
            selectedControl: control.internalControlId,
          });
        }}
        emptyMessage="No controls matched the current filters."
      />
    </>
  );
}

export function AdminSecurityReviewsTab(props: {
  autoCollectedEvidenceLinks: AutoCollectedEvidenceLink[];
  busyReviewRunAction: string | null;
  busyReviewTaskAction: string | null;
  currentAnnualReviewRun: ReviewRunSummary | null;
  isPreparingAnnualReview: boolean;
  newTriggeredReviewTitle: string;
  newTriggeredReviewType: string;
  reviewExceptionTasks: ReviewTaskDetail[];
  reviewFinalizeState: ReviewFinalizeState;
  reviewTaskDocuments: Record<string, { label: string; url: string; version: string }>;
  reviewTaskGroups: ReviewTaskGroups;
  reviewTaskNotes: Record<string, string>;
  triggeredReviewRuns: ReviewRunSummary[] | undefined;
  handleAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  handleCreateTriggeredReviewRun: () => Promise<void>;
  handleExceptionTask: (task: ReviewTaskDetail) => Promise<void>;
  handleFinalizeAnnualReview: () => Promise<void>;
  handleOpenReviewFollowUp: (task: ReviewTaskDetail) => Promise<void>;
  handleRefreshAnnualReview: () => Promise<void>;
  navigateToControl: (internalControlId: string) => void;
  onChangeDocumentField: (
    taskId: string,
    field: 'label' | 'url' | 'version',
    value: string,
  ) => void;
  onChangeNote: (taskId: string, value: string) => void;
  setNewTriggeredReviewTitle: Dispatch<SetStateAction<string>>;
  setNewTriggeredReviewType: Dispatch<SetStateAction<string>>;
}) {
  return (
    <>
      <AdminSecurityTabHeader
        title="Reviews"
        description="Annual revalidation status, triggered follow-up runs, and evidence collection for the security program."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!props.currentAnnualReviewRun?.id || props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleRefreshAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'refresh' ? 'Refreshing…' : 'Refresh automation'}
            </Button>
            <Button
              type="button"
              disabled={
                !props.currentAnnualReviewRun?.id ||
                props.busyReviewRunAction !== null ||
                !props.reviewFinalizeState.canFinalize
              }
              onClick={() => {
                void props.handleFinalizeAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'finalize' ? 'Finalizing…' : 'Finalize annual review'}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Current Annual Review</CardTitle>
          <CardDescription>
            Revalidate the current evidence base, complete the required attestations and document
            links, and finalize the annual review record for this cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.currentAnnualReviewRun ? (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <AdminSecuritySummaryCard
                  title="Status"
                  description="Current annual revalidation rollup."
                  value={formatReviewRunStatus(props.currentAnnualReviewRun.status)}
                />
                <AdminSecuritySummaryCard
                  title="Completed Tasks"
                  description="Tasks already completed or exceptioned."
                  value={`${props.currentAnnualReviewRun.taskCounts.completed + props.currentAnnualReviewRun.taskCounts.exception}/${props.currentAnnualReviewRun.taskCounts.total}`}
                />
                <AdminSecuritySummaryCard
                  title="Blocked"
                  description="Tasks that still need follow-up."
                  value={`${props.currentAnnualReviewRun.taskCounts.blocked}`}
                />
                <AdminSecuritySummaryCard
                  title="Ready"
                  description="Tasks currently ready for action."
                  value={`${props.currentAnnualReviewRun.taskCounts.ready}`}
                />
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{props.currentAnnualReviewRun.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Created {new Date(props.currentAnnualReviewRun.createdAt).toLocaleString()}
                      {props.currentAnnualReviewRun.finalizedAt
                        ? ` · Finalized ${new Date(props.currentAnnualReviewRun.finalizedAt).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                  <Badge
                    variant={getReviewRunStatusBadgeVariant(props.currentAnnualReviewRun.status)}
                  >
                    {formatReviewRunStatus(props.currentAnnualReviewRun.status)}
                  </Badge>
                </div>
              </div>

              {props.reviewFinalizeState.canFinalize ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  All required revalidation tasks are complete. The annual review can be finalized
                  now.
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-medium">Finalize is still blocked.</p>
                  <p className="mt-1 text-amber-900">
                    {props.reviewFinalizeState.requiredRemaining.length > 0
                      ? `Remaining required work: ${props.reviewFinalizeState.remainingByType.attestation} attestation${props.reviewFinalizeState.remainingByType.attestation === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.document_upload} document link${props.reviewFinalizeState.remainingByType.document_upload === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.automated_check} automated check${props.reviewFinalizeState.remainingByType.automated_check === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.follow_up} follow-up${props.reviewFinalizeState.remainingByType.follow_up === 1 ? '' : 's'}.`
                      : 'No remaining manual tasks are open.'}
                  </p>
                  {props.reviewFinalizeState.requiredBlocked.length > 0 ? (
                    <p className="mt-1 text-amber-900">
                      Blocked tasks:{' '}
                      {props.reviewFinalizeState.requiredBlocked
                        .map((task) => task.title)
                        .join(', ')}
                      .
                    </p>
                  ) : null}
                </div>
              )}

              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks the system generated or linked automatically for the current run."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.autoCollected}
                title="Auto-collected"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that require a human attestation to renew support for the current cycle."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.needsAttestation}
                title="Needs attestation"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Vendor governance reviews that renew the vendor assessment cadence without affecting support rollups."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.vendorReviews}
                title="Vendor reviews"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Grouped findings review for annual governance posture. Critical open findings must be resolved or dispositioned before attestation."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.findingsReview}
                title="Findings review"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that require a linked document so the annual review can materialize fresh support evidence."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.needsDocumentUpload}
                title="Needs document upload"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that remain blocked or have documented exceptions needing follow-up."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.blocked}
                title="Blocked by open issue"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {props.isPreparingAnnualReview
                ? 'Preparing the current annual review…'
                : 'Annual review is not ready yet. Refresh automation to try again.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-Collected Evidence</CardTitle>
          <CardDescription>
            The latest artifact currently linked to each automated annual-review task.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.autoCollectedEvidenceLinks.length ? (
            props.autoCollectedEvidenceLinks.map(({ link, taskTitle }) => (
              <div key={link.id} className="rounded-lg border p-4">
                <p className="font-medium">{link.sourceLabel}</p>
                {link.sourceLabel !== taskTitle ? (
                  <p className="text-sm text-muted-foreground">{taskTitle}</p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {formatReviewTaskEvidenceSourceType(link.sourceType)} · Linked{' '}
                  {new Date(link.linkedAt).toLocaleString()}
                  {link.freshAt ? ` · Fresh ${new Date(link.freshAt).toLocaleString()}` : ''}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No auto-collected evidence is linked yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triggered Reviews</CardTitle>
          <CardDescription>
            Manual and repo-native follow-up runs that should not wait for the annual cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr,200px,auto]">
            <Input
              value={props.newTriggeredReviewTitle}
              onChange={(event) => {
                props.setNewTriggeredReviewTitle(event.target.value);
              }}
              placeholder="Triggered review title"
            />
            <Select
              value={props.newTriggeredReviewType}
              onValueChange={props.setNewTriggeredReviewType}
            >
              <SelectTrigger aria-label="Triggered review type">
                <SelectValue placeholder="Trigger type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual_follow_up">Manual follow-up</SelectItem>
                <SelectItem value="remediation_follow_up">Remediation</SelectItem>
                <SelectItem value="termination_follow_up">Termination</SelectItem>
                <SelectItem value="certificate_operations">Certificate operations</SelectItem>
                <SelectItem value="unsupported_component">Unsupported component</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleCreateTriggeredReviewRun();
              }}
            >
              {props.busyReviewRunAction === 'create-triggered' ? 'Creating…' : 'Create run'}
            </Button>
          </div>

          {props.triggeredReviewRuns?.length ? (
            props.triggeredReviewRuns.map((run) => (
              <div key={run.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{run.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {run.triggerType ?? 'manual follow-up'} · Created{' '}
                      {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={getReviewRunStatusBadgeVariant(run.status)}>
                    {formatReviewRunStatus(run.status)}
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No triggered reviews have been created yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exceptions / Open Follow-Up</CardTitle>
          <CardDescription>
            Tasks that currently require an exception note or a triggered follow-up run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.reviewExceptionTasks.length ? (
            props.reviewExceptionTasks.map((task) => (
              <div key={task.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-muted-foreground">{task.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatReviewTaskStatus(task.status)}
                      {task.latestNote ? ` · ${task.latestNote}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyReviewTaskAction !== null}
                      onClick={() => {
                        void props.handleExceptionTask(task);
                      }}
                    >
                      {props.busyReviewTaskAction === `${task.id}:exception`
                        ? 'Saving…'
                        : 'Mark exception'}
                    </Button>
                    <Button
                      type="button"
                      disabled={props.busyReviewTaskAction !== null}
                      onClick={() => {
                        void props.handleOpenReviewFollowUp(task);
                      }}
                    >
                      {props.busyReviewTaskAction === `${task.id}:follow-up`
                        ? 'Opening…'
                        : 'Open triggered follow-up'}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No exceptions or open follow-up items are currently tracked.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function AdminSecurityVendorsTab(props: {
  busyVendorKey: string | null;
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: () => void;
  onOpenVendor: (vendorKey: VendorWorkspace['vendor']) => void;
  vendorSummaries: Record<string, string>;
  vendorOwners: Record<string, string>;
  vendorWorkspaces: VendorWorkspace[] | undefined;
  handleReviewVendor: (vendor: VendorWorkspace) => Promise<void>;
  setVendorSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setVendorOwners: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="space-y-4">
      {props.vendorWorkspaces ? (
        <Accordion type="multiple" className="space-y-3">
          {props.vendorWorkspaces.map((vendor) => {
            const currentOwner = props.vendorOwners[vendor.vendor] ?? vendor.owner ?? '';
            const currentSummary = props.vendorSummaries[vendor.vendor] ?? vendor.summary ?? '';
            const isDirty =
              currentOwner !== (vendor.owner ?? '') || currentSummary !== (vendor.summary ?? '');
            const primaryStatus = getVendorPrimaryStatus(vendor);
            const governanceState = getVendorGovernanceState({
              controlCount: vendor.relatedControls.length,
              hasDraftReview: isDirty,
              owner: currentOwner,
              reviewStatus: vendor.reviewStatus,
            });
            const runtimePosture = formatVendorRuntimePosture(vendor);
            const decisionSummary = formatVendorDecisionSummary({
              controlCount: vendor.relatedControls.length,
              hasDraftReview: isDirty,
              lastReviewedAt: vendor.lastReviewedAt,
              owner: currentOwner,
              reviewStatus: vendor.reviewStatus,
              vendor,
            });
            const primaryActionLabel = getVendorPrimaryActionLabel({
              controlCount: vendor.relatedControls.length,
              hasDraftReview: isDirty,
              owner: currentOwner,
            });

            return (
              <AccordionItem
                key={vendor.vendor}
                value={vendor.vendor}
                className="overflow-hidden rounded-xl border bg-background"
              >
                <div className="px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <AccordionTrigger className="flex-1 py-0 hover:no-underline">
                      <div className="grid w-full gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.9fr)] lg:items-start">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold">{vendor.title}</p>
                            <Badge variant={primaryStatus.variant}>{primaryStatus.label}</Badge>
                            <Badge variant={governanceState.variant}>{governanceState.label}</Badge>
                          </div>
                          <p className="max-w-3xl text-sm text-foreground">{decisionSummary}</p>
                          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm md:grid-cols-2">
                            <div className="space-y-1">
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Runtime posture
                              </p>
                              <p className="text-foreground">{runtimePosture.decision}</p>
                              <p className="text-muted-foreground">
                                Environments: {runtimePosture.environments}
                              </p>
                              <p className="text-muted-foreground">
                                Data classes: {runtimePosture.dataClasses}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Governance posture
                              </p>
                              <p className="text-foreground">
                                {currentOwner.length > 0 ? currentOwner : 'Owner not assigned'}
                              </p>
                              <p className="text-muted-foreground">
                                {vendor.relatedControls.length > 0
                                  ? `${vendor.relatedControls.length} linked control${vendor.relatedControls.length === 1 ? '' : 's'}`
                                  : 'No linked controls'}
                              </p>
                              <p className="text-muted-foreground">
                                {vendor.lastReviewedAt
                                  ? `Last reviewed ${new Date(vendor.lastReviewedAt).toLocaleDateString()}`
                                  : 'No completed review recorded'}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <p>{vendor.allowedDataClasses.length} data classes</p>
                            <p>{vendor.allowedEnvironments.length} environments</p>
                            <p>
                              {vendor.nextReviewAt
                                ? `Next review ${new Date(vendor.nextReviewAt).toLocaleDateString()}`
                                : 'Next review not scheduled'}
                            </p>
                            <p>
                              {vendor.linkedFollowUpRunId
                                ? 'Follow-up review linked'
                                : 'No follow-up run'}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-1">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                              Governance state
                            </p>
                            <p className="mt-1 text-foreground">{governanceState.label}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                              Annual review task
                            </p>
                            <p className="mt-1 text-foreground">
                              {vendor.linkedAnnualReviewTask?.title ??
                                'No linked annual review task'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                              Vendor notes
                            </p>
                            <p className="mt-1 text-foreground">
                              {currentSummary.trim().length > 0
                                ? 'Summary recorded'
                                : 'No summary recorded'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={props.busyVendorKey !== null}
                        onClick={() => {
                          void props.handleReviewVendor(vendor);
                        }}
                      >
                        {props.busyVendorKey === vendor.vendor ? 'Saving…' : primaryActionLabel}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          props.onOpenVendor(vendor.vendor);
                        }}
                      >
                        View details
                      </Button>
                    </div>
                  </div>
                </div>
                <AccordionContent className="border-t bg-muted/10 px-4 pb-4">
                  <div className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label
                            className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
                            htmlFor={`vendor-owner-${vendor.vendor}`}
                          >
                            Owner
                          </label>
                          <Input
                            id={`vendor-owner-${vendor.vendor}`}
                            value={currentOwner}
                            onChange={(event) => {
                              props.setVendorOwners((current) => ({
                                ...current,
                                [vendor.vendor]: event.target.value,
                              }));
                            }}
                            placeholder="Assign a vendor owner"
                            className="bg-background"
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Runtime posture
                          </p>
                          <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                            <p className="text-foreground">{runtimePosture.decision}</p>
                            <p className="mt-2">Environments: {runtimePosture.environments}</p>
                            <p className="mt-1">Data classes: {runtimePosture.dataClasses}</p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Decision summary
                        </p>
                        <div className="rounded-lg border bg-background p-3 text-sm text-foreground">
                          {decisionSummary}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Vendor summary
                        </p>
                        <Textarea
                          value={currentSummary}
                          onChange={(event) => {
                            props.setVendorSummaries((current) => ({
                              ...current,
                              [vendor.vendor]: event.target.value,
                            }));
                          }}
                          placeholder="Summarize the vendor posture and review context"
                          className="min-h-28 bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Related controls
                        </p>
                        {vendor.relatedControls.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {vendor.relatedControls.map((control) => (
                              <Button
                                key={`${vendor.vendor}:${control.internalControlId}:${control.itemId ?? 'none'}`}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  props.navigateToControl(control.internalControlId);
                                }}
                              >
                                {control.nist80053Id} · {control.title}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed bg-background p-3 text-sm text-muted-foreground">
                            No linked controls.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-4 rounded-lg border bg-background p-4">
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                            Governance posture
                          </p>
                          <p className="mt-1 text-foreground">
                            {currentOwner.length > 0 ? currentOwner : 'Owner not assigned'}
                          </p>
                          <p className="mt-1 text-foreground">
                            {vendor.relatedControls.length > 0
                              ? `${vendor.relatedControls.length} linked control${vendor.relatedControls.length === 1 ? '' : 's'}`
                              : 'No linked controls'}
                          </p>
                          <p className="mt-1 text-foreground">
                            {vendor.lastReviewedAt
                              ? `Last reviewed ${new Date(vendor.lastReviewedAt).toLocaleString()}`
                              : 'No completed review recorded'}
                          </p>
                          <p className="mt-1 text-foreground">
                            {vendor.nextReviewAt
                              ? `Next review ${new Date(vendor.nextReviewAt).toLocaleDateString()}`
                              : 'Next review date not set'}
                          </p>
                          <p className="mt-1 text-foreground">{governanceState.label}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                            Annual review task
                          </p>
                          <p className="mt-1 text-foreground">
                            {vendor.linkedAnnualReviewTask?.title ?? 'No linked annual review task'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                            Follow-up
                          </p>
                          <p className="mt-1 text-foreground">
                            {vendor.linkedFollowUpRunId
                              ? 'Follow-up review linked'
                              : 'No follow-up run'}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Actions
                        </p>
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            disabled={props.busyVendorKey !== null}
                            onClick={() => {
                              void props.handleReviewVendor(vendor);
                            }}
                          >
                            {props.busyVendorKey === vendor.vendor ? 'Saving…' : primaryActionLabel}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              props.onOpenVendor(vendor.vendor);
                            }}
                          >
                            View details
                          </Button>
                          {vendor.linkedFollowUpRunId ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                props.navigateToReviews();
                              }}
                            >
                              Open reviews
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
          <Spinner className="size-5" />
          <span className="sr-only">Loading vendor posture</span>
        </div>
      )}
    </div>
  );
}

function renderCardStatValue(value: number | undefined) {
  if (value === undefined) {
    return (
      <>
        <Spinner className="size-5" />
        <span className="sr-only">Loading</span>
      </>
    );
  }

  return value;
}

function SecurityControlSummaryGrid(props: { controlSummary: ControlSummary | undefined }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AdminSecuritySummaryCard
        title="Active Controls"
        description="Controls currently tracked in the active register."
        value={renderCardStatValue(props.controlSummary?.totalControls)}
        footer={
          props.controlSummary
            ? `Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`
            : undefined
        }
      />
      <AdminSecuritySummaryCard
        title="Complete Support"
        description="Controls where every checklist item is fully supported by current evidence."
        value={renderCardStatValue(props.controlSummary?.bySupport.complete)}
        footer={
          props.controlSummary
            ? `${props.controlSummary.bySupport.partial} partial controls`
            : undefined
        }
      />
      <AdminSecuritySummaryCard
        title="Shared responsibility"
        description="Controls where customer governance or procedures are still required."
        value={renderCardStatValue(props.controlSummary?.byResponsibility.sharedResponsibility)}
        footer={
          props.controlSummary
            ? `${props.controlSummary.byResponsibility.platform} platform controls`
            : undefined
        }
      />
      <AdminSecuritySummaryCard
        title="Customer"
        description="Controls primarily fulfilled through customer-side governance or procedure."
        value={renderCardStatValue(props.controlSummary?.byResponsibility.customer)}
        footer={
          props.controlSummary
            ? `${props.controlSummary.bySupport.missing} missing support controls`
            : undefined
        }
      />
    </div>
  );
}
