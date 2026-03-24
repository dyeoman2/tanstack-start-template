import { type Dispatch, type SetStateAction } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Spinner } from '~/components/ui/spinner';
import { Textarea } from '~/components/ui/textarea';
import {
  formatVendorDecisionSummary,
  formatVendorRuntimePosture,
  getVendorGovernanceState,
  getVendorPrimaryActionLabel,
  getVendorPrimaryStatus,
} from '~/features/security/formatters';
import type { VendorWorkspace } from '~/features/security/types';

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
