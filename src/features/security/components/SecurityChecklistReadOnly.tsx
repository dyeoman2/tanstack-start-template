import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  formatChecklistStatus,
  formatEvidenceDate,
  formatEvidenceReviewStatus,
  formatEvidenceSource,
  formatEvidenceSufficiency,
  formatEvidenceTimestamp,
  formatReviewRunStatus,
  getChecklistStatusBadgeVariant,
  getEvidenceReviewBadgeVariant,
  getEvidenceSufficiencyBadgeVariant,
} from '~/features/security/formatters';
import type { SecurityChecklistEvidence, SecurityChecklistItem } from '~/features/security/types';

export function SecurityChecklistAccordionHeader(props: { item: SecurityChecklistItem }) {
  const { item } = props;

  return (
    <div className="flex flex-1 items-center justify-between gap-4 pr-4">
      <span className="text-sm font-medium">{item.label}</span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!item.required ? <Badge variant="outline">Optional</Badge> : null}
        {item.hasExpiringSoonEvidence ? <Badge variant="secondary">Expiring soon</Badge> : null}
        <Badge variant={getChecklistStatusBadgeVariant(item.support)}>
          {formatChecklistStatus(item.support)}
        </Badge>
      </div>
    </div>
  );
}

export function SecurityChecklistItemReadOnlyContent(props: {
  children?: React.ReactNode;
  item: SecurityChecklistItem;
  onOpenEvidence?: (evidence: SecurityChecklistEvidence) => void | Promise<void>;
  onOpenReviews?: () => void;
  renderEvidenceActions?: (evidence: SecurityChecklistEvidence) => React.ReactNode;
}) {
  const { item } = props;
  const activeEvidence = item.evidence.filter((evidence) => evidence.lifecycleStatus === 'active');

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{item.description}</p>
        {item.reviewArtifact ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <p className="font-medium">{item.reviewArtifact.reviewTaskTitle}</p>
            <p className="text-muted-foreground">
              {item.reviewArtifact.reviewRunTitle} ·{' '}
              {formatReviewRunStatus(item.reviewArtifact.reviewRunStatus)}
            </p>
            <p className="text-muted-foreground">
              Satisfied {formatEvidenceTimestamp(item.reviewArtifact.satisfiedAt)}
              {item.reviewArtifact.satisfiedByDisplay
                ? ` · ${item.reviewArtifact.satisfiedByDisplay}`
                : ''}
            </p>
            {item.reviewArtifact.relatedReports.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {item.reviewArtifact.relatedReports.map((report) => (
                  <Badge key={report.id} variant="outline">
                    {report.reportKind} · {report.label}
                  </Badge>
                ))}
              </div>
            ) : null}
            {props.onOpenReviews ? (
              <div className="mt-3">
                <Button type="button" variant="outline" size="sm" onClick={props.onOpenReviews}>
                  Open reviews
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm font-medium">Evidence</p>
      </div>

      {activeEvidence.length ? (
        <div className="space-y-3">
          {activeEvidence.map((evidence) => (
            <div key={evidence.id} className="space-y-3 rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm font-medium">{evidence.title}</p>
                <div className="flex items-center gap-2">
                  {evidence.expiryStatus === 'expiring_soon' ? (
                    <Badge variant="secondary">Expiring soon</Badge>
                  ) : null}
                  <Badge variant={getEvidenceSufficiencyBadgeVariant(evidence.sufficiency)}>
                    {formatEvidenceSufficiency(evidence.sufficiency)}
                  </Badge>
                  <Badge variant={getEvidenceReviewBadgeVariant(evidence.reviewStatus)}>
                    {formatEvidenceReviewStatus(evidence.reviewStatus)}
                  </Badge>
                  {props.renderEvidenceActions?.(evidence)}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {evidence.description ?? 'No additional description provided.'}
                </p>
                {evidence.url ? (
                  <p className="truncate text-xs text-muted-foreground">{evidence.url}</p>
                ) : null}
                <div className="space-y-1 text-xs text-muted-foreground">
                  {evidence.source ? (
                    <p>
                      <span className="font-medium text-foreground">Source:</span>{' '}
                      {formatEvidenceSource(evidence.source)}
                    </p>
                  ) : null}
                  {evidence.evidenceDate ? (
                    <p>
                      <span className="font-medium text-foreground">Evidence date:</span>{' '}
                      {formatEvidenceDate(evidence.evidenceDate)}
                    </p>
                  ) : null}
                  {evidence.validUntil ? (
                    <p>
                      <span className="font-medium text-foreground">Valid until:</span>{' '}
                      {formatEvidenceDate(evidence.validUntil)}
                    </p>
                  ) : null}
                  <p>
                    <span className="font-medium text-foreground">Added:</span>{' '}
                    {`${evidence.uploadedByDisplay ?? 'Unknown'} · ${formatEvidenceTimestamp(evidence.createdAt)}`}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">Reviewed:</span>{' '}
                    {evidence.reviewedAt
                      ? `${evidence.reviewedByDisplay ?? 'Not recorded'} · ${formatEvidenceTimestamp(evidence.reviewedAt)}`
                      : 'Not reviewed'}
                  </p>
                </div>
              </div>
              {props.onOpenEvidence && evidence.evidenceType !== 'note' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void props.onOpenEvidence?.(evidence)}
                  >
                    Open
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No active evidence recorded.</p>
      )}

      {props.children}
    </div>
  );
}

export function SecurityChecklistReadOnlySection(props: {
  children?: (item: SecurityChecklistItem) => React.ReactNode;
  emptyMessage?: string;
  items?: SecurityChecklistItem[];
  onOpenEvidence?: (evidence: SecurityChecklistEvidence) => void | Promise<void>;
  onOpenReviews?: () => void;
  renderEvidenceActions?: (evidence: SecurityChecklistEvidence) => React.ReactNode;
}) {
  const items = props.items ?? [];

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {props.emptyMessage ?? 'No checklist items recorded yet.'}
      </p>
    );
  }

  return (
    <Accordion type="multiple" className="rounded-md border">
      {items.map((item) => (
        <AccordionItem key={item.itemId} value={item.itemId} className="border-b last:border-b-0">
          <AccordionTrigger className="px-5 py-4 text-left focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-border/70 data-[state=open]:bg-muted/20">
            <SecurityChecklistAccordionHeader item={item} />
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <SecurityChecklistItemReadOnlyContent
              item={item}
              onOpenEvidence={props.onOpenEvidence}
              onOpenReviews={props.onOpenReviews}
              renderEvidenceActions={props.renderEvidenceActions}
            >
              {props.children?.(item)}
            </SecurityChecklistItemReadOnlyContent>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
