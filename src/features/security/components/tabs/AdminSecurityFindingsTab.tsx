import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Spinner } from '~/components/ui/spinner';
import { Textarea } from '~/components/ui/textarea';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatFindingSeverity,
  formatFindingStatus,
  getFindingSeverityBadgeVariant,
} from '~/features/security/formatters';
import type { SecurityFindingListItem } from '~/features/security/types';

function formatFindingDisposition(disposition: SecurityFindingListItem['disposition']) {
  switch (disposition) {
    case 'accepted_risk':
      return 'Accepted risk';
    case 'false_positive':
      return 'False positive';
    case 'investigating':
      return 'Investigating';
    case 'pending_review':
      return 'Pending review';
    case 'resolved':
      return 'Resolved';
  }
}

function getFindingDispositionBadgeVariant(
  disposition: SecurityFindingListItem['disposition'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (disposition) {
    case 'resolved':
      return 'default';
    case 'accepted_risk':
    case 'false_positive':
      return 'secondary';
    case 'investigating':
      return 'outline';
    case 'pending_review':
      return 'destructive';
  }
}

export function AdminSecurityFindingsTab(props: {
  busyFindingKey: string | null;
  findingCustomerSummaries: Record<string, string>;
  findingDispositions: Record<
    SecurityFindingListItem['findingKey'],
    SecurityFindingListItem['disposition']
  >;
  findingNotes: Record<string, string>;
  findings: SecurityFindingListItem[] | undefined;
  summary: {
    openCount: number | undefined;
    reviewPendingCount: number | undefined;
    totalCount: number | undefined;
  };
  navigateToControl: (internalControlId: string) => void;
  navigateToReviews: (selectedReviewRun?: string) => void;
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
  return (
    <>
      <AdminSecurityTabHeader
        title="Findings"
        description="Open gaps, disposition notes, and review follow-up entry points for provider security posture."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <AdminSecuritySummaryCard
          title="Tracked findings"
          description="Items currently in review scope."
          value={renderCardStatValue(props.summary.totalCount)}
        />
        <AdminSecuritySummaryCard
          title="Open findings"
          description="Findings still awaiting provider action."
          value={renderCardStatValue(props.summary.openCount)}
        />
        <AdminSecuritySummaryCard
          title="Pending disposition"
          description="Findings without a recorded decision."
          value={renderCardStatValue(props.summary.reviewPendingCount)}
        />
      </div>

      <div className="space-y-4">
        {props.findings?.length ? (
          <Accordion type="multiple" className="space-y-3">
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
                <AccordionItem
                  key={finding.findingKey}
                  value={finding.findingKey}
                  className="overflow-hidden rounded-xl border bg-background"
                >
                  <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                    <AccordionTrigger className="flex-1 py-0 hover:no-underline">
                      <div className="grid w-full gap-4 text-left lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,0.9fr)] lg:items-start">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold">{finding.title}</p>
                            <Badge variant={getFindingSeverityBadgeVariant(finding.severity)}>
                              {formatFindingSeverity(finding.severity)}
                            </Badge>
                            <Badge
                              variant={finding.status === 'open' ? 'destructive' : 'secondary'}
                            >
                              {formatFindingStatus(finding.status)}
                            </Badge>
                            <Badge variant={getFindingDispositionBadgeVariant(currentDisposition)}>
                              {formatFindingDisposition(currentDisposition)}
                            </Badge>
                          </div>
                          <p className="max-w-3xl text-sm text-muted-foreground">
                            {finding.description}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <p>Source: {finding.sourceLabel}</p>
                            <p>Last observed {new Date(finding.lastObservedAt).toLocaleString()}</p>
                            {finding.reviewedAt ? (
                              <p>Reviewed {new Date(finding.reviewedAt).toLocaleString()}</p>
                            ) : null}
                            {finding.reviewedByDisplay ? <p>{finding.reviewedByDisplay}</p> : null}
                          </div>
                        </div>
                        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-1">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                              Controls
                            </p>
                            <p className="mt-1 text-foreground">
                              {finding.relatedControls.length > 0
                                ? `${finding.relatedControls.length} linked`
                                : 'No control links'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                              Review state
                            </p>
                            <p className="mt-1 text-foreground">
                              {isDirty ? 'Unsaved edits' : 'Saved'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
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
                  <AccordionContent className="border-t bg-muted/10 px-4 pb-4">
                    <div className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Internal notes
                            </p>
                            <Textarea
                              value={currentNotes}
                              onChange={(event) => {
                                props.setFindingNotes((current) => ({
                                  ...current,
                                  [finding.findingKey]: event.target.value,
                                }));
                              }}
                              placeholder="Add reviewer-only notes"
                              className="min-h-28 bg-background"
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Customer summary
                            </p>
                            <Textarea
                              value={currentCustomerSummary}
                              onChange={(event) => {
                                props.setFindingCustomerSummaries((current) => ({
                                  ...current,
                                  [finding.findingKey]: event.target.value,
                                }));
                              }}
                              placeholder="Summarize the finding for customer-facing review"
                              className="min-h-28 bg-background"
                            />
                          </div>
                        </div>
                        {finding.relatedControls.length ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Related controls
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {finding.relatedControls.map((control) => (
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
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-4 rounded-lg border bg-background p-4">
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Disposition
                          </p>
                          <Select
                            value={currentDisposition}
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
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Actions
                          </p>
                          <div className="flex flex-col gap-2">
                            <Button
                              type="button"
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
                              disabled={props.busyFindingKey !== null}
                              onClick={() => {
                                void props.onOpenFindingFollowUp(finding);
                              }}
                            >
                              {props.busyFindingKey === finding.findingKey
                                ? 'Opening…'
                                : 'Open follow-up in reviews'}
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
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
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
