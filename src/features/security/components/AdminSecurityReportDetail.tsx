import { Button } from '~/components/ui/button';
import type { EvidenceReportDetail, EvidenceReportListItem } from '~/features/security/types';

export function AdminSecurityReportDetail(props: {
  generatedReport: string | null;
  onOpenControl: (internalControlId: string) => void;
  onOpenReviewRun: (reviewRunId: string) => void;
  report: EvidenceReportDetail | EvidenceReportListItem;
}) {
  return (
    <div className="space-y-6 p-1">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">{props.report.reportKind} report</h2>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{new Date(props.report.createdAt).toLocaleString()}</p>
          <p>Content hash: {props.report.contentHash}</p>
          <p>Review: {props.report.reviewStatus}</p>
          {'exportManifestHash' in props.report && props.report.exportManifestHash ? (
            <p>Manifest hash: {props.report.exportManifestHash}</p>
          ) : null}
        </div>
      </div>

      {'linkedTasks' in props.report && props.report.linkedTasks?.length ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">Linked review tasks</p>
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
        </div>
      ) : null}

      {'contentJson' in props.report ? (
        <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
          {props.report.contentJson}
        </pre>
      ) : props.generatedReport ? (
        <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
          {props.generatedReport}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">Full report content is not loaded yet.</p>
      )}
    </div>
  );
}
