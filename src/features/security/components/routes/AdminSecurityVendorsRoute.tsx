import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Textarea } from '~/components/ui/textarea';
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
  const [isReviewing, setIsReviewing] = useState(false);
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
    (updates: Partial<SecurityVendorsSearch>) => {
      setIsReviewing(false);
      void navigate({
        search: {
          ...props.search,
          ...updates,
        },
        to: getSecurityPath('vendors'),
      });
    },
    [navigate, props.search],
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminSecuritySummaryCard
          title="Tracked vendors"
          description="First-class vendor governance records linked to controls."
          value={renderCardStatValue(vendorSummary.totalCount)}
          footer={
            vendorSummary.totalCount !== undefined
              ? `${vendorSummary.currentCount ?? 0} current reviews`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Current reviews"
          description="Vendors reviewed within the current 12-month cadence."
          value={renderCardStatValue(vendorSummary.currentCount)}
          footer={
            vendorSummary.currentCount !== undefined
              ? `${vendorSummary.dueSoonCount ?? 0} due soon`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Due soon"
          description="Reviews approaching expiry but still current."
          value={renderCardStatValue(vendorSummary.dueSoonCount)}
          footer={
            vendorSummary.dueSoonCount !== undefined
              ? `${vendorSummary.overdueCount ?? 0} overdue`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Overdue"
          description="These block annual review finalization until renewed."
          value={renderCardStatValue(vendorSummary.overdueCount)}
          footer={
            vendorSummary.overdueCount !== undefined
              ? 'Blocks annual review finalization'
              : undefined
          }
        />
      </div>

      <AdminSecurityVendorsTab
        busyVendorKey={busyVendorKey}
        navigateToControl={navigateToControl}
        navigateToReviews={navigateToReviews}
        onOpenVendor={(vendorKey) => {
          updateVendorSearch({ selectedVendor: vendorKey });
        }}
        vendorWorkspaces={vendorWorkspaces}
        vendorReviewStatus={props.search.vendorReviewStatus}
        vendorSearch={props.search.vendorSearch}
        onChangeVendorReviewStatus={(vendorReviewStatus) => {
          updateVendorSearch({ vendorReviewStatus });
        }}
        onChangeVendorSearch={(vendorSearch) => {
          updateVendorSearch({ vendorSearch });
        }}
      />

      <Sheet
        open={props.search.selectedVendor !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          setIsReviewing(false);
          updateVendorSearch({ selectedVendor: undefined });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedVendor === null && props.search.selectedVendor ? (
            <>
              <SheetHeader className="sr-only">
                <SheetTitle>Vendor detail</SheetTitle>
                <SheetDescription>
                  Review vendor posture, linked controls, review cadence, and follow-up linkage.
                </SheetDescription>
              </SheetHeader>
              <DetailLoadingState label="Loading vendor detail" />
            </>
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
                hasDraftReview: isReviewing && isDirty,
                owner: currentOwner,
                reviewStatus: selectedVendor.reviewStatus,
              });
              const runtimePosture = formatVendorRuntimePosture(selectedVendor);
              const decisionSummary = formatVendorDecisionSummary({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isReviewing && isDirty,
                lastReviewedAt: selectedVendor.lastReviewedAt,
                owner: currentOwner,
                reviewStatus: selectedVendor.reviewStatus,
                vendor: selectedVendor,
              });

              return (
                <>
                  <SheetHeader className="border-b">
                    <div className="flex items-start justify-between gap-4 pr-12">
                      <div className="space-y-1">
                        <SheetTitle>{selectedVendor.title}</SheetTitle>
                        <SheetDescription>{decisionSummary}</SheetDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={primaryStatus.variant}>{primaryStatus.label}</Badge>
                        <Badge variant={governanceState.variant}>{governanceState.label}</Badge>
                      </div>
                    </div>
                  </SheetHeader>

                  <div className="space-y-6 p-4">
                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">Overview</h3>
                      <dl className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Runtime posture
                          </dt>
                          <dd className="text-sm text-foreground">{runtimePosture.decision}</dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Environments
                          </dt>
                          <dd className="text-sm text-foreground">{runtimePosture.environments}</dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Data classes
                          </dt>
                          <dd className="text-sm text-foreground">{runtimePosture.dataClasses}</dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Owner
                          </dt>
                          <dd className="text-sm text-foreground">
                            {isReviewing ? (
                              <Input
                                value={currentOwner}
                                onChange={(event) => {
                                  setVendorOwners((current) => ({
                                    ...current,
                                    [selectedVendor.vendor]: event.target.value,
                                  }));
                                }}
                                placeholder="Assign a vendor owner"
                              />
                            ) : (
                              selectedVendor.owner || 'No owner assigned'
                            )}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Linked controls
                          </dt>
                          <dd className="text-sm text-foreground">
                            {selectedVendor.relatedControls.length > 0
                              ? `${selectedVendor.relatedControls.length} linked control${selectedVendor.relatedControls.length === 1 ? '' : 's'}`
                              : 'No linked controls'}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Last reviewed
                          </dt>
                          <dd className="text-sm text-foreground">
                            {selectedVendor.lastReviewedAt
                              ? new Date(selectedVendor.lastReviewedAt).toLocaleString()
                              : 'No completed review recorded'}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Next review
                          </dt>
                          <dd className="text-sm text-foreground">
                            {selectedVendor.nextReviewAt
                              ? new Date(selectedVendor.nextReviewAt).toLocaleDateString()
                              : 'Not scheduled'}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Governance state
                          </dt>
                          <dd className="text-sm text-foreground">{governanceState.label}</dd>
                        </div>
                        {selectedVendor.linkedAnnualReviewTask ? (
                          <div className="space-y-1">
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Annual review task
                            </dt>
                            <dd className="text-sm text-foreground">
                              {selectedVendor.linkedAnnualReviewTask.title}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </section>

                    {selectedVendor.linkedEntities.length ? (
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold">Linked context</h3>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {selectedVendor.linkedEntities.map((entity) => (
                            <li key={`${entity.entityType}:${entity.entityId}`}>
                              {entity.label}
                              {entity.status ? ` · ${entity.status}` : ''}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">Vendor summary</h3>
                      {isReviewing ? (
                        <Textarea
                          value={currentSummary}
                          onChange={(event) => {
                            setVendorSummaries((current) => ({
                              ...current,
                              [selectedVendor.vendor]: event.target.value,
                            }));
                          }}
                          placeholder="Summarize the vendor posture and review context"
                          className="min-h-28"
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.summary || 'No summary provided'}
                        </p>
                      )}
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">Linked controls</h3>
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
                        <p className="text-sm text-muted-foreground">No linked controls.</p>
                      )}
                    </section>

                    <div className="flex flex-wrap gap-2">
                      {isReviewing ? (
                        <>
                          <Button
                            type="button"
                            disabled={busyVendorKey !== null}
                            onClick={() => {
                              void handleReviewVendor(selectedVendor).then(() => {
                                setIsReviewing(false);
                              });
                            }}
                          >
                            {busyVendorKey === selectedVendor.vendor ? 'Saving…' : 'Save Review'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busyVendorKey !== null}
                            onClick={() => {
                              setVendorOwners((current) => {
                                const next = { ...current };
                                delete next[selectedVendor.vendor];
                                return next;
                              });
                              setVendorSummaries((current) => {
                                const next = { ...current };
                                delete next[selectedVendor.vendor];
                                return next;
                              });
                              setIsReviewing(false);
                            }}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => {
                            setIsReviewing(true);
                          }}
                        >
                          Start Review
                        </Button>
                      )}
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
                </>
              );
            })()
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
