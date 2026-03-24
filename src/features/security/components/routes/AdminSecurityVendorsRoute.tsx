import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityVendorsTab } from '~/features/security/components/tabs/AdminSecurityVendorsTab';
import {
  formatVendorDecisionSummary,
  formatVendorRuntimePosture,
  getVendorGovernanceState,
  getVendorPrimaryActionLabel,
  getVendorPrimaryStatus,
} from '~/features/security/formatters';
import type { SecurityVendorsSearch } from '~/features/security/search';
import type { VendorWorkspace } from '~/features/security/types';
import { renderCardStatValue } from '~/features/security/components/tabs/AdminSecurityTabShared';

export function AdminSecurityVendorsRoute(props: { search: SecurityVendorsSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl, navigateToReviews } = useSecurityNavigation();
  const vendorWorkspaces = useQuery(api.securityReports.listSecurityVendors, {}) as
    | VendorWorkspace[]
    | undefined;
  const reviewSecurityVendor = useMutation(api.securityReports.reviewSecurityVendor);
  const [vendorSummaries, setVendorSummaries] = useState<Record<string, string>>({});
  const [vendorOwners, setVendorOwners] = useState<Record<string, string>>({});
  const [busyVendorKey, setBusyVendorKey] = useState<string | null>(null);
  const selectedVendor = useMemo(
    () => vendorWorkspaces?.find((vendor) => vendor.vendor === props.search.selectedVendor) ?? null,
    [props.search.selectedVendor, vendorWorkspaces],
  );
  const vendorSummary = useMemo(() => {
    if (vendorWorkspaces === undefined) {
      return {
        currentCount: undefined,
        dueSoonCount: undefined,
        overdueCount: undefined,
        totalCount: undefined,
      };
    }

    const vendors = vendorWorkspaces;
    return {
      currentCount: vendors.filter((vendor) => vendor.reviewStatus === 'current').length,
      dueSoonCount: vendors.filter((vendor) => vendor.reviewStatus === 'due_soon').length,
      overdueCount: vendors.filter((vendor) => vendor.reviewStatus === 'overdue').length,
      totalCount: vendors.length,
    };
  }, [vendorWorkspaces]);

  const updateVendorSearch = useCallback(
    (selectedVendor: string | undefined) => {
      void navigate({
        search: {
          selectedVendor,
        },
        to: getSecurityPath('vendors'),
      });
    },
    [navigate],
  );

  const handleReviewVendor = useCallback(
    async (vendor: VendorWorkspace) => {
      setBusyVendorKey(vendor.vendor);
      try {
        await reviewSecurityVendor({
          owner: vendorOwners[vendor.vendor]?.trim() || undefined,
          summary: vendorSummaries[vendor.vendor]?.trim() || undefined,
          vendorKey: vendor.vendor,
        });
        showToast('Vendor review saved.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to save vendor review.',
          'error',
        );
      } finally {
        setBusyVendorKey(null);
      }
    },
    [reviewSecurityVendor, showToast, vendorOwners, vendorSummaries],
  );

  return (
    <>
      <AdminSecurityTabHeader
        title="Vendors"
        description="Runtime vendor posture, governance review cadence, follow-up context, and linked controls."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <AdminSecuritySummaryCard
          title="Tracked vendors"
          description="First-class vendor governance records linked to controls."
          value={renderCardStatValue(vendorSummary.totalCount)}
        />
        <AdminSecuritySummaryCard
          title="Current reviews"
          description="Vendors reviewed within the current 12-month cadence."
          value={renderCardStatValue(vendorSummary.currentCount)}
        />
        <AdminSecuritySummaryCard
          title="Due soon"
          description="Reviews approaching expiry but still current."
          value={renderCardStatValue(vendorSummary.dueSoonCount)}
        />
        <AdminSecuritySummaryCard
          title="Overdue"
          description="These block annual review finalization until renewed."
          value={renderCardStatValue(vendorSummary.overdueCount)}
        />
      </div>

      <AdminSecurityVendorsTab
        busyVendorKey={busyVendorKey}
        handleReviewVendor={handleReviewVendor}
        navigateToControl={navigateToControl}
        navigateToReviews={navigateToReviews}
        onOpenVendor={(vendorKey) => {
          updateVendorSearch(vendorKey);
        }}
        setVendorSummaries={setVendorSummaries}
        setVendorOwners={setVendorOwners}
        vendorSummaries={vendorSummaries}
        vendorOwners={vendorOwners}
        vendorWorkspaces={vendorWorkspaces}
      />

      <Sheet
        open={props.search.selectedVendor !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateVendorSearch(undefined);
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Vendor detail</SheetTitle>
            <SheetDescription>
              Review vendor posture, linked controls, review cadence, and follow-up linkage.
            </SheetDescription>
          </SheetHeader>
          {selectedVendor === null && props.search.selectedVendor ? (
            <DetailLoadingState label="Loading vendor detail" />
          ) : selectedVendor ? (
            (() => {
              const currentOwner =
                vendorOwners[selectedVendor.vendor] ?? selectedVendor.owner ?? '';
              const currentSummary =
                vendorSummaries[selectedVendor.vendor] ?? selectedVendor.summary ?? '';
              const isDirty =
                currentOwner !== (selectedVendor.owner ?? '') ||
                currentSummary !== (selectedVendor.summary ?? '');
              const primaryStatus = getVendorPrimaryStatus(selectedVendor);
              const governanceState = getVendorGovernanceState({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isDirty,
                owner: currentOwner,
                reviewStatus: selectedVendor.reviewStatus,
              });
              const runtimePosture = formatVendorRuntimePosture(selectedVendor);
              const decisionSummary = formatVendorDecisionSummary({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isDirty,
                lastReviewedAt: selectedVendor.lastReviewedAt,
                owner: currentOwner,
                reviewStatus: selectedVendor.reviewStatus,
                vendor: selectedVendor,
              });
              const primaryActionLabel = getVendorPrimaryActionLabel({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isDirty,
                owner: currentOwner,
              });

              return (
                <div className="space-y-6 p-1">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">{selectedVendor.title}</h2>
                      <Badge variant={primaryStatus.variant}>{primaryStatus.label}</Badge>
                      <Badge variant={governanceState.variant}>{governanceState.label}</Badge>
                    </div>
                    <p className="text-sm text-foreground">{decisionSummary}</p>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Runtime posture</p>
                        <p className="mt-2">{runtimePosture.decision}</p>
                        <p className="text-sm text-muted-foreground">
                          Environments: {runtimePosture.environments}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Data classes: {runtimePosture.dataClasses}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-lg border bg-background p-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          Governance posture
                        </p>
                        <p className="mt-2">{currentOwner || 'Owner not assigned'}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.relatedControls.length > 0
                            ? `${selectedVendor.relatedControls.length} linked control${selectedVendor.relatedControls.length === 1 ? '' : 's'}`
                            : 'No linked controls'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.lastReviewedAt
                            ? `Last reviewed ${new Date(selectedVendor.lastReviewedAt).toLocaleString()}`
                            : 'No completed review recorded'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.nextReviewAt
                            ? `Next review ${new Date(selectedVendor.nextReviewAt).toLocaleDateString()}`
                            : 'Next review not scheduled'}
                        </p>
                        <p className="text-sm text-muted-foreground">{governanceState.label}</p>
                      </div>
                      {selectedVendor.linkedAnnualReviewTask ? (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Annual review task
                          </p>
                          <p>{selectedVendor.linkedAnnualReviewTask.title}</p>
                        </div>
                      ) : null}
                      {selectedVendor.linkedEntities.length ? (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Linked context
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                            {selectedVendor.linkedEntities.map((entity) => (
                              <li key={`${entity.entityType}:${entity.entityId}`}>
                                {entity.label}
                                {entity.status ? ` · ${entity.status}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Vendor summary</p>
                    <p className="rounded-lg border bg-background p-3 text-sm">
                      {currentSummary || 'No vendor summary recorded yet.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Linked controls</p>
                    {selectedVendor.relatedControls.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedVendor.relatedControls.map((control) => (
                          <Button
                            key={`${selectedVendor.vendor}:${control.internalControlId}:${control.itemId ?? 'none'}`}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigateToControl(control.internalControlId);
                            }}
                          >
                            {control.nist80053Id} · {control.title}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                        No linked controls.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busyVendorKey !== null}
                      onClick={() => {
                        void handleReviewVendor(selectedVendor);
                      }}
                    >
                      {busyVendorKey === selectedVendor.vendor ? 'Saving…' : primaryActionLabel}
                    </Button>
                    {selectedVendor.linkedFollowUpRunId ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          navigateToReviews(selectedVendor.linkedFollowUpRunId ?? undefined);
                        }}
                      >
                        Open follow-up in reviews
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        navigateToReviews();
                      }}
                    >
                      Open reviews
                    </Button>
                  </div>
                </div>
              );
            })()
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
