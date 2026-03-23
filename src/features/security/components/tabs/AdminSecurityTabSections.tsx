import type { Id } from '@convex/_generated/dataModel';
import type { ColumnDef } from '@tanstack/react-table';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
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
import { Textarea } from '~/components/ui/textarea';
import { AdminSecurityReviewTaskGroup } from '~/features/security/components/AdminSecurityReviewTaskGroup';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import {
  formatFindingSeverity,
  formatFindingStatus,
  formatPolicySupportProgress,
  formatReviewRunStatus,
  formatReviewTaskEvidenceSourceType,
  formatReviewTaskStatus,
  formatSupportStatus,
  getFindingSeverityBadgeVariant,
  getReviewRunStatusBadgeVariant,
  getSupportBadgeVariant,
} from '~/features/security/formatters';
import type {
  AuditReadinessOverview,
  EvidenceReportListItem,
  ReviewRunSummary,
  ReviewTaskDetail,
  SecurityPolicySummary,
  SecurityControlWorkspaceSummary,
  SecurityFindingListItem,
  SecurityOperationDetail,
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

type FindingSummary = {
  openCount: number;
  reviewPendingCount: number;
  totalCount: number;
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
      | 'vendor_review';
  };
  taskTitle: string;
};

const POLICY_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

type PolicyTableSortField = 'title' | 'support' | 'owner' | 'mappedControlCount' | 'nextReviewAt';

export function AdminSecurityOverviewTab(props: {
  controlSummary: ControlSummary;
  summary: SecurityPostureSummary | undefined;
}) {
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <AdminSecuritySummaryCard
          title="MFA Coverage"
          description="Phishing-resistant MFA coverage across Better Auth users, including passkeys."
          value={
            props.summary
              ? `${props.summary.auth.mfaCoveragePercent}% (${props.summary.auth.mfaEnabledUsers}/${props.summary.auth.totalUsers})`
              : 'Loading…'
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
              : 'Loading…'
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
              : 'Loading…'
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
              : 'Loading…'
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
              : 'Loading…'
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
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [supportFilter, setSupportFilter] = useState<'all' | SecurityPolicySummary['support']>(
    'all',
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof POLICY_PAGE_SIZE_OPTIONS)[number]>(10);
  const [sortBy, setSortBy] = useState<PolicyTableSortField>('title');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const policies = useMemo(() => props.policies ?? [], [props.policies]);
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
  const totalPages = totalPolicies === 0 ? 0 : Math.ceil(totalPolicies / pageSize);
  const currentPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const paginatedPolicies = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedPolicies.slice(startIndex, startIndex + pageSize);
  }, [currentPage, pageSize, sortedPolicies]);
  const policySearchParams = useMemo(
    () => ({
      page: currentPage,
      pageSize,
      sortBy,
      sortOrder,
    }),
    [currentPage, pageSize, sortBy, sortOrder],
  );
  const policyPagination = useMemo(
    () => ({
      page: currentPage,
      pageSize,
      total: totalPolicies,
      totalPages,
    }),
    [currentPage, pageSize, totalPages, totalPolicies],
  );
  const handlePolicySorting = useCallback(
    (columnId: PolicyTableSortField) => {
      setPage(1);
      setSortBy(columnId);
      setSortOrder((currentOrder) =>
        sortBy === columnId ? (currentOrder === 'asc' ? 'desc' : 'asc') : 'asc',
      );
    },
    [sortBy],
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

  useEffect(() => {
    if (page > currentPage) {
      setPage(currentPage);
    }
  }, [currentPage, page]);

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Policies</h2>
          <p className="text-sm text-muted-foreground">
            Governance layer backed by repo markdown, mapped controls, and annual policy
            attestations.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={props.busySync}
          onClick={() => {
            void props.onSyncPolicies();
          }}
        >
          {props.busySync ? 'Syncing…' : 'Sync policy catalog'}
        </Button>
      </div>

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
                setSupportFilter(value);
                setPage(1);
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
              setSearchTerm(value);
              setPage(1);
            }}
            placeholder="Search by policy, summary, owner, or source path"
            isSearching={false}
            className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
            ariaLabel="Search policies"
          />
        </div>
      </div>

      <DataTable<SecurityPolicySummary, ColumnDef<SecurityPolicySummary, unknown>>
        data={paginatedPolicies}
        columns={policyColumns}
        pagination={policyPagination}
        searchParams={policySearchParams}
        isLoading={props.policies === undefined}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPage(1);
          setPageSize(
            POLICY_PAGE_SIZE_OPTIONS.includes(
              nextPageSize as (typeof POLICY_PAGE_SIZE_OPTIONS)[number],
            )
              ? (nextPageSize as (typeof POLICY_PAGE_SIZE_OPTIONS)[number])
              : 10,
          );
        }}
        onRowClick={(policy) => {
          props.onOpenPolicy(policy.policyId);
        }}
        emptyMessage="No policies matched the current filters."
      />
    </>
  );
}

export function AdminSecurityControlsTab(props: {
  controlColumns: ColumnDef<SecurityControlWorkspaceSummary, unknown>[];
  controlPagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  controlSearchParams: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  };
  controlSearchTerm: string;
  controlSummary: ControlSummary;
  supportFilter: 'all' | SecurityControlWorkspaceSummary['support'];
  supportOptions: Array<TableFilterOption<'all' | SecurityControlWorkspaceSummary['support']>>;
  familyFilter: string;
  familyOptions: TableFilterOption<string>[];
  isExportingControls: boolean;
  paginatedControls: SecurityControlWorkspaceSummary[];
  responsibilityFilter: 'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>;
  responsibilityOptions: Array<
    TableFilterOption<'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>>
  >;
  sortedControls: SecurityControlWorkspaceSummary[];
  handleControlPageChange: (nextPage: number) => void;
  handleControlPageSizeChange: (nextPageSize: number) => void;
  handleExportControls: () => Promise<void>;
  updateControlSearch: (updates: {
    page?: number;
    pageSize?: 10 | 20 | 50;
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
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Control Register</h2>
        <p className="text-sm text-muted-foreground">
          Active control register with evidence, responsibility, and framework mapping detail.
        </p>
      </div>
      <SecurityControlSummaryGrid controlSummary={props.controlSummary} />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {props.controlPagination.total} matches
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter<string>
              value={props.familyFilter}
              options={props.familyOptions}
              onValueChange={(value) => {
                props.updateControlSearch({ family: value, page: 1 });
              }}
              className="shrink-0"
              ariaLabel="Filter controls by family"
            />
            <TableFilter<'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>>
              value={props.responsibilityFilter}
              options={props.responsibilityOptions}
              onValueChange={(value) => {
                props.updateControlSearch({ responsibility: value, page: 1 });
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
                  page: 1,
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
              props.updateControlSearch({ search: value, page: 1 });
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
        data={props.paginatedControls}
        columns={props.controlColumns}
        pagination={props.controlPagination}
        searchParams={props.controlSearchParams}
        isLoading={false}
        onPageChange={props.handleControlPageChange}
        onPageSizeChange={props.handleControlPageSizeChange}
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

function AdminSecurityEvidenceTab(props: {
  auditReadiness: AuditReadinessOverview | undefined;
  auditReadinessSummary: {
    latestDrill: AuditReadinessOverview['latestBackupDrill'];
    latestManifestHash: string | null;
    metadataGapCount: number;
    recentDeniedCount: number;
    recentExportCount: number;
    staleDrill: boolean;
  };
  busyFindingKey: string | null;
  busyReportAction: string | null;
  evidenceReports: EvidenceReportListItem[] | undefined;
  findingDispositions: Record<
    SecurityFindingListItem['findingKey'],
    SecurityFindingListItem['disposition']
  >;
  findingCustomerSummaries: Record<string, string>;
  findingNotes: Record<string, string>;
  findingSummary: FindingSummary;
  isGenerating: boolean;
  report: string | null;
  reportCustomerSummaries: Record<string, string>;
  reportNotes: Record<string, string>;
  restoreDrillFooter: string;
  securityFindings: SecurityFindingListItem[] | undefined;
  selectedReportId: Id<'evidenceReports'> | null;
  handleGenerateReport: (reportKind?: 'audit_readiness' | 'security_posture') => Promise<void>;
  handleOpenFindingFollowUp: (finding: SecurityFindingListItem) => Promise<void>;
  handleOpenReportDetail: (reportId: Id<'evidenceReports'>) => void;
  handleOpenFindingDetail: (findingKey: SecurityFindingListItem['findingKey']) => void;
  handleReviewFinding: (findingKey: SecurityFindingListItem['findingKey']) => Promise<void>;
  handleReviewReport: (
    id: Id<'evidenceReports'>,
    reviewStatus: 'needs_follow_up' | 'reviewed',
  ) => Promise<void>;
  handleExportReport: (id: Id<'evidenceReports'>) => Promise<void>;
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: () => void;
  setFindingDispositions: Dispatch<
    SetStateAction<
      Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
    >
  >;
  setFindingCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setFindingNotes: Dispatch<SetStateAction<Record<string, string>>>;
  setReportCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setReportNotes: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminSecuritySummaryCard
          title="Recent Exports"
          description="Manifest-backed audit, directory, and evidence exports recorded recently."
          value={`${props.auditReadinessSummary.recentExportCount}`}
          footer={
            props.auditReadinessSummary.latestManifestHash
              ? `Latest manifest: ${props.auditReadinessSummary.latestManifestHash.slice(0, 16)}…`
              : 'No export manifests recorded'
          }
        />
        <AdminSecuritySummaryCard
          title="Denied Actions"
          description="Recent authorization denials captured through the canonical audit path."
          value={`${props.auditReadinessSummary.recentDeniedCount}`}
          footer="Review the latest denial reasons below"
        />
        <AdminSecuritySummaryCard
          title="Metadata Gaps"
          description="Recent privileged events missing required evidence metadata fields."
          value={`${props.auditReadinessSummary.metadataGapCount}`}
          footer={
            props.auditReadinessSummary.metadataGapCount === 0
              ? 'No gaps in the latest scan'
              : 'Investigate before sharing audit artifacts'
          }
        />
        <AdminSecuritySummaryCard
          title="Restore Drill"
          description="Most recent restore or operator-recorded backup verification evidence."
          value={
            props.auditReadinessSummary.latestDrill
              ? props.auditReadinessSummary.latestDrill.status
              : 'missing'
          }
          footer={props.restoreDrillFooter}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Report</CardTitle>
          <CardDescription>
            Generate a JSON evidence snapshot suitable for internal review and export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => {
              void props.handleGenerateReport('security_posture');
            }}
            disabled={props.isGenerating}
          >
            {props.isGenerating ? 'Generating…' : 'Generate evidence report'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void props.handleGenerateReport('audit_readiness');
            }}
            disabled={props.isGenerating}
          >
            {props.isGenerating ? 'Generating…' : 'Generate audit readiness report'}
          </Button>
          {props.report ? (
            <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
              {props.report}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Readiness Signals</CardTitle>
          <CardDescription>
            Surface manifest history, authorization denials, metadata gaps, and backup drill
            evidence without opening raw JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Latest Backup Drill</h3>
            {props.auditReadiness?.latestBackupDrill ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  {props.auditReadiness.latestBackupDrill.status} ·{' '}
                  {props.auditReadiness.latestBackupDrill.drillType}
                </p>
                <p>{props.auditReadiness.latestBackupDrill.sourceDataset}</p>
                <p>
                  {new Date(props.auditReadiness.latestBackupDrill.checkedAt).toLocaleString()} ·{' '}
                  {props.auditReadiness.latestBackupDrill.targetEnvironment}
                </p>
                <p>Verification: {props.auditReadiness.latestBackupDrill.verificationMethod}</p>
                <p>Restored items: {props.auditReadiness.latestBackupDrill.restoredItemCount}</p>
                {props.auditReadiness.latestBackupDrill.artifactHash ? (
                  <p>Artifact hash: {props.auditReadiness.latestBackupDrill.artifactHash}</p>
                ) : null}
                {props.auditReadiness.latestBackupDrill.failureReason ? (
                  <p>Failure: {props.auditReadiness.latestBackupDrill.failureReason}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No drill evidence recorded yet.</p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Recent Export Artifacts</h3>
            {props.auditReadiness?.recentExports?.length ? (
              <div className="space-y-2">
                {props.auditReadiness.recentExports.slice(0, 5).map((artifact) => (
                  <div
                    key={`${artifact.artifactType}:${artifact.manifestHash}`}
                    className="rounded-md border p-3 text-sm"
                  >
                    <p className="font-medium">{artifact.artifactType}</p>
                    <p className="text-muted-foreground">
                      {new Date(artifact.exportedAt).toLocaleString()}
                    </p>
                    <p className="text-muted-foreground">Manifest: {artifact.manifestHash}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No export artifacts recorded yet.</p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Latest Findings</h3>
            <div className="space-y-2">
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Metadata gaps</p>
                {props.auditReadiness?.metadataGaps?.length ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {props.auditReadiness.metadataGaps.slice(0, 3).map((gap) => (
                      <p key={gap.id}>
                        {gap.eventType} · {new Date(gap.createdAt).toLocaleString()}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">No recent metadata gaps.</p>
                )}
              </div>
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Authorization denials</p>
                {props.auditReadiness?.recentDeniedActions?.length ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {props.auditReadiness.recentDeniedActions.slice(0, 3).map((denial) => (
                      <p key={denial.id}>
                        {new Date(denial.createdAt).toLocaleString()} ·{' '}
                        {denial.organizationId ?? 'global'}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">No recent denials.</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security Finding Review Queue</CardTitle>
          <CardDescription>
            Retained findings from audit integrity, document scanning, and release security
            validation with provider disposition tracking.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <AdminSecuritySummaryCard
              title="Tracked Findings"
              description="Current monitored findings available for provider review."
              value={`${props.findingSummary.totalCount}`}
            />
            <AdminSecuritySummaryCard
              title="Open Findings"
              description="Findings whose current status still requires provider attention."
              value={`${props.findingSummary.openCount}`}
            />
            <AdminSecuritySummaryCard
              title="Pending Disposition"
              description="Findings that have not been assigned a provider disposition yet."
              value={`${props.findingSummary.reviewPendingCount}`}
            />
          </div>

          {props.securityFindings?.length ? (
            props.securityFindings.map((finding) => (
              <div key={finding.findingKey} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{finding.title}</p>
                      <Badge variant={getFindingSeverityBadgeVariant(finding.severity)}>
                        {formatFindingSeverity(finding.severity)}
                      </Badge>
                      <Badge variant={finding.status === 'open' ? 'destructive' : 'secondary'}>
                        {formatFindingStatus(finding.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{finding.description}</p>
                    <p className="text-sm text-muted-foreground">Source: {finding.sourceLabel}</p>
                    <p className="text-sm text-muted-foreground">
                      Last observed {new Date(finding.lastObservedAt).toLocaleString()}
                      {finding.reviewedAt
                        ? ` · Reviewed ${new Date(finding.reviewedAt).toLocaleString()}`
                        : ''}
                      {finding.reviewedByDisplay ? ` · ${finding.reviewedByDisplay}` : ''}
                    </p>
                  </div>
                  <div className="min-w-[220px] space-y-2">
                    <Select
                      value={props.findingDispositions[finding.findingKey] ?? finding.disposition}
                      onValueChange={(value: SecurityFindingListItem['disposition']) => {
                        props.setFindingDispositions((current) => ({
                          ...current,
                          [finding.findingKey]: value,
                        }));
                      }}
                    >
                      <SelectTrigger aria-label={`Disposition for ${finding.title}`}>
                        <SelectValue placeholder="Select disposition" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending_review">Pending review</SelectItem>
                        <SelectItem value="investigating">Investigating</SelectItem>
                        <SelectItem value="accepted_risk">Accepted risk</SelectItem>
                        <SelectItem value="false_positive">False positive</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyFindingKey !== null}
                      onClick={() => {
                        props.handleOpenFindingDetail(finding.findingKey);
                      }}
                    >
                      View details
                    </Button>
                    <Button
                      type="button"
                      disabled={props.busyFindingKey !== null}
                      onClick={() => {
                        void props.handleReviewFinding(finding.findingKey);
                      }}
                    >
                      {props.busyFindingKey === finding.findingKey
                        ? 'Saving…'
                        : 'Save finding review'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyFindingKey !== null}
                      onClick={() => {
                        void props.handleOpenFindingFollowUp(finding);
                      }}
                    >
                      {props.busyFindingKey === finding.findingKey ? 'Opening…' : 'Open follow-up'}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={props.findingNotes[finding.findingKey] ?? finding.internalNotes ?? ''}
                  onChange={(event) => {
                    props.setFindingNotes((current) => ({
                      ...current,
                      [finding.findingKey]: event.target.value,
                    }));
                  }}
                  placeholder="Internal notes"
                />
                <Textarea
                  value={
                    props.findingCustomerSummaries[finding.findingKey] ??
                    finding.customerSummary ??
                    ''
                  }
                  onChange={(event) => {
                    props.setFindingCustomerSummaries((current) => ({
                      ...current,
                      [finding.findingKey]: event.target.value,
                    }));
                  }}
                  placeholder="Customer-facing summary"
                />
                {finding.relatedControls?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {finding.relatedControls?.map((control) => (
                      <Button
                        key={`${finding.findingKey}:${control.internalControlId}:${control.itemId ?? 'none'}`}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        props.navigateToReviews();
                      }}
                    >
                      Open reviews
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No retained findings are available for review yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Review Queue</CardTitle>
          <CardDescription>
            Review generated evidence, capture notes, and export integrity-linked bundles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.evidenceReports?.length ? (
            props.evidenceReports.map((item) => (
              <div
                key={item.id}
                className="space-y-3 rounded-lg border p-4"
                data-selected={props.selectedReportId === item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {item.reportKind} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Review: {item.reviewStatus} · Content hash: {item.contentHash}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.exportHash
                        ? `Last export hash: ${item.exportHash}`
                        : 'Not exported yet'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.exportManifestHash
                        ? `Manifest hash: ${item.exportManifestHash}`
                        : 'Manifest not recorded yet'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyReportAction !== null}
                      onClick={() => {
                        props.handleOpenReportDetail(item.id);
                      }}
                    >
                      View details
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyReportAction !== null}
                      onClick={() => {
                        void props.handleReviewReport(item.id, 'reviewed');
                      }}
                    >
                      {props.busyReportAction === `${item.id}:reviewed`
                        ? 'Saving…'
                        : 'Mark reviewed'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyReportAction !== null}
                      onClick={() => {
                        void props.handleReviewReport(item.id, 'needs_follow_up');
                      }}
                    >
                      {props.busyReportAction === `${item.id}:needs_follow_up`
                        ? 'Saving…'
                        : 'Needs follow-up'}
                    </Button>
                    <Button
                      type="button"
                      disabled={props.busyReportAction !== null}
                      onClick={() => {
                        void props.handleExportReport(item.id);
                      }}
                    >
                      {props.busyReportAction === `${item.id}:export`
                        ? 'Exporting…'
                        : 'Export bundle'}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={props.reportNotes[item.id] ?? item.internalNotes ?? ''}
                  onChange={(event) => {
                    props.setReportNotes((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }));
                  }}
                  placeholder="Internal notes"
                />
                <Textarea
                  value={props.reportCustomerSummaries[item.id] ?? item.customerSummary ?? ''}
                  onChange={(event) => {
                    props.setReportCustomerSummaries((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }));
                  }}
                  placeholder="Customer-facing summary"
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No evidence reports generated yet.</p>
          )}
        </CardContent>
      </Card>
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
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Current Annual Review</CardTitle>
              <CardDescription>
                Revalidate the current evidence base, complete the required attestations and
                document links, and finalize the annual review record for this cycle.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
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
                {props.busyReviewRunAction === 'finalize'
                  ? 'Finalizing…'
                  : 'Finalize annual review'}
              </Button>
            </div>
          </div>
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

function AdminSecurityVendorsTab(props: {
  busyVendorKey: string | null;
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: () => void;
  onSelectVendor: (vendorKey: VendorWorkspace['vendor']) => void;
  onSelectReviewRun: (reviewRunId: ReviewRunSummary['id']) => void;
  vendorCustomerSummaries: Record<string, string>;
  vendorNotes: Record<string, string>;
  vendorOwners: Record<string, string>;
  vendorWorkspaces: VendorWorkspace[] | undefined;
  handleReviewVendor: (
    vendor: VendorWorkspace,
    reviewStatus: VendorWorkspace['reviewStatus'],
  ) => Promise<void>;
  setVendorCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setVendorNotes: Dispatch<SetStateAction<Record<string, string>>>;
  setVendorOwners: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor Boundary</CardTitle>
        <CardDescription>
          Runtime vendor posture plus persisted review state, follow-up context, and linked
          controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.vendorWorkspaces?.map((vendor) => (
          <div key={vendor.vendor} className="rounded-md border p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{vendor.displayName}</p>
                  <Badge variant={vendor.approved ? 'default' : 'secondary'}>
                    {vendor.approved ? 'Approved' : 'Blocked'}
                  </Badge>
                  <Badge
                    variant={
                      vendor.reviewStatus === 'reviewed'
                        ? 'default'
                        : vendor.reviewStatus === 'needs_follow_up'
                          ? 'destructive'
                          : 'outline'
                    }
                  >
                    {vendor.reviewStatus === 'needs_follow_up'
                      ? 'Needs follow-up'
                      : vendor.reviewStatus === 'reviewed'
                        ? 'Reviewed'
                        : 'Pending review'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Data classes: {vendor.allowedDataClasses.join(', ')}
                </p>
                <p className="text-sm text-muted-foreground">
                  Environments: {vendor.allowedEnvironments.join(', ')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {vendor.approved
                    ? vendor.approvedByDefault
                      ? 'Approved by default'
                      : `Approved via ${vendor.approvalEnvVar}`
                    : `Blocked until ${vendor.approvalEnvVar ?? 'approved'}`}
                </p>
                {vendor.reviewedAt ? (
                  <p className="text-sm text-muted-foreground">
                    Reviewed {new Date(vendor.reviewedAt).toLocaleString()}
                    {vendor.reviewedByDisplay ? ` · ${vendor.reviewedByDisplay}` : ''}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`vendor-owner-${vendor.vendor}`}>
                  Owner
                </label>
                <Input
                  id={`vendor-owner-${vendor.vendor}`}
                  value={props.vendorOwners[vendor.vendor] ?? vendor.owner ?? ''}
                  onChange={(event) => {
                    props.setVendorOwners((current) => ({
                      ...current,
                      [vendor.vendor]: event.target.value,
                    }));
                  }}
                  placeholder="Vendor owner"
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Related controls</p>
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
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Textarea
                value={props.vendorNotes[vendor.vendor] ?? vendor.internalNotes ?? ''}
                onChange={(event) => {
                  props.setVendorNotes((current) => ({
                    ...current,
                    [vendor.vendor]: event.target.value,
                  }));
                }}
                placeholder="Internal notes"
              />
              <Textarea
                value={props.vendorCustomerSummaries[vendor.vendor] ?? vendor.customerSummary ?? ''}
                onChange={(event) => {
                  props.setVendorCustomerSummaries((current) => ({
                    ...current,
                    [vendor.vendor]: event.target.value,
                  }));
                }}
                placeholder="Customer-facing summary"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    props.onSelectVendor(vendor.vendor);
                  }}
                >
                  View details
                </Button>
                <Button
                  type="button"
                  disabled={props.busyVendorKey !== null}
                  onClick={() => {
                    void props.handleReviewVendor(vendor, 'reviewed');
                  }}
                >
                  {props.busyVendorKey === vendor.vendor ? 'Saving…' : 'Mark reviewed'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.busyVendorKey !== null}
                  onClick={() => {
                    void props.handleReviewVendor(vendor, 'needs_follow_up');
                  }}
                >
                  {props.busyVendorKey === vendor.vendor ? 'Opening…' : 'Needs follow-up'}
                </Button>
                {vendor.linkedFollowUpRunId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      props.onSelectReviewRun(vendor.linkedFollowUpRunId!);
                    }}
                  >
                    View follow-up
                  </Button>
                ) : null}
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
        )) ?? <p className="text-sm text-muted-foreground">Loading vendor posture…</p>}
      </CardContent>
    </Card>
  );
}

export function AdminSecurityOperationsTab(props: {
  auditReadiness: AuditReadinessOverview | undefined;
  auditReadinessSummary: {
    latestDrill: AuditReadinessOverview['latestBackupDrill'];
    latestManifestHash: string | null;
    metadataGapCount: number;
    recentDeniedCount: number;
    recentExportCount: number;
    staleDrill: boolean;
  };
  busyFindingKey: string | null;
  busyReportAction: string | null;
  busyVendorKey: string | null;
  evidenceReports: EvidenceReportListItem[] | undefined;
  findingCustomerSummaries: Record<string, string>;
  findingDispositions: Record<
    SecurityFindingListItem['findingKey'],
    SecurityFindingListItem['disposition']
  >;
  findingNotes: Record<string, string>;
  findingSummary: FindingSummary;
  isGenerating: boolean;
  report: string | null;
  reportCustomerSummaries: Record<string, string>;
  reportNotes: Record<string, string>;
  restoreDrillFooter: string;
  securityFindings: SecurityFindingListItem[] | undefined;
  selectedOperationDetail: SecurityOperationDetail | null;
  selectedOperationId: string | undefined;
  selectedOperationType: SecurityOperationDetail['kind'] | undefined;
  triggeredReviewRuns: ReviewRunSummary[] | undefined;
  vendorCustomerSummaries: Record<string, string>;
  vendorNotes: Record<string, string>;
  vendorOwners: Record<string, string>;
  vendorWorkspaces: VendorWorkspace[] | undefined;
  handleGenerateReport: (reportKind?: 'audit_readiness' | 'security_posture') => Promise<void>;
  handleOpenFindingFollowUp: (finding: SecurityFindingListItem) => Promise<void>;
  handleOpenReportDetail: (reportId: Id<'evidenceReports'>) => void;
  onSelectOperation: (operationType: SecurityOperationDetail['kind'], operationId: string) => void;
  handleReviewFinding: (findingKey: SecurityFindingListItem['findingKey']) => Promise<void>;
  handleReviewReport: (
    id: Id<'evidenceReports'>,
    reviewStatus: 'needs_follow_up' | 'reviewed',
  ) => Promise<void>;
  handleExportReport: (id: Id<'evidenceReports'>) => Promise<void>;
  handleReviewVendor: (
    vendor: VendorWorkspace,
    reviewStatus: VendorWorkspace['reviewStatus'],
  ) => Promise<void>;
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: () => void;
  setFindingCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setFindingDispositions: Dispatch<
    SetStateAction<
      Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
    >
  >;
  setFindingNotes: Dispatch<SetStateAction<Record<string, string>>>;
  setReportCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setReportNotes: Dispatch<SetStateAction<Record<string, string>>>;
  setVendorCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setVendorNotes: Dispatch<SetStateAction<Record<string, string>>>;
  setVendorOwners: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <>
      <AdminSecurityEvidenceTab
        auditReadiness={props.auditReadiness}
        auditReadinessSummary={props.auditReadinessSummary}
        busyFindingKey={props.busyFindingKey}
        busyReportAction={props.busyReportAction}
        evidenceReports={props.evidenceReports}
        findingCustomerSummaries={props.findingCustomerSummaries}
        findingDispositions={props.findingDispositions}
        findingNotes={props.findingNotes}
        findingSummary={props.findingSummary}
        handleExportReport={props.handleExportReport}
        handleGenerateReport={props.handleGenerateReport}
        handleOpenFindingFollowUp={props.handleOpenFindingFollowUp}
        handleOpenFindingDetail={(findingKey) => {
          props.onSelectOperation('finding', findingKey);
        }}
        handleOpenReportDetail={props.handleOpenReportDetail}
        handleReviewFinding={props.handleReviewFinding}
        handleReviewReport={props.handleReviewReport}
        isGenerating={props.isGenerating}
        navigateToControl={props.navigateToControl}
        navigateToReviews={props.navigateToReviews}
        report={props.report}
        reportCustomerSummaries={props.reportCustomerSummaries}
        reportNotes={props.reportNotes}
        restoreDrillFooter={props.restoreDrillFooter}
        securityFindings={props.securityFindings}
        selectedReportId={
          props.selectedOperationType === 'evidence_report'
            ? (props.selectedOperationId as Id<'evidenceReports'>)
            : null
        }
        setFindingCustomerSummaries={props.setFindingCustomerSummaries}
        setFindingDispositions={props.setFindingDispositions}
        setFindingNotes={props.setFindingNotes}
        setReportCustomerSummaries={props.setReportCustomerSummaries}
        setReportNotes={props.setReportNotes}
      />

      {props.selectedOperationId && props.selectedOperationType ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Selected Operation</CardTitle>
            <CardDescription>
              Linked detail for the currently selected report, finding, vendor review, or follow-up
              run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {props.selectedOperationDetail ? (
              props.selectedOperationDetail.kind === 'evidence_report' ? (
                <>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      {props.selectedOperationDetail.report.reportKind} ·{' '}
                      {new Date(props.selectedOperationDetail.report.createdAt).toLocaleString()}
                    </p>
                    <p>Content hash: {props.selectedOperationDetail.report.contentHash}</p>
                    <p>Review: {props.selectedOperationDetail.report.reviewStatus}</p>
                    {'exportManifestHash' in props.selectedOperationDetail.report &&
                    props.selectedOperationDetail.report.exportManifestHash ? (
                      <p>
                        Manifest hash: {props.selectedOperationDetail.report.exportManifestHash}
                      </p>
                    ) : null}
                  </div>
                  {'linkedTasks' in props.selectedOperationDetail.report &&
                  props.selectedOperationDetail.report.linkedTasks?.length ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Linked review tasks</p>
                      {props.selectedOperationDetail.report.linkedTasks?.map((task) => (
                        <div key={task.taskId} className="rounded-md border p-3 text-sm">
                          <p className="font-medium">{task.taskTitle}</p>
                          <p className="text-muted-foreground">
                            {task.reviewRunTitle} · {formatReviewRunStatus(task.reviewRunStatus)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                props.navigateToReviews();
                              }}
                            >
                              Open reviews
                            </Button>
                            {task.controlLinks.map((link) => (
                              <Button
                                key={`${task.taskId}:${link.internalControlId}:${link.itemId}`}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  props.navigateToControl(link.internalControlId);
                                }}
                              >
                                {link.nist80053Id ?? link.internalControlId}
                                {link.itemLabel ? ` · ${link.itemLabel}` : ''}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {'contentJson' in props.selectedOperationDetail.report ? (
                    <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
                      {props.selectedOperationDetail.report.contentJson}
                    </pre>
                  ) : props.report ? (
                    <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
                      {props.report}
                    </pre>
                  ) : null}
                </>
              ) : props.selectedOperationDetail.kind === 'finding' ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {props.selectedOperationDetail.finding.title}
                  </p>
                  <p>{props.selectedOperationDetail.finding.description}</p>
                  <p>
                    {formatFindingSeverity(props.selectedOperationDetail.finding.severity)} ·{' '}
                    {formatFindingStatus(props.selectedOperationDetail.finding.status)}
                  </p>
                  <p>Disposition: {props.selectedOperationDetail.finding.disposition}</p>
                  <p>Source: {props.selectedOperationDetail.finding.sourceLabel}</p>
                </div>
              ) : props.selectedOperationDetail.kind === 'vendor_review' ? (
                (() => {
                  const vendorReview = props.selectedOperationDetail.vendorReview;
                  return (
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">{vendorReview.displayName}</p>
                      <p>Review: {vendorReview.reviewStatus}</p>
                      <p>Data classes: {vendorReview.allowedDataClasses.join(', ')}</p>
                      <p>Environments: {vendorReview.allowedEnvironments.join(', ')}</p>
                      {vendorReview.linkedFollowUpRunId ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              props.onSelectOperation(
                                'review_run',
                                vendorReview.linkedFollowUpRunId!,
                              );
                            }}
                          >
                            View follow-up
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              props.navigateToReviews();
                            }}
                          >
                            Open reviews
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {props.selectedOperationDetail.reviewRun.title}
                  </p>
                  <p>
                    Status: {formatReviewRunStatus(props.selectedOperationDetail.reviewRun.status)}
                  </p>
                  <p>
                    {props.selectedOperationDetail.reviewRun.triggerType ?? 'manual follow-up'} ·{' '}
                    {new Date(props.selectedOperationDetail.reviewRun.createdAt).toLocaleString()}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      props.navigateToReviews();
                    }}
                  >
                    Open reviews
                  </Button>
                </div>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Loading operation detail…</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Follow-Up Runs</CardTitle>
          <CardDescription>
            Triggered follow-up reviews opened from reports, findings, and vendor reviews.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={getReviewRunStatusBadgeVariant(run.status)}>
                      {formatReviewRunStatus(run.status)}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        props.onSelectOperation('review_run', run.id);
                      }}
                    >
                      View details
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        props.navigateToReviews();
                      }}
                    >
                      Open reviews
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No triggered follow-up runs are currently open.
            </p>
          )}
        </CardContent>
      </Card>

      <AdminSecurityVendorsTab
        busyVendorKey={props.busyVendorKey}
        handleReviewVendor={props.handleReviewVendor}
        navigateToControl={props.navigateToControl}
        navigateToReviews={props.navigateToReviews}
        onSelectReviewRun={(reviewRunId) => {
          props.onSelectOperation('review_run', reviewRunId);
        }}
        onSelectVendor={(vendorKey) => {
          props.onSelectOperation('vendor_review', vendorKey);
        }}
        setVendorCustomerSummaries={props.setVendorCustomerSummaries}
        setVendorNotes={props.setVendorNotes}
        setVendorOwners={props.setVendorOwners}
        vendorCustomerSummaries={props.vendorCustomerSummaries}
        vendorNotes={props.vendorNotes}
        vendorOwners={props.vendorOwners}
        vendorWorkspaces={props.vendorWorkspaces}
      />
    </>
  );
}

function SecurityControlSummaryGrid(props: { controlSummary: ControlSummary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AdminSecuritySummaryCard
        title="Active Controls"
        description="Controls currently tracked in the active register."
        value={`${props.controlSummary.totalControls}`}
        footer={`Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`}
      />
      <AdminSecuritySummaryCard
        title="Complete Support"
        description="Controls where every checklist item is fully supported by current evidence."
        value={`${props.controlSummary.bySupport.complete}`}
        footer={`${props.controlSummary.bySupport.partial} partial controls`}
      />
      <AdminSecuritySummaryCard
        title="Shared responsibility"
        description="Controls where customer governance or procedures are still required."
        value={`${props.controlSummary.byResponsibility.sharedResponsibility}`}
        footer={`${props.controlSummary.byResponsibility.platform} platform controls`}
      />
      <AdminSecuritySummaryCard
        title="Customer"
        description="Controls primarily fulfilled through customer-side governance or procedure."
        value={`${props.controlSummary.byResponsibility.customer}`}
        footer={`${props.controlSummary.bySupport.missing} missing support controls`}
      />
    </div>
  );
}
