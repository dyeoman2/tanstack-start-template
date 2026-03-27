import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useMemo } from 'react';
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
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatPolicySupportProgress,
  formatSupportStatus,
  getSupportBadgeVariant,
} from '~/features/security/formatters';
import type { SecurityPolicySummary } from '~/features/security/types';
import { cn } from '~/lib/utils';

type PolicyTableSortField = 'title' | 'support' | 'owner' | 'mappedControlCount' | 'nextReviewAt';

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
  const policies = useMemo(() => props.policies ?? [], [props.policies]);
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
    const query = props.searchTerm.trim().toLowerCase();

    return policies.filter((policy) => {
      if (props.supportFilter !== 'all' && policy.support !== props.supportFilter) {
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
  }, [policies, props.searchTerm, props.supportFilter]);
  const sortedPolicies = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sorted = [...filteredPolicies];

    sorted.sort((left, right) => {
      let result = 0;

      switch (props.sortBy) {
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

      return props.sortOrder === 'asc' ? result : -result;
    });

    return sorted;
  }, [filteredPolicies, props.sortBy, props.sortOrder]);
  const totalPolicies = sortedPolicies.length;
  const policySearchParams = useMemo(
    () => ({
      page: 1,
      pageSize: totalPolicies || policies.length || 1,
      sortBy: props.sortBy,
      sortOrder: props.sortOrder,
    }),
    [policies.length, props.sortBy, props.sortOrder, totalPolicies],
  );
  const handlePolicySorting = useCallback(
    (columnId: PolicyTableSortField) => {
      props.updatePolicySearch({
        policySortBy: columnId,
        policySortOrder:
          props.sortBy === columnId ? (props.sortOrder === 'asc' ? 'desc' : 'asc') : 'asc',
      });
    },
    [props],
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
          const now = Date.now();
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          const isOverdue = policy.nextReviewAt !== null && policy.nextReviewAt < now;
          const isDueSoon =
            policy.nextReviewAt !== null && !isOverdue && policy.nextReviewAt < now + thirtyDays;

          return (
            <p
              className={cn(
                'py-1 text-sm font-medium',
                isOverdue && 'text-destructive',
                isDueSoon && 'text-amber-600 dark:text-amber-400',
              )}
            >
              {policy.nextReviewAt
                ? `${isOverdue ? 'Overdue · ' : isDueSoon ? 'Due soon · ' : ''}${formatTableDate(policy.nextReviewAt)}`
                : 'Unscheduled'}
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
            disabled={props.busySync}
            onClick={() => {
              void props.onSyncPolicies();
            }}
          >
            {props.busySync ? 'Syncing…' : 'Sync policy catalog'}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
          <p className="text-sm text-muted-foreground whitespace-nowrap">{totalPolicies} matches</p>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter<'all' | SecurityPolicySummary['support']>
              value={props.supportFilter}
              options={supportOptions}
              onValueChange={(value) => {
                props.updatePolicySearch({ policySupport: value });
              }}
              className="shrink-0"
              ariaLabel="Filter policies by support"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
          <TableSearch
            initialValue={props.searchTerm}
            onSearch={(value) => {
              props.updatePolicySearch({ policySearch: value });
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
        isLoading={props.policies === undefined}
        onRowClick={(policy) => {
          props.onOpenPolicy(policy.policyId);
        }}
        emptyMessage="No policies matched the current filters."
      />
    </>
  );
}
