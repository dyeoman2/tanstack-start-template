import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet';
import {
  formatEvidenceQueueReviewStatus,
  getEvidenceQueueReviewBadgeVariant,
  truncateHash,
} from '~/features/security/formatters';
import type { EvidenceReportDetail, EvidenceReportListItem } from '~/features/security/types';

export function AdminSecurityReportDetail(props: {
  generatedReport: string | null;
  onOpenControl: (internalControlId: string) => void;
  onOpenReviewRun: (reviewRunId: string) => void;
  report: EvidenceReportDetail | EvidenceReportListItem;
}) {
  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-4 pr-12">
          <div className="space-y-1">
            <SheetTitle>{props.report.reportKind} report</SheetTitle>
            <SheetDescription>
              {new Date(props.report.createdAt).toLocaleString()} · Content hash{' '}
              {truncateHash(props.report.contentHash)}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={getEvidenceQueueReviewBadgeVariant(props.report.reviewStatus)}>
              {formatEvidenceQueueReviewStatus(props.report.reviewStatus)}
            </Badge>
            {props.report.latestExport ? <Badge variant="secondary">Exported</Badge> : null}
          </div>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4">
        {'linkedTasks' in props.report && props.report.linkedTasks?.length ? (
          <DetailSection title="Linked review tasks">
            {props.report.linkedTasks.map((task) => (
              <div key={task.taskId} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{task.taskTitle}</p>
                <p className="text-muted-foreground">
                  {task.reviewRunTitle} · {task.reviewRunStatus}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      props.onOpenReviewRun(task.reviewRunId);
                    }}
                  >
                    Open review run
                  </Button>
                  {task.controlLinks.map((link) => (
                    <Button
                      key={`${task.taskId}:${link.internalControlId}:${link.itemId}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        props.onOpenControl(link.internalControlId);
                      }}
                    >
                      {link.nist80053Id ?? link.internalControlId}
                      {link.itemLabel ? ` · ${link.itemLabel}` : ''}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </DetailSection>
        ) : null}

        {'contentJson' in props.report ? (
          <DetailSection title="Report content">
            <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
              {props.report.contentJson}
            </pre>
          </DetailSection>
        ) : props.generatedReport ? (
          <DetailSection title="Report content">
            <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
              {props.generatedReport}
            </pre>
          </DetailSection>
        ) : (
          <p className="text-sm text-muted-foreground">Full report content is not loaded yet.</p>
        )}
      </div>
    </>
  );
}

function DetailSection(props: { children: React.ReactNode; title: string }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}
