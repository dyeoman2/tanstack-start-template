import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useAction, useMutation, useQuery } from 'convex/react';
import Papa from 'papaparse';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  createSortableHeader,
  DataTable,
  TableFilter,
  TableSearch,
  type TableFilterOption,
} from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { ExportButton } from '~/components/ui/export-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import {
  ACTIVE_CONTROL_REGISTER,
  CONTROL_STATUS_DISPLAY_LABELS,
  type ActiveControlRecord,
  type ControlStatus,
  type EvidenceStatus,
  getControlStatusDisplayLabel,
  getActiveControlRegisterSummary,
} from '~/lib/shared/compliance/control-register';

const SECURITY_TABS = ['overview', 'controls', 'evidence', 'vendors'] as const;
const CONTROL_TABLE_SORT_FIELDS = ['control', 'status', 'family', 'evidence', 'review'] as const;
const CONTROL_STATUS_FILTER_VALUES = [
  'all',
  'platform-enforced',
  'shared-responsibility',
  'partial',
  'operator-owned',
  'not-applicable',
] as const;

const CONTROL_EVIDENCE_FILTER_VALUES = [
  'all',
  'pass',
  'warning',
  'missing',
  'fail',
  'not-tested',
] as const;
const CONTROL_REVIEW_FILTER_VALUES = ['all', 'reviewed', 'review-overdue'] as const;
const CONTROL_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const securitySearchSchema = z.object({
  tab: z.enum(SECURITY_TABS).default('overview'),
  page: z.number().default(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(10),
  sortBy: z.enum(CONTROL_TABLE_SORT_FIELDS).default('control'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  status: z.enum(CONTROL_STATUS_FILTER_VALUES).default('all'),
  family: z.string().default('all'),
  evidence: z.enum(CONTROL_EVIDENCE_FILTER_VALUES).default('all'),
  review: z.enum(CONTROL_REVIEW_FILTER_VALUES).default('all'),
  selectedControl: z.string().optional(),
});

export const Route = createFileRoute('/app/admin/security')({
  validateSearch: securitySearchSchema,
  component: AdminSecurityRoute,
});

function isSecurityTab(value: string): value is (typeof SECURITY_TABS)[number] {
  return SECURITY_TABS.includes(value as (typeof SECURITY_TABS)[number]);
}

function AdminSecurityRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const {
    tab: activeTab,
    page,
    pageSize,
    sortBy,
    sortOrder,
    search: controlSearchTerm,
    status: statusFilter,
    family: familyFilter,
    evidence: evidenceFilter,
    review: reviewFilter,
    selectedControl: selectedControlId,
  } = search;
  const { showToast } = useToast();
  const summary = useQuery(api.security.getSecurityPostureSummary, {});
  const evidenceReports = useQuery(api.security.listEvidenceReports, { limit: 10 });
  const generateEvidenceReport = useAction(api.security.generateEvidenceReport);
  const exportEvidenceReport = useAction(api.security.exportEvidenceReport);
  const reviewEvidenceReport = useMutation(api.security.reviewEvidenceReport);
  const [report, setReport] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<Id<'evidenceReports'> | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);
  const [isExportingControls, setIsExportingControls] = useState(false);

  const controlSummary = getActiveControlRegisterSummary();
  const familyOptions = useMemo<TableFilterOption<string>[]>(
    () => [
      { label: 'All families', value: 'all' },
      ...Array.from(
        new Map(
          ACTIVE_CONTROL_REGISTER.controls.map((control) => [
            control.familyId,
            control.familyTitle,
          ]),
        ).entries(),
      )
        .sort(([leftId, leftTitle], [rightId, rightTitle]) => {
          return leftId.localeCompare(rightId) || leftTitle.localeCompare(rightTitle);
        })
        .map(([familyId, familyTitle]) => ({
          label: `${familyId} · ${familyTitle}`,
          value: familyId,
        })),
    ],
    [],
  );
  const statusOptions = useMemo<TableFilterOption<'all' | ControlStatus>[]>(
    () => [
      { label: 'All statuses', value: 'all' },
      { label: CONTROL_STATUS_DISPLAY_LABELS['platform-enforced'], value: 'platform-enforced' },
      {
        label: CONTROL_STATUS_DISPLAY_LABELS['shared-responsibility'],
        value: 'shared-responsibility',
      },
      { label: CONTROL_STATUS_DISPLAY_LABELS.partial, value: 'partial' },
      { label: CONTROL_STATUS_DISPLAY_LABELS['operator-owned'], value: 'operator-owned' },
      { label: CONTROL_STATUS_DISPLAY_LABELS['not-applicable'], value: 'not-applicable' },
    ],
    [],
  );
  const evidenceOptions = useMemo<TableFilterOption<'all' | EvidenceStatus>[]>(
    () => [
      { label: 'All evidence states', value: 'all' },
      { label: 'Pass', value: 'pass' },
      { label: 'Warning', value: 'warning' },
      { label: 'Missing', value: 'missing' },
      { label: 'Fail', value: 'fail' },
      { label: 'Not tested', value: 'not-tested' },
    ],
    [],
  );
  const reviewOptions = useMemo<TableFilterOption<'all' | 'reviewed' | 'review-overdue'>[]>(
    () => [
      { label: 'All review states', value: 'all' },
      { label: 'Needs review', value: 'review-overdue' },
      { label: 'Reviewed', value: 'reviewed' },
    ],
    [],
  );
  const normalizedControlSearchTerm = controlSearchTerm.trim().toLowerCase();
  const filteredControls = useMemo(
    () =>
      ACTIVE_CONTROL_REGISTER.controls.filter((control) => {
        if (statusFilter !== 'all' && control.status !== statusFilter) {
          return false;
        }

        if (familyFilter !== 'all' && control.familyId !== familyFilter) {
          return false;
        }

        if (evidenceFilter !== 'all' && control.evidence.latestEvidenceStatus !== evidenceFilter) {
          return false;
        }

        if (reviewFilter === 'reviewed' && control.reviewStatus !== 'reviewed') {
          return false;
        }

        if (reviewFilter === 'review-overdue' && control.reviewStatus === 'reviewed') {
          return false;
        }

        if (normalizedControlSearchTerm.length === 0) {
          return true;
        }

        const searchableText = [
          control.nist80053Id,
          control.title,
          control.implementationSummary,
          control.controlStatement,
          control.familyId,
          control.familyTitle,
          control.internalControlId,
          control.owner,
          control.status,
          control.reviewStatus,
          control.evidence.latestEvidenceStatus,
        ]
          .join(' ')
          .toLowerCase();

        return searchableText.includes(normalizedControlSearchTerm);
      }),
    [evidenceFilter, familyFilter, normalizedControlSearchTerm, reviewFilter, statusFilter],
  );
  const sortedControls = useMemo(() => {
    const sorted = [...filteredControls];
    sorted.sort((left, right) => {
      const direction = sortOrder === 'asc' ? 1 : -1;
      let comparison = 0;

      switch (sortBy) {
        case 'status':
          comparison = left.status.localeCompare(right.status);
          break;
        case 'family':
          comparison =
            left.familyId.localeCompare(right.familyId) ||
            left.familyTitle.localeCompare(right.familyTitle);
          break;
        case 'evidence':
          comparison =
            left.evidence.latestEvidenceStatus.localeCompare(right.evidence.latestEvidenceStatus) ||
            left.evidence.evidenceCount - right.evidence.evidenceCount;
          break;
        case 'review':
          comparison =
            left.reviewStatus.localeCompare(right.reviewStatus) ||
            (left.lastReviewedAt ?? '').localeCompare(right.lastReviewedAt ?? '');
          break;
        default:
          comparison =
            left.nist80053Id.localeCompare(right.nist80053Id) ||
            left.title.localeCompare(right.title);
          break;
      }

      if (comparison !== 0) {
        return comparison * direction;
      }

      return (
        left.internalControlId.localeCompare(right.internalControlId) *
        (sortOrder === 'asc' ? 1 : -1)
      );
    });

    return sorted;
  }, [filteredControls, sortBy, sortOrder]);
  const totalControlPages = Math.max(1, Math.ceil(sortedControls.length / pageSize));
  const currentControlPage = Math.min(page, totalControlPages);
  const paginatedControls = useMemo(() => {
    const startIndex = (currentControlPage - 1) * pageSize;
    return sortedControls.slice(startIndex, startIndex + pageSize);
  }, [currentControlPage, pageSize, sortedControls]);
  const selectedControl = useMemo(
    () =>
      selectedControlId
        ? (ACTIVE_CONTROL_REGISTER.controls.find(
            (control) => control.internalControlId === selectedControlId,
          ) ?? null)
        : null,
    [selectedControlId],
  );
  const controlPagination = useMemo(
    () => ({
      page: currentControlPage,
      pageSize,
      total: sortedControls.length,
      totalPages: totalControlPages,
    }),
    [currentControlPage, pageSize, sortedControls.length, totalControlPages],
  );
  const controlSearchParams = useMemo(
    () => ({
      page: currentControlPage,
      pageSize,
      sortBy,
      sortOrder,
    }),
    [currentControlPage, pageSize, sortBy, sortOrder],
  );
  const updateControlSearch = useCallback(
    (
      updates: Partial<{
        page: number;
        pageSize: (typeof CONTROL_PAGE_SIZE_OPTIONS)[number];
        sortBy: (typeof CONTROL_TABLE_SORT_FIELDS)[number];
        sortOrder: 'asc' | 'desc';
        search: string;
        status: 'all' | ControlStatus;
        family: string;
        evidence: 'all' | EvidenceStatus;
        review: 'all' | 'reviewed' | 'review-overdue';
        selectedControl: string | undefined;
      }>,
    ) => {
      void navigate({
        to: '/app/admin/security',
        search: {
          ...search,
          ...updates,
        },
      });
    },
    [navigate, search],
  );
  const handleControlSorting = useCallback(
    (columnId: (typeof CONTROL_TABLE_SORT_FIELDS)[number]) => {
      updateControlSearch({
        sortBy: columnId,
        sortOrder: sortBy === columnId && sortOrder === 'asc' ? 'desc' : 'asc',
        page: 1,
      });
    },
    [sortBy, sortOrder, updateControlSearch],
  );
  const handleControlPageChange = useCallback(
    (nextPage: number) => {
      updateControlSearch({ page: nextPage });
    },
    [updateControlSearch],
  );
  const handleControlPageSizeChange = useCallback(
    (nextPageSize: number) => {
      updateControlSearch({
        page: 1,
        pageSize: CONTROL_PAGE_SIZE_OPTIONS.includes(
          nextPageSize as (typeof CONTROL_PAGE_SIZE_OPTIONS)[number],
        )
          ? (nextPageSize as (typeof CONTROL_PAGE_SIZE_OPTIONS)[number])
          : 10,
      });
    },
    [updateControlSearch],
  );
  const controlColumns = useMemo<ColumnDef<ActiveControlRecord, unknown>[]>(
    () => [
      {
        accessorKey: 'control',
        header: createSortableHeader(
          'Control',
          'control',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <ControlCell control={row.original} />,
      },
      {
        accessorKey: 'status',
        header: createSortableHeader('Status', 'status', controlSearchParams, handleControlSorting),
        cell: ({ row }) => <ControlStatusCell control={row.original} />,
      },
      {
        accessorKey: 'family',
        header: createSortableHeader(
          'Frameworks',
          'family',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <FrameworkSummaryCell control={row.original} />,
      },
      {
        accessorKey: 'evidence',
        header: createSortableHeader(
          'Evidence',
          'evidence',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <EvidenceCell control={row.original} />,
      },
      {
        accessorKey: 'review',
        header: createSortableHeader('Review', 'review', controlSearchParams, handleControlSorting),
        cell: ({ row }) => <ReviewCell control={row.original} />,
      },
    ],
    [controlSearchParams, handleControlSorting],
  );
  const handleExportControls = useCallback(async () => {
    setIsExportingControls(true);

    try {
      const csv = Papa.unparse(
        sortedControls.map((control) => ({
          controlId: control.nist80053Id,
          title: control.title,
          implementationSummary: control.implementationSummary,
          controlStatement: control.controlStatement,
          familyId: control.familyId,
          familyTitle: control.familyTitle,
          owner: control.owner,
          priority: control.priority,
          status: control.status,
          implementationScope: control.implementationScope,
          evidenceStatus: control.evidence.latestEvidenceStatus,
          evidenceCount: control.evidence.evidenceCount,
          evidenceSources: control.evidence.evidenceSources.join('; '),
          reviewStatus: control.reviewStatus,
          lastReviewedAt: control.lastReviewedAt ?? '',
          internalControlId: control.internalControlId,
          sharedResponsibilityNotes: control.sharedResponsibilityNotes ?? '',
          hipaaMappings: control.mappings.hipaa
            .map(
              (mapping) =>
                `${mapping.citation}${mapping.title ? ` · ${mapping.title}` : ''}${mapping.type ? ` · ${mapping.type}` : ''}${mapping.implementationSpecification ? ` · ${mapping.implementationSpecification}` : ''}`,
            )
            .join('; '),
          hipaaMappingsJson: JSON.stringify(control.mappings.hipaa),
          csfMappings: control.mappings.csf20
            .map(
              (mapping) => `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
            )
            .join('; '),
          csfMappingsJson: JSON.stringify(control.mappings.csf20),
          nist80066Mappings: control.mappings.nist80066
            .map(
              (mapping) =>
                `${mapping.referenceId}${mapping.label ? ` · ${mapping.label}` : ''}${mapping.mappingType ? ` · ${mapping.mappingType}` : ''}`,
            )
            .join('; '),
          nist80066MappingsJson: JSON.stringify(control.mappings.nist80066),
          soc2Mappings: control.mappings.soc2
            .map(
              (mapping) =>
                `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}${mapping.group ? ` · ${mapping.group}` : ''}${mapping.trustServiceCategory ? ` · ${mapping.trustServiceCategory}` : ''}`,
            )
            .join('; '),
          soc2MappingsJson: JSON.stringify(control.mappings.soc2),
          evidenceJson: JSON.stringify(control.evidence),
          fullControlJson: JSON.stringify(control),
        })),
      );
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = `security-control-register-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast('Control register exported.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to export control register',
        'error',
      );
    } finally {
      setIsExportingControls(false);
    }
  }, [showToast, sortedControls]);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const generated = await generateEvidenceReport({});
      setReport(generated.report);
      setSelectedReportId(generated.id);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReviewReport = async (
    id: Id<'evidenceReports'>,
    reviewStatus: 'needs_follow_up' | 'reviewed',
  ) => {
    setBusyReportAction(`${id}:${reviewStatus}`);
    try {
      await reviewEvidenceReport({
        id,
        reviewNotes: reviewNotes[id]?.trim() || undefined,
        reviewStatus,
      });
    } finally {
      setBusyReportAction(null);
    }
  };

  const handleExportReport = async (id: Id<'evidenceReports'>) => {
    setBusyReportAction(`${id}:export`);
    try {
      const exported = await exportEvidenceReport({ id });
      setReport(exported.report);
      setSelectedReportId(id);
    } finally {
      setBusyReportAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review control implementation, evidence posture, vendor boundaries, and security oversight workflows."
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isSecurityTab(value) || value === activeTab) {
            return;
          }

          void navigate({
            to: '/app/admin/security',
            search: {
              ...search,
              tab: value,
              selectedControl: value === 'controls' ? search.selectedControl : undefined,
            },
          });
        }}
      >
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              title="MFA Coverage"
              description="Phishing-resistant MFA coverage across Better Auth users, including passkeys."
              value={
                summary
                  ? `${summary.auth.mfaCoveragePercent}% (${summary.auth.mfaEnabledUsers}/${summary.auth.totalUsers})`
                  : 'Loading…'
              }
              footer={
                summary
                  ? `${summary.auth.passkeyEnabledUsers} users have passkeys; verified email is always required`
                  : undefined
              }
            />
            <SummaryCard
              title="File Inspection"
              description="Attachment and document inspection outcomes from the built-in inspection pipeline."
              value={
                summary
                  ? `${summary.scanner.totalScans} inspected, ${summary.scanner.quarantinedCount} quarantined, ${summary.scanner.rejectedCount} rejected`
                  : 'Loading…'
              }
              footer={
                summary?.scanner.lastScanAt
                  ? `Last inspection ${new Date(summary.scanner.lastScanAt).toLocaleString()}`
                  : 'No inspection events recorded yet'
              }
            />
            <SummaryCard
              title="Audit Integrity"
              description="Hash-chain failure signal from the audit subsystem."
              value={summary ? `${summary.audit.integrityFailures} integrity failures` : 'Loading…'}
              footer={
                summary?.audit.lastEventAt
                  ? `Last audit event ${new Date(summary.audit.lastEventAt).toLocaleString()}`
                  : 'No audit activity yet'
              }
            />
            <SummaryCard
              title="Retention Jobs"
              description="Latest retention or cleanup execution status."
              value={
                summary?.retention.lastJobStatus
                  ? summary.retention.lastJobStatus
                  : 'No retention job recorded'
              }
              footer={
                summary?.retention.lastJobAt
                  ? `Last run ${new Date(summary.retention.lastJobAt).toLocaleString()}`
                  : undefined
              }
            />
            <SummaryCard
              title="Telemetry"
              description="External telemetry posture for the regulated baseline."
              value={
                summary
                  ? summary.telemetry.sentryApproved
                    ? 'Sentry approved'
                    : 'Sentry blocked by default'
                  : 'Loading…'
              }
              footer={
                summary
                  ? summary.telemetry.sentryEnabled
                    ? 'Telemetry sink configured with explicit approval'
                    : 'No approved telemetry sink active'
                  : undefined
              }
            />
            <SummaryCard
              title="Session Policy"
              description="Short-lived verification posture applied across the app."
              value={
                summary
                  ? `${summary.sessions.freshWindowMinutes} minute step-up window`
                  : 'Loading…'
              }
              footer={
                summary
                  ? `${summary.sessions.sessionExpiryHours}h sessions, ${summary.sessions.temporaryLinkTtlMinutes} minute temporary links`
                  : undefined
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Active Controls"
              description="Controls currently tracked in the active register."
              value={`${controlSummary.totalControls}`}
              footer={`Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`}
            />
            <SummaryCard
              title="Implemented"
              description="Controls currently implemented directly by the platform."
              value={`${controlSummary.byStatus['platform-enforced']}`}
              footer={`${controlSummary.byStatus['shared-responsibility']} shared responsibility controls`}
            />
            <SummaryCard
              title="Evidence Health"
              description="Most recent evidence status across the active set."
              value={`${controlSummary.byEvidence.pass} pass / ${controlSummary.byEvidence.warning} warning`}
              footer={`${controlSummary.byEvidence.missing} missing evidence controls`}
            />
            <SummaryCard
              title="Review Queue"
              description="Controls that still need explicit review or follow-up."
              value={`${controlSummary.overdueReviewCount}`}
              footer={`${ACTIVE_CONTROL_REGISTER.controls.length - controlSummary.overdueReviewCount} reviewed`}
            />
          </div>
        </TabsContent>

        <TabsContent value="controls" className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Control Register</h2>
            <p className="text-sm text-muted-foreground">
              Active control register with framework mappings, evidence posture, ownership, and
              shared responsibility boundaries.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Active Controls"
              description="Controls currently tracked in the active register."
              value={`${controlSummary.totalControls}`}
              footer={`Generated ${new Date(ACTIVE_CONTROL_REGISTER.generatedAt).toLocaleDateString()}`}
            />
            <SummaryCard
              title="Implemented"
              description="Controls currently implemented directly by the platform."
              value={`${controlSummary.byStatus['platform-enforced']}`}
              footer={`${controlSummary.byStatus['shared-responsibility']} shared responsibility controls`}
            />
            <SummaryCard
              title="Evidence Health"
              description="Most recent evidence status across the active set."
              value={`${controlSummary.byEvidence.pass} pass / ${controlSummary.byEvidence.warning} warning`}
              footer={`${controlSummary.byEvidence.missing} missing evidence controls`}
            />
            <SummaryCard
              title="Review Queue"
              description="Controls that still need explicit review or follow-up."
              value={`${controlSummary.overdueReviewCount}`}
              footer={`${ACTIVE_CONTROL_REGISTER.controls.length - controlSummary.overdueReviewCount} reviewed`}
            />
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
              <p className="text-sm text-muted-foreground whitespace-nowrap">
                {controlPagination.total} matches
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <TableFilter<'all' | ControlStatus>
                  value={statusFilter}
                  options={statusOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ status: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by status"
                />
                <TableFilter<string>
                  value={familyFilter}
                  options={familyOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ family: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by family"
                />
                <TableFilter<'all' | EvidenceStatus>
                  value={evidenceFilter}
                  options={evidenceOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ evidence: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by evidence status"
                />
                <TableFilter<'all' | 'reviewed' | 'review-overdue'>
                  value={reviewFilter}
                  options={reviewOptions}
                  onValueChange={(value) => {
                    updateControlSearch({ review: value, page: 1 });
                  }}
                  className="shrink-0"
                  ariaLabel="Filter controls by review status"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
              <TableSearch
                initialValue={controlSearchTerm}
                onSearch={(value) => {
                  updateControlSearch({ search: value, page: 1 });
                }}
                placeholder="Search by control, family, owner, or statement"
                isSearching={false}
                className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
                ariaLabel="Search controls"
              />
              <ExportButton
                onExport={handleExportControls}
                isLoading={isExportingControls}
                disabled={sortedControls.length === 0}
                label="Export controls to Excel"
              />
            </div>
          </div>

          <DataTable<ActiveControlRecord, (typeof controlColumns)[number]>
            data={paginatedControls}
            columns={controlColumns}
            pagination={controlPagination}
            searchParams={controlSearchParams}
            isLoading={false}
            onPageChange={handleControlPageChange}
            onPageSizeChange={handleControlPageSizeChange}
            onRowClick={(control) => {
              updateControlSearch({ selectedControl: control.internalControlId });
            }}
            emptyMessage="No controls matched the current filters."
          />
        </TabsContent>

        <TabsContent value="evidence" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Evidence Report</CardTitle>
              <CardDescription>
                Generate a JSON evidence snapshot suitable for internal review and export.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleGenerateReport} disabled={isGenerating}>
                {isGenerating ? 'Generating…' : 'Generate evidence report'}
              </Button>
              {report ? (
                <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
                  {report}
                </pre>
              ) : null}
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
              {evidenceReports?.length ? (
                evidenceReports.map((item) => (
                  <div
                    key={item.id}
                    className="space-y-3 rounded-lg border p-4"
                    data-selected={selectedReportId === item.id}
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
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyReportAction !== null}
                          onClick={() => {
                            void handleReviewReport(item.id, 'reviewed');
                          }}
                        >
                          {busyReportAction === `${item.id}:reviewed` ? 'Saving…' : 'Mark reviewed'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busyReportAction !== null}
                          onClick={() => {
                            void handleReviewReport(item.id, 'needs_follow_up');
                          }}
                        >
                          {busyReportAction === `${item.id}:needs_follow_up`
                            ? 'Saving…'
                            : 'Needs follow-up'}
                        </Button>
                        <Button
                          type="button"
                          disabled={busyReportAction !== null}
                          onClick={() => {
                            void handleExportReport(item.id);
                          }}
                        >
                          {busyReportAction === `${item.id}:export`
                            ? 'Exporting…'
                            : 'Export bundle'}
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={reviewNotes[item.id] ?? item.reviewNotes ?? ''}
                      onChange={(event) => {
                        setReviewNotes((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }));
                      }}
                      placeholder="Reviewer notes"
                    />
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No evidence reports generated yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors">
          <Card>
            <CardHeader>
              <CardTitle>Vendor Boundary</CardTitle>
              <CardDescription>
                Approved outbound integrations, allowed data classes, and environment boundaries.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.vendors.map((vendor) => (
                <div key={vendor.vendor} className="rounded-md border px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="font-medium">{vendor.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        Data classes: {vendor.allowedDataClasses.join(', ')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Environments: {vendor.allowedEnvironments.join(', ')}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {vendor.approved
                        ? vendor.approvedByDefault
                          ? 'Approved by default'
                          : `Approved via ${vendor.approvalEnvVar}`
                        : `Blocked until ${vendor.approvalEnvVar ?? 'approved'}`}
                    </p>
                  </div>
                </div>
              )) ?? <p className="text-sm text-muted-foreground">Loading vendor posture…</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Sheet
        open={selectedControl !== null}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateControlSearch({ selectedControl: undefined });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedControl ? <ControlDetailSheet control={selectedControl} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ControlCell({ control }: { control: ActiveControlRecord }) {
  return (
    <div className="min-w-0 py-1">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-left">
              <p className="font-medium text-foreground">
                {control.nist80053Id} {control.title}
              </p>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-md">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Ownership
                </p>
                <p className="text-sm font-medium">{control.owner}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Implementation summary
                </p>
                <p className="text-xs leading-relaxed">{control.implementationSummary}</p>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function ControlStatusCell({ control }: { control: ActiveControlRecord }) {
  const badge = (
    <Badge variant={getControlStatusBadgeVariant(control.status)}>
      {formatControlStatus(control.status)}
    </Badge>
  );

  return (
    <div className="space-y-2 py-1">
      {control.sharedResponsibilityNotes ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-sm">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Responsibility notes
                </p>
                <p className="text-xs leading-relaxed">{control.sharedResponsibilityNotes}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        badge
      )}
    </div>
  );
}

function FrameworkSummaryCell({ control }: { control: ActiveControlRecord }) {
  const frameworkSummaries = [
    {
      label: 'HIPAA',
      count: control.mappings.hipaa.length,
      values: control.mappings.hipaa.map(
        (mapping) => `${mapping.citation}${mapping.title ? ` · ${mapping.title}` : ''}`,
      ),
    },
    {
      label: 'CSF',
      count: control.mappings.csf20.length,
      values: control.mappings.csf20.map(
        (mapping) => `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
      ),
    },
    {
      label: 'NIST 800-66r2',
      count: control.mappings.nist80066.length,
      values: control.mappings.nist80066.map((mapping) => mapping.referenceId),
    },
    {
      label: 'SOC 2',
      count: control.mappings.soc2.length,
      values: control.mappings.soc2.map(
        (mapping) => `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
      ),
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="py-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        {frameworkSummaries.map((item) => (
          <TooltipProvider key={item.label} delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full border px-2 py-1 text-xs font-medium text-foreground"
                >
                  {item.label} ({item.count})
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-md">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                    {item.label} mappings
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-left text-xs leading-relaxed">
                    {item.values.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    </div>
  );
}

function EvidenceCell({ control }: { control: ActiveControlRecord }) {
  return (
    <div className="space-y-2 py-1">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={getEvidenceBadgeVariant(control.evidence.latestEvidenceStatus)}>
              {formatEvidenceStatus(control.evidence.latestEvidenceStatus)} (
              {control.evidence.evidenceCount})
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" className="max-w-xs">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-foreground/75">
                Evidence sources
              </p>
              <ul className="list-disc space-y-1 pl-4 text-left text-[11px] leading-relaxed">
                {control.evidence.evidenceSources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function ReviewCell({ control }: { control: ActiveControlRecord }) {
  return (
    <div className="py-1">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={control.reviewStatus === 'reviewed' ? 'default' : 'outline'}>
              {control.reviewStatus === 'reviewed' ? 'Reviewed' : 'Needs review'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-sm">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                Review status
              </p>
              <p className="text-xs leading-relaxed">
                {control.lastReviewedAt
                  ? `Reviewed ${new Date(control.lastReviewedAt).toLocaleDateString()}`
                  : 'No completed review recorded'}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function ControlDetailSheet({ control }: { control: ActiveControlRecord }) {
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {control.nist80053Id} {control.title}
        </SheetTitle>
        <SheetDescription>{control.familyTitle}</SheetDescription>
      </SheetHeader>

      <div className="space-y-6 p-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={getControlStatusBadgeVariant(control.status)}>
            {formatControlStatus(control.status)}
          </Badge>
          <Badge variant={getEvidenceBadgeVariant(control.evidence.latestEvidenceStatus)}>
            {formatEvidenceStatus(control.evidence.latestEvidenceStatus)} (
            {control.evidence.evidenceCount})
          </Badge>
          <Badge variant={control.reviewStatus === 'reviewed' ? 'default' : 'outline'}>
            {control.reviewStatus === 'reviewed' ? 'Reviewed' : 'Needs review'}
          </Badge>
        </div>

        <DetailSection title="Ownership">
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailItem label="Owner" value={control.owner} />
            <DetailItem
              label="Last reviewed"
              value={
                control.lastReviewedAt
                  ? new Date(control.lastReviewedAt).toLocaleDateString()
                  : 'No completed review recorded'
              }
            />
          </dl>
        </DetailSection>

        <DetailSection title="Implementation summary">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {control.implementationSummary}
          </p>
        </DetailSection>

        <DetailSection title="Responsibility notes">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {control.sharedResponsibilityNotes ?? 'No additional notes recorded.'}
          </p>
        </DetailSection>

        <DetailSection title="Evidence sources">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {control.evidence.evidenceSources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </DetailSection>

        <DetailSection title="Framework mappings">
          <div className="space-y-4">
            <DetailList
              title="HIPAA"
              values={control.mappings.hipaa.map(
                (mapping) => `${mapping.citation}${mapping.title ? ` · ${mapping.title}` : ''}`,
              )}
            />
            <DetailList
              title="CSF 2.0"
              values={control.mappings.csf20.map(
                (mapping) =>
                  `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
            <DetailList
              title="NIST 800-66r2"
              values={control.mappings.nist80066.map(
                (mapping) => `${mapping.referenceId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
            <DetailList
              title="SOC 2"
              values={control.mappings.soc2.map(
                (mapping) => `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
          </div>
        </DetailSection>
      </div>
    </>
  );
}

function DetailSection(props: { children: ReactNode; title: string }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </dt>
      <dd className="text-sm text-foreground">{props.value}</dd>
    </div>
  );
}

function DetailList(props: { title: string; values: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.title}
      </p>
      {props.values.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {props.values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No mappings available.</p>
      )}
    </div>
  );
}

function formatEvidenceStatus(status: EvidenceStatus) {
  switch (status) {
    case 'pass':
      return 'Pass';
    case 'warning':
      return 'Warning';
    case 'missing':
      return 'Missing';
    case 'fail':
      return 'Fail';
    case 'not-tested':
      return 'Not tested';
  }
}

function formatControlStatus(status: ControlStatus) {
  return getControlStatusDisplayLabel(status);
}

function getEvidenceBadgeVariant(
  status: EvidenceStatus,
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'pass':
      return 'default';
    case 'warning':
      return 'secondary';
    case 'missing':
    case 'not-tested':
      return 'outline';
    case 'fail':
      return 'destructive';
  }
}

function getControlStatusBadgeVariant(
  status: ControlStatus,
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'platform-enforced':
      return 'default';
    case 'shared-responsibility':
      return 'secondary';
    case 'partial':
      return 'outline';
    case 'operator-owned':
      return 'destructive';
    case 'not-applicable':
      return 'outline';
  }
}

function SummaryCard(props: {
  description: string;
  footer?: string;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold">{props.value}</div>
        {props.footer ? <p className="text-sm text-muted-foreground">{props.footer}</p> : null}
      </CardContent>
    </Card>
  );
}
