import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
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

export function AdminSecurityFindingDetail(props: {
  finding: SecurityFindingListItem;
  onOpenControl: (internalControlId: string) => void;
  onOpenReviews: (selectedReviewRun?: string) => void;
}) {
  return (
    <div className="space-y-6 p-1">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold">{props.finding.title}</h2>
          <Badge variant={getFindingSeverityBadgeVariant(props.finding.severity)}>
            {formatFindingSeverity(props.finding.severity)}
          </Badge>
          <Badge variant={props.finding.status === 'open' ? 'destructive' : 'secondary'}>
            {formatFindingStatus(props.finding.status)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{props.finding.description}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Finding state</p>
          <p>{formatFindingDisposition(props.finding.disposition)}</p>
          <p className="text-sm text-muted-foreground">Source: {props.finding.sourceLabel}</p>
          <p className="text-sm text-muted-foreground">
            First observed {new Date(props.finding.firstObservedAt).toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground">
            Last observed {new Date(props.finding.lastObservedAt).toLocaleString()}
          </p>
          {props.finding.reviewedAt ? (
            <p className="text-sm text-muted-foreground">
              Reviewed {new Date(props.finding.reviewedAt).toLocaleString()}
              {props.finding.reviewedByDisplay ? ` by ${props.finding.reviewedByDisplay}` : ''}
            </p>
          ) : null}
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Review notes</p>
          <p className="text-sm">{props.finding.internalNotes ?? 'No internal notes recorded.'}</p>
          <p className="text-sm font-medium text-muted-foreground">Customer summary</p>
          <p className="text-sm">
            {props.finding.customerSummary ?? 'No customer summary recorded.'}
          </p>
          <p className="text-sm font-medium text-muted-foreground">Linked follow-up</p>
          <p className="text-sm">
            {props.finding.latestLinkedReviewRun
              ? `${props.finding.latestLinkedReviewRun.title} (${props.finding.latestLinkedReviewRun.status})`
              : 'No follow-up run linked yet.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Linked controls</p>
        {props.finding.relatedControls.length ? (
          <div className="flex flex-wrap gap-2">
            {props.finding.relatedControls.map((control) => (
              <Button
                key={`${props.finding.findingKey}:${control.internalControlId}:${control.itemId ?? 'none'}`}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  props.onOpenControl(control.internalControlId);
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
          variant="outline"
          onClick={() => {
            props.onOpenReviews(props.finding.latestLinkedReviewRun?.id);
          }}
        >
          {props.finding.latestLinkedReviewRun ? 'Open linked follow-up' : 'Open reviews'}
        </Button>
        {props.finding.latestLinkedReviewRun ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              props.onOpenReviews();
            }}
          >
            Open all reviews
          </Button>
        ) : null}
      </div>
    </div>
  );
}
