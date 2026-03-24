import type { ColumnDef } from '@tanstack/react-table';
import {
  DataTable,
  TableFilter,
  type TableFilterOption,
  TableSearch,
} from '~/components/data-table';
import { ExportButton } from '~/components/ui/export-button';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import type { SecurityControlWorkspaceSummary } from '~/features/security/types';
import {
  type ControlSummary,
  SecurityControlSummaryGrid,
} from '~/features/security/components/tabs/AdminSecurityTabShared';

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
