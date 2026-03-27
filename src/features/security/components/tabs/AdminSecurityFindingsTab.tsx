import { useMemo } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { HelpTip } from '~/features/security/components/HelpTip';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatFindingDisposition,
  formatFindingSeverity,
  formatFindingType,
  getFindingDispositionBadgeVariant,
  getFindingSeverityBadgeVariant,
} from '~/features/security/formatters';
import type { SecurityFindingListItem } from '~/features/security/types';

const DISPOSITION_OPTIONS: Array<
  TableFilterOption<'all' | SecurityFindingListItem['disposition']>
> = [
  { label: 'All dispositions', value: 'all' },
  { label: 'Pending review', value: 'pending_review' },
  { label: 'Investigating', value: 'investigating' },
  { label: 'Accepted risk', value: 'accepted_risk' },
  { label: 'False positive', value: 'false_positive' },
  { label: 'Resolved', value: 'resolved' },
];

const SEVERITY_OPTIONS: Array<TableFilterOption<'all' | SecurityFindingListItem['severity']>> = [
  { label: 'All severities', value: 'all' },
  { label: 'Critical', value: 'critical' },
  { label: 'Warning', value: 'warning' },
  { label: 'Info', value: 'info' },
];

const FOLLOW_UP_OPTIONS: Array<
  TableFilterOption<'all' | 'has_follow_up' | 'no_follow_up' | 'overdue_follow_up'>
> = [
  { label: 'All follow-up states', value: 'all' },
  { label: 'Has follow-up', value: 'has_follow_up' },
  { label: 'No follow-up', value: 'no_follow_up' },
  { label: 'Overdue follow-up', value: 'overdue_follow_up' },
];

const FINDING_TYPE_OPTIONS: Array<
  TableFilterOption<'all' | SecurityFindingListItem['findingType']>
> = [
  { label: 'All finding types', value: 'all' },
  { label: 'Archive health', value: 'audit_archive_health' },
  { label: 'Request context gaps', value: 'audit_request_context_gaps' },
  { label: 'Audit integrity', value: 'audit_integrity_failures' },
  { label: 'Scan quarantines', value: 'document_scan_quarantines' },
  { label: 'Scan rejections', value: 'document_scan_rejections' },
  { label: 'Release validation', value: 'release_security_validation' },
];

export function AdminSecurityFindingsTab(props: {
  busyAction: string | null;
  busyFindingKey: string | null;
  showAdvancedFilters: boolean;
  findingDispositionFilter: 'all' | SecurityFindingListItem['disposition'];
  findingFollowUpFilter: 'all' | 'has_follow_up' | 'no_follow_up' | 'overdue_follow_up';
  findingSearch: string;
  findingSeverityFilter: 'all' | SecurityFindingListItem['severity'];
  findingStatusFilter: 'all' | SecurityFindingListItem['status'];
  findingTypeFilter: 'all' | SecurityFindingListItem['findingType'];
  findingCustomerSummaries: Record<string, string>;
  findingDispositions: Record<
    SecurityFindingListItem['findingKey'],
    SecurityFindingListItem['disposition']
  >;
  findingNotes: Record<string, string>;
  findings: SecurityFindingListItem[] | undefined;
  summary: {
    activeFollowUpCount: number | undefined;
    openCount: number | undefined;
    overdueFollowUpCount: number | undefined;
    reviewPendingCount: number | undefined;
    totalCount: number | undefined;
  };
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: (selectedReviewRun?: string) => void;
  onChangeShowAdvancedFilters: (value: boolean) => void;
  onChangeFindingDispositionFilter: (value: 'all' | SecurityFindingListItem['disposition']) => void;
  onChangeFindingFollowUpFilter: (
    value: 'all' | 'has_follow_up' | 'no_follow_up' | 'overdue_follow_up',
  ) => void;
  onChangeFindingSearch: (value: string) => void;
  onChangeFindingSeverityFilter: (value: 'all' | SecurityFindingListItem['severity']) => void;
  onChangeFindingStatusFilter: (value: 'all' | SecurityFindingListItem['status']) => void;
  onChangeFindingTypeFilter: (value: 'all' | SecurityFindingListItem['findingType']) => void;
  onOpenFinding: (findingKey: SecurityFindingListItem['findingKey']) => void;
  onOpenFindingFollowUp: (finding: SecurityFindingListItem) => Promise<void>;
  onReviewFinding: (findingKey: SecurityFindingListItem['findingKey']) => Promise<void>;
  setFindingCustomerSummaries: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setFindingDispositions: React.Dispatch<
    React.SetStateAction<
      Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
    >
  >;
  setFindingNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const advancedFilterCount = useMemo(
    () =>
      [
        props.findingSeverityFilter !== 'all',
        props.findingFollowUpFilter !== 'all',
        props.findingTypeFilter !== 'all',
      ].filter(Boolean).length,
    [props.findingSeverityFilter, props.findingFollowUpFilter, props.findingTypeFilter],
  );

  return (
    <>
      <AdminSecurityTabHeader
        title="Findings"
        description="Open gaps, disposition notes, and review follow-up entry points for provider security posture."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminSecuritySummaryCard
          title="Tracked findings"
          description="Items currently in review scope."
          value={renderCardStatValue(props.summary.totalCount)}
          footer={
            props.summary.totalCount !== undefined
              ? `${props.summary.openCount ?? 0} open findings`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Open findings"
          description="Findings still awaiting provider action."
          value={renderCardStatValue(props.summary.openCount)}
          footer={
            props.summary.openCount !== undefined
              ? `${props.summary.reviewPendingCount ?? 0} pending disposition`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title={
            <>
              Pending disposition
              <HelpTip term="disposition" />
            </>
          }
          description="Findings without a recorded decision."
          value={renderCardStatValue(props.summary.reviewPendingCount)}
          footer={
            props.summary.reviewPendingCount !== undefined
              ? `${props.summary.overdueFollowUpCount ?? 0} overdue follow-ups`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Active follow-up"
          description="Findings with tracked remediation."
          value={renderCardStatValue(props.summary.activeFollowUpCount)}
          footer={
            props.summary.activeFollowUpCount !== undefined
              ? `${props.summary.overdueFollowUpCount ?? 0} overdue`
              : undefined
          }
        />
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {props.findings?.length ?? 0} matches
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter<'all' | SecurityFindingListItem['disposition']>
              value={props.findingDispositionFilter}
              options={DISPOSITION_OPTIONS}
              onValueChange={props.onChangeFindingDispositionFilter}
              className="shrink-0"
              ariaLabel="Filter findings by disposition"
            />
            {props.showAdvancedFilters && (
              <>
                <TableFilter<'all' | SecurityFindingListItem['severity']>
                  value={props.findingSeverityFilter}
                  options={SEVERITY_OPTIONS}
                  onValueChange={props.onChangeFindingSeverityFilter}
                  className="shrink-0"
                  ariaLabel="Filter findings by severity"
                />
                <TableFilter<'all' | 'has_follow_up' | 'no_follow_up' | 'overdue_follow_up'>
                  value={props.findingFollowUpFilter}
                  options={FOLLOW_UP_OPTIONS}
                  onValueChange={props.onChangeFindingFollowUpFilter}
                  className="shrink-0"
                  ariaLabel="Filter findings by follow-up"
                />
                <TableFilter<'all' | SecurityFindingListItem['findingType']>
                  value={props.findingTypeFilter}
                  options={FINDING_TYPE_OPTIONS}
                  onValueChange={props.onChangeFindingTypeFilter}
                  className="shrink-0"
                  ariaLabel="Filter findings by type"
                />
              </>
            )}
            <Button
              type="button"
              variant={advancedFilterCount > 0 && !props.showAdvancedFilters ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => {
                props.onChangeShowAdvancedFilters(!props.showAdvancedFilters);
              }}
            >
              {props.showAdvancedFilters
                ? 'Fewer filters'
                : `More filters${advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ''}`}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
          <TableSearch
            initialValue={props.findingSearch}
            onSearch={props.onChangeFindingSearch}
            placeholder="Search findings by title, source, notes, or summary"
            isSearching={false}
            className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
            ariaLabel="Search findings"
          />
        </div>
      </div>

      <div className="space-y-4">
        {props.findings?.length ? (
          <div className="space-y-3">
            {props.findings.map((finding) => {
              const currentDisposition =
                props.findingDispositions[finding.findingKey] ?? finding.disposition;
              const currentNotes =
                props.findingNotes[finding.findingKey] ?? finding.internalNotes ?? '';
              const currentCustomerSummary =
                props.findingCustomerSummaries[finding.findingKey] ?? finding.customerSummary ?? '';
              const isDirty =
                currentDisposition !== finding.disposition ||
                currentNotes !== (finding.internalNotes ?? '') ||
                currentCustomerSummary !== (finding.customerSummary ?? '');

              return (
                <div
                  key={finding.findingKey}
                  className="flex flex-col gap-3 rounded-xl border bg-background p-4 lg:flex-row lg:items-start lg:justify-between"
                >
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      props.onOpenFinding(finding.findingKey);
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold">{finding.title}</p>
                        <Badge variant={getFindingSeverityBadgeVariant(finding.severity)}>
                          {formatFindingSeverity(finding.severity)}
                        </Badge>
                        <Badge variant={getFindingDispositionBadgeVariant(currentDisposition)}>
                          {formatFindingDisposition(currentDisposition)}
                        </Badge>
                        {finding.followUpOverdue && <Badge variant="destructive">Overdue</Badge>}
                      </div>
                      <p className="max-w-3xl text-sm text-muted-foreground">
                        {finding.description}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <p>{formatFindingType(finding.findingType)}</p>
                        <p>Source: {finding.sourceLabel}</p>
                        <p>Last observed {new Date(finding.lastObservedAt).toLocaleString()}</p>
                        {finding.relatedControls.length > 0 && (
                          <p>{finding.relatedControls.length} linked controls</p>
                        )}
                        {finding.activeFollowUp && (
                          <p>Follow-up: {finding.activeFollowUp.status.replaceAll('_', ' ')}</p>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={props.busyFindingKey !== null}
                      onClick={() => {
                        void props.onReviewFinding(finding.findingKey);
                      }}
                    >
                      {props.busyFindingKey === finding.findingKey
                        ? 'Saving…'
                        : isDirty
                          ? 'Save changes'
                          : 'Save review'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        props.onOpenFinding(finding.findingKey);
                      }}
                    >
                      View details
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No retained findings are available for review yet.
          </p>
        )}
      </div>
    </>
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
