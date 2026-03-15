import { api } from '@convex/_generated/api';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import {
  createSortableHeader,
  DataTable,
  formatTableDate,
  TableFilter,
  type TableFilterOption,
  TableSearch,
} from '~/components/data-table';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { getServerFunctionErrorMessage } from '~/features/organizations/lib/organization-session';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { getOrganizationBreadcrumbName } from '~/features/organizations/lib/organization-breadcrumb-state';
import type {
  OrganizationAuditEventType,
  OrganizationAuditSortField,
  OrganizationAuditSearchParams,
} from '~/features/organizations/lib/organization-management';

const AUDIT_EVENT_FILTER_OPTIONS: TableFilterOption<'all' | OrganizationAuditEventType>[] = [
  { label: 'All events', value: 'all' },
  { label: 'Organization created', value: 'organization_created' },
  { label: 'Organization updated', value: 'organization_updated' },
  { label: 'Member added', value: 'member_added' },
  { label: 'Member removed', value: 'member_removed' },
  { label: 'Member role updated', value: 'member_role_updated' },
  { label: 'Member suspended', value: 'member_suspended' },
  { label: 'Member deactivated', value: 'member_deactivated' },
  { label: 'Member reactivated', value: 'member_reactivated' },
  { label: 'Invitation sent', value: 'member_invited' },
  { label: 'Invitation accepted', value: 'invite_accepted' },
  { label: 'Invitation rejected', value: 'invite_rejected' },
  { label: 'Invitation cancelled', value: 'invite_cancelled' },
  { label: 'Domain added', value: 'domain_added' },
  { label: 'Domain verified', value: 'domain_verification_succeeded' },
  { label: 'Domain verification failed', value: 'domain_verification_failed' },
  { label: 'Domain token regenerated', value: 'domain_verification_token_regenerated' },
  { label: 'Domain removed', value: 'domain_removed' },
  { label: 'Policies updated', value: 'organization_policy_updated' },
  { label: 'Enterprise auth mode updated', value: 'enterprise_auth_mode_updated' },
  { label: 'Enterprise login succeeded', value: 'enterprise_login_succeeded' },
  { label: 'SCIM token generated', value: 'enterprise_scim_token_generated' },
  { label: 'SCIM token revoked', value: 'enterprise_scim_token_deleted' },
  { label: 'SCIM member deprovisioned', value: 'scim_member_deprovisioned' },
  { label: 'SCIM member reactivated', value: 'scim_member_reactivated' },
  { label: 'SCIM member deprovision failed', value: 'scim_member_deprovision_failed' },
  { label: 'Bulk invite revoked', value: 'bulk_invite_revoked' },
  { label: 'Bulk invite resent', value: 'bulk_invite_resent' },
  { label: 'Bulk member removed', value: 'bulk_member_removed' },
];

type OrganizationAuditRow = {
  id: string;
  eventType: string;
  label: string;
  actorLabel?: string;
  targetLabel?: string;
  summary?: string;
  userId?: string;
  organizationId?: string;
  identifier?: string;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
};

export function OrganizationAuditPage({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: OrganizationAuditSearchParams;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const exportAuditCsv = useAction(api.organizationManagement.exportOrganizationAuditCsv);
  const [isExporting, setIsExporting] = useState(false);
  const response = useQuery(api.organizationManagement.listOrganizationAuditEvents, {
    slug,
    page: searchParams.page,
    pageSize: searchParams.pageSize,
    sortBy: searchParams.sortBy,
    sortOrder: searchParams.sortOrder,
    search: searchParams.search,
    eventType: searchParams.eventType as never,
  });
  const isLoading = response === undefined;
  const optimisticOrganizationName = getOrganizationBreadcrumbName(location.state, slug);
  const organizationName =
    response?.organization.name ?? optimisticOrganizationName ?? 'Loading organization';
  const auditRows: OrganizationAuditRow[] = response?.events ?? [];

  const handleSearchChange = (search: string) => {
    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        search,
      },
    });
  };

  const handleEventTypeChange = (eventType: 'all' | OrganizationAuditEventType) => {
    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        eventType,
      },
    });
  };

  const handleSorting = useCallback((columnId: OrganizationAuditSortField) => {
    const nextSortOrder =
      searchParams.sortBy === columnId && searchParams.sortOrder === 'asc' ? 'desc' : 'asc';

    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        sortBy: columnId,
        sortOrder: nextSortOrder,
      },
    });
  }, [navigate, searchParams, slug]);

  const handlePageChange = (page: number) => {
    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page,
      },
    });
  };

  const handlePageSizeChange = (pageSize: number) => {
    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        pageSize,
      },
    });
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const result = await exportAuditCsv({
        slug,
        sortBy: searchParams.sortBy,
        sortOrder: searchParams.sortOrder,
        eventType: searchParams.eventType as never,
        search: searchParams.search,
      });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast('Audit log exported.', 'success');
    } catch (error) {
      showToast(getServerFunctionErrorMessage(error, 'Failed to export audit log'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const columns = useMemo<ColumnDef<OrganizationAuditRow, unknown>[]>(
    () => [
      {
        accessorKey: 'label',
        header: createSortableHeader('Event', 'label', searchParams, handleSorting),
        cell: ({ row }) => <span className="text-sm font-medium text-foreground">{row.original.label}</span>,
      },
      {
        accessorKey: 'actorLabel',
        header: () => <div>Actor</div>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.actorLabel ?? row.original.userId ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'targetLabel',
        header: () => <div>Target</div>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.targetLabel ?? row.original.identifier ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: createSortableHeader('Created', 'createdAt', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatTableDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'details',
        header: () => <div>Details</div>,
        cell: ({ row }) => (
          <div className="max-w-md text-sm text-muted-foreground">
            <div>{row.original.eventType.replaceAll('_', ' ')}</div>
            {row.original.ipAddress || row.original.userAgent ? (
              <div className="mt-1">
                {row.original.ipAddress ? `IP: ${row.original.ipAddress}` : null}
                {row.original.ipAddress && row.original.userAgent ? ' · ' : null}
                {row.original.userAgent ? `Agent: ${row.original.userAgent}` : null}
              </div>
            ) : null}
            {row.original.metadata ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-foreground">View metadata</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {JSON.stringify(row.original.metadata, null, 2)}
                </pre>
              </details>
            ) : null}
            {row.original.summary ? (
              <div className="mt-2 text-xs text-foreground">{row.original.summary}</div>
            ) : null}
          </div>
        ),
      },
    ],
    [handleSorting, searchParams],
  );

  const content = useMemo(() => {
    if (response === null) {
      return (
        <div className="rounded-xl border border-border/60 bg-background px-6 py-5">
          <h2 className="text-lg font-semibold text-foreground">Audit access required</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization owners, organization admins, and site admins can review audit history.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TableFilter
            value={searchParams.eventType}
            options={AUDIT_EVENT_FILTER_OPTIONS}
            onValueChange={handleEventTypeChange}
            className="sm:w-44"
            ariaLabel="Filter audit events by type"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end sm:flex-1">
            <TableSearch
              initialValue={searchParams.search}
              onSearch={handleSearchChange}
              isSearching={response === undefined}
              placeholder="Search by user, identifier, or metadata"
              className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
              ariaLabel="Search organization audit events"
            />
            <Button type="button" variant="outline" onClick={handleExport} disabled={isExporting}>
              {isExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span className="sr-only">Export CSV</span>
            </Button>
          </div>
        </div>

        <DataTable
          data={auditRows}
          columns={columns}
          pagination={
            response?.pagination ?? {
              page: searchParams.page,
              pageSize: searchParams.pageSize,
              total: 0,
              totalPages: 0,
            }
          }
          searchParams={searchParams}
          isLoading={isLoading}
          isFetching={response === undefined}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          emptyMessage="No audit events matched the current filters."
          loadingSkeleton={
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading audit history...
            </div>
          }
        />
      </div>
    );
  }, [
    auditRows,
    columns,
    handleExport,
    isExporting,
    isLoading,
    organizationName,
    response,
    searchParams,
    searchParams.eventType,
    searchParams.search,
  ]);

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        title={organizationName}
        description="Review organization-member activity and export the audit trail."
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />
      {content}
    </div>
  );
}
