import { useMemo } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import {
  formatVendorDecisionSummary,
  getVendorGovernanceState,
  getVendorPrimaryStatus,
} from '~/features/security/formatters';
import type { VendorWorkspace } from '~/features/security/types';

type VendorReviewStatusFilter = 'all' | 'current' | 'due_soon' | 'overdue' | 'not_reviewed';

const VENDOR_STATUS_OPTIONS: Array<TableFilterOption<VendorReviewStatusFilter>> = [
  { label: 'All statuses', value: 'all' },
  { label: 'Current', value: 'current' },
  { label: 'Due soon', value: 'due_soon' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Not reviewed', value: 'not_reviewed' },
];

export function AdminSecurityVendorsTab(props: {
  busyVendorKey: string | null;
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: () => void;
  onOpenVendor: (vendorKey: VendorWorkspace['vendor']) => void;
  vendorWorkspaces: VendorWorkspace[] | undefined;
  vendorReviewStatus: VendorReviewStatusFilter;
  vendorSearch: string;
  onChangeVendorReviewStatus: (value: VendorReviewStatusFilter) => void;
  onChangeVendorSearch: (value: string) => void;
}) {
  const filteredVendors = useMemo(() => {
    const vendors = props.vendorWorkspaces;
    if (!vendors) {
      return vendors;
    }

    const searchTerm = props.vendorSearch.trim().toLowerCase();
    return vendors.filter((vendor) => {
      if (props.vendorReviewStatus !== 'all' && vendor.reviewStatus !== props.vendorReviewStatus) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        vendor.title,
        vendor.summary ?? '',
        vendor.owner ?? '',
        vendor.allowedDataClasses.join(' '),
        vendor.allowedEnvironments.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    });
  }, [props.vendorWorkspaces, props.vendorReviewStatus, props.vendorSearch]);

  return (
    <>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {filteredVendors?.length ?? 0} matches
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TableFilter<VendorReviewStatusFilter>
              value={props.vendorReviewStatus}
              options={VENDOR_STATUS_OPTIONS}
              onValueChange={props.onChangeVendorReviewStatus}
              className="shrink-0"
              ariaLabel="Filter vendors by review status"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
          <TableSearch
            initialValue={props.vendorSearch}
            onSearch={props.onChangeVendorSearch}
            placeholder="Search by vendor, owner, data class, or environment"
            isSearching={false}
            className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
            ariaLabel="Search vendors"
          />
        </div>
      </div>

      <div className="space-y-4">
        {filteredVendors ? (
          <div className="space-y-3">
            {filteredVendors.map((vendor) => {
              const currentOwner = vendor.owner ?? '';
              const primaryStatus = getVendorPrimaryStatus(vendor);
              const governanceState = getVendorGovernanceState({
                controlCount: vendor.relatedControls.length,
                hasDraftReview: false,
                owner: currentOwner,
                reviewStatus: vendor.reviewStatus,
              });
              const decisionSummary = formatVendorDecisionSummary({
                controlCount: vendor.relatedControls.length,
                hasDraftReview: false,
                lastReviewedAt: vendor.lastReviewedAt,
                owner: currentOwner,
                reviewStatus: vendor.reviewStatus,
                vendor,
              });

              return (
                <div
                  key={vendor.vendor}
                  className="flex flex-col gap-3 rounded-xl border bg-background p-4 lg:flex-row lg:items-start lg:justify-between"
                >
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      props.onOpenVendor(vendor.vendor);
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold">{vendor.title}</p>
                        <Badge variant={primaryStatus.variant}>{primaryStatus.label}</Badge>
                        <Badge variant={governanceState.variant}>{governanceState.label}</Badge>
                      </div>
                      <p className="max-w-3xl text-sm text-muted-foreground">{decisionSummary}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <p>{vendor.allowedDataClasses.length} data classes</p>
                        <p>{vendor.allowedEnvironments.length} environments</p>
                        <p>{vendor.relatedControls.length} linked controls</p>
                        <p>
                          {vendor.nextReviewAt
                            ? `Next review ${new Date(vendor.nextReviewAt).toLocaleDateString()}`
                            : 'Review not scheduled'}
                        </p>
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        props.onOpenVendor(vendor.vendor);
                      }}
                    >
                      View
                    </Button>
                  </div>
                </div>
              );
            })}
            {filteredVendors.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No vendors matched the current filters.
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
            <Spinner className="size-5" />
            <span className="sr-only">Loading vendor posture</span>
          </div>
        )}
      </div>
    </>
  );
}
