import { type Dispatch, type SetStateAction } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { AdminSecurityBatchReview } from '~/features/security/components/AdminSecurityBatchReview';
import { AdminSecurityReviewTaskGroup } from '~/features/security/components/AdminSecurityReviewTaskGroup';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatReviewRunStatus,
  formatReviewTaskEvidenceSourceType,
  formatReviewTaskStatus,
  getReviewRunStatusBadgeVariant,
} from '~/features/security/formatters';
import type { ReviewRunSummary, ReviewTaskDetail } from '~/features/security/types';

export type ReviewFinalizeState = {
  canFinalize: boolean;
  requiredBlocked: ReviewTaskDetail[];
  requiredRemaining: ReviewTaskDetail[];
  remainingByType: {
    attestation: number;
    automated_check: number;
    document_upload: number;
    follow_up: number;
  };
};

export type ReviewTaskGroups = {
  autoCollected: ReviewTaskDetail[];
  needsAttestation: ReviewTaskDetail[];
  needsDocumentUpload: ReviewTaskDetail[];
  findingsReview: ReviewTaskDetail[];
  vendorReviews: ReviewTaskDetail[];
  blocked: ReviewTaskDetail[];
};

export type AutoCollectedEvidenceLink = {
  link: {
    freshAt: number | null;
    id: string;
    linkedAt: number;
    sourceLabel: string;
    sourceType:
      | 'security_control_evidence'
      | 'evidence_report'
      | 'security_finding'
      | 'backup_verification_report'
      | 'external_document'
      | 'review_task'
      | 'vendor';
  };
  taskTitle: string;
};

export function AdminSecurityReviewsTab(props: {
  autoCollectedEvidenceLinks: AutoCollectedEvidenceLink[];
  busyReviewRunAction: string | null;
  busyReviewTaskAction: string | null;
  currentAnnualReviewRun: ReviewRunSummary | null;
  isPreparingAnnualReview: boolean;
  newTriggeredReviewTitle: string;
  newTriggeredReviewType: string;
  reviewExceptionTasks: ReviewTaskDetail[];
  reviewFinalizeState: ReviewFinalizeState;
  reviewTaskDocuments: Record<string, { label: string; url: string; version: string }>;
  reviewTaskGroups: ReviewTaskGroups;
  reviewTaskNotes: Record<string, string>;
  triggeredReviewRuns: ReviewRunSummary[] | undefined;
  batchReviewTasks: ReviewTaskDetail[];
  isBatchReviewOpen: boolean;
  onBatchReviewOpenChange: (open: boolean) => void;
  onOpenBatchReview: (tasks: ReviewTaskDetail[]) => void;
  handleAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  handleCreateTriggeredReviewRun: () => Promise<void>;
  handleExceptionTask: (task: ReviewTaskDetail) => Promise<void>;
  handleFinalizeAnnualReview: () => Promise<void>;
  handleOpenReviewFollowUp: (task: ReviewTaskDetail) => Promise<void>;
  handleRefreshAnnualReview: () => Promise<void>;
  navigateToControl: (internalControlId: string) => void;
  onChangeDocumentField: (
    taskId: string,
    field: 'label' | 'url' | 'version',
    value: string,
  ) => void;
  onChangeNote: (taskId: string, value: string) => void;
  setNewTriggeredReviewTitle: Dispatch<SetStateAction<string>>;
  setNewTriggeredReviewType: Dispatch<SetStateAction<string>>;
}) {
  return (
    <>
      <AdminSecurityTabHeader
        title="Reviews"
        description="Annual revalidation status, triggered follow-up runs, and evidence collection for the security program."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!props.currentAnnualReviewRun?.id || props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleRefreshAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'refresh' ? 'Refreshing...' : 'Refresh automation'}
            </Button>
            <Button
              type="button"
              disabled={
                !props.currentAnnualReviewRun?.id ||
                props.busyReviewRunAction !== null ||
                !props.reviewFinalizeState.canFinalize
              }
              onClick={() => {
                void props.handleFinalizeAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'finalize'
                ? 'Finalizing...'
                : 'Finalize annual review'}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Current Annual Review</CardTitle>
          <CardDescription>
            Revalidate the current evidence base, complete the required attestations and document
            links, and finalize the annual review record for this cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.currentAnnualReviewRun ? (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <AdminSecuritySummaryCard
                  title="Status"
                  description="Current annual revalidation rollup."
                  value={formatReviewRunStatus(props.currentAnnualReviewRun.status)}
                />
                <AdminSecuritySummaryCard
                  title="Completed Tasks"
                  description="Tasks already completed or exceptioned."
                  value={`${props.currentAnnualReviewRun.taskCounts.completed + props.currentAnnualReviewRun.taskCounts.exception}/${props.currentAnnualReviewRun.taskCounts.total}`}
                />
                <AdminSecuritySummaryCard
                  title="Blocked"
                  description="Tasks that still need follow-up."
                  value={`${props.currentAnnualReviewRun.taskCounts.blocked}`}
                />
                <AdminSecuritySummaryCard
                  title="Ready"
                  description="Tasks currently ready for action."
                  value={`${props.currentAnnualReviewRun.taskCounts.ready}`}
                />
              </div>

              {(() => {
                const done =
                  props.currentAnnualReviewRun.taskCounts.completed +
                  props.currentAnnualReviewRun.taskCounts.exception;
                const total = props.currentAnnualReviewRun.taskCounts.total;
                const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                const actionableCount =
                  props.reviewTaskGroups.needsAttestation.length +
                  props.reviewTaskGroups.needsDocumentUpload.length;
                const blockedCount = props.reviewTaskGroups.blocked.length;
                const allPendingTasks = [
                  ...props.reviewTaskGroups.needsAttestation,
                  ...props.reviewTaskGroups.needsDocumentUpload,
                ];
                return (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {done} of {total} tasks complete
                        {actionableCount > 0
                          ? ` \u2014 ${actionableCount} need${actionableCount === 1 ? 's' : ''} your action`
                          : ''}
                        {blockedCount > 0 ? `, ${blockedCount} blocked` : ''}
                      </p>
                    </div>
                    {allPendingTasks.length > 0 ? (
                      <Button
                        type="button"
                        onClick={() => {
                          props.onOpenBatchReview(allPendingTasks);
                        }}
                      >
                        Start review ({allPendingTasks.length} task
                        {allPendingTasks.length === 1 ? '' : 's'})
                      </Button>
                    ) : null}
                  </div>
                );
              })()}

              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{props.currentAnnualReviewRun.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Created {new Date(props.currentAnnualReviewRun.createdAt).toLocaleString()}
                      {props.currentAnnualReviewRun.finalizedAt
                        ? ` · Finalized ${new Date(props.currentAnnualReviewRun.finalizedAt).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                  <Badge
                    variant={getReviewRunStatusBadgeVariant(props.currentAnnualReviewRun.status)}
                  >
                    {formatReviewRunStatus(props.currentAnnualReviewRun.status)}
                  </Badge>
                </div>
              </div>

              {props.reviewFinalizeState.canFinalize ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  All required revalidation tasks are complete. The annual review can be finalized
                  now.
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-medium">Finalize is still blocked.</p>
                  <p className="mt-1 text-amber-900">
                    {props.reviewFinalizeState.requiredRemaining.length > 0
                      ? `Remaining required work: ${props.reviewFinalizeState.remainingByType.attestation} attestation${props.reviewFinalizeState.remainingByType.attestation === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.document_upload} document link${props.reviewFinalizeState.remainingByType.document_upload === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.automated_check} automated check${props.reviewFinalizeState.remainingByType.automated_check === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.follow_up} follow-up${props.reviewFinalizeState.remainingByType.follow_up === 1 ? '' : 's'}.`
                      : 'No remaining manual tasks are open.'}
                  </p>
                  {props.reviewFinalizeState.requiredBlocked.length > 0 ? (
                    <p className="mt-1 text-amber-900">
                      Blocked tasks:{' '}
                      {props.reviewFinalizeState.requiredBlocked
                        .map((task) => task.title)
                        .join(', ')}
                      .
                    </p>
                  ) : null}
                </div>
              )}

              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that require a human attestation to renew support for the current cycle."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onBatchReview={() => {
                  props.onOpenBatchReview(props.reviewTaskGroups.needsAttestation);
                }}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.needsAttestation}
                title="Needs attestation"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that require a linked document so the annual review can materialize fresh support evidence."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.needsDocumentUpload}
                title="Needs document upload"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Grouped findings review for annual governance posture. Critical open findings must be resolved or dispositioned before attestation."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.findingsReview}
                title="Findings review"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Vendor governance reviews that renew the vendor assessment cadence without affecting support rollups."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onBatchReview={() => {
                  props.onOpenBatchReview(props.reviewTaskGroups.vendorReviews);
                }}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.vendorReviews}
                title="Vendor reviews"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that remain blocked or have documented exceptions needing follow-up."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.blocked}
                title="Blocked by open issue"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                defaultCollapsed
                description="Tasks the system generated or linked automatically for the current run."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.autoCollected}
                title="Auto-collected"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {props.isPreparingAnnualReview
                ? 'Preparing the current annual review...'
                : 'Annual review is not ready yet. Refresh automation to try again.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-Collected Evidence</CardTitle>
          <CardDescription>
            The latest artifact currently linked to each automated annual-review task.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.autoCollectedEvidenceLinks.length ? (
            props.autoCollectedEvidenceLinks.map(({ link, taskTitle }) => (
              <div key={link.id} className="rounded-lg border p-4">
                <p className="font-medium">{link.sourceLabel}</p>
                {link.sourceLabel !== taskTitle ? (
                  <p className="text-sm text-muted-foreground">{taskTitle}</p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {formatReviewTaskEvidenceSourceType(link.sourceType)} · Linked{' '}
                  {new Date(link.linkedAt).toLocaleString()}
                  {link.freshAt ? ` · Fresh ${new Date(link.freshAt).toLocaleString()}` : ''}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No auto-collected evidence is linked yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triggered Reviews</CardTitle>
          <CardDescription>
            Manual and repo-native follow-up runs that should not wait for the annual cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr,200px,auto]">
            <Input
              value={props.newTriggeredReviewTitle}
              onChange={(event) => {
                props.setNewTriggeredReviewTitle(event.target.value);
              }}
              placeholder="Triggered review title"
            />
            <Select
              value={props.newTriggeredReviewType}
              onValueChange={props.setNewTriggeredReviewType}
            >
              <SelectTrigger aria-label="Triggered review type">
                <SelectValue placeholder="Trigger type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual_follow_up">Manual follow-up</SelectItem>
                <SelectItem value="remediation_follow_up">Remediation</SelectItem>
                <SelectItem value="termination_follow_up">Termination</SelectItem>
                <SelectItem value="certificate_operations">Certificate operations</SelectItem>
                <SelectItem value="unsupported_component">Unsupported component</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleCreateTriggeredReviewRun();
              }}
            >
              {props.busyReviewRunAction === 'create-triggered' ? 'Creating...' : 'Create run'}
            </Button>
          </div>

          {props.triggeredReviewRuns?.length ? (
            props.triggeredReviewRuns.map((run) => (
              <div key={run.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{run.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {run.triggerType ?? 'manual follow-up'} · Created{' '}
                      {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={getReviewRunStatusBadgeVariant(run.status)}>
                    {formatReviewRunStatus(run.status)}
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No triggered reviews have been created yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exceptions / Open Follow-Up</CardTitle>
          <CardDescription>
            Tasks that currently require an exception note or a triggered follow-up run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.reviewExceptionTasks.length ? (
            props.reviewExceptionTasks.map((task) => (
              <div key={task.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-muted-foreground">{task.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatReviewTaskStatus(task.status)}
                      {task.latestNote ? ` · ${task.latestNote}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyReviewTaskAction !== null}
                      onClick={() => {
                        void props.handleExceptionTask(task);
                      }}
                    >
                      {props.busyReviewTaskAction === `${task.id}:exception`
                        ? 'Saving...'
                        : 'Mark exception'}
                    </Button>
                    <Button
                      type="button"
                      disabled={props.busyReviewTaskAction !== null}
                      onClick={() => {
                        void props.handleOpenReviewFollowUp(task);
                      }}
                    >
                      {props.busyReviewTaskAction === `${task.id}:follow-up`
                        ? 'Opening...'
                        : 'Open triggered follow-up'}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No exceptions or open follow-up items are currently tracked.
            </p>
          )}
        </CardContent>
      </Card>

      <AdminSecurityBatchReview
        busyAction={props.busyReviewTaskAction}
        onAttestTask={props.handleAttestTask}
        onOpenChange={props.onBatchReviewOpenChange}
        open={props.isBatchReviewOpen}
        tasks={props.batchReviewTasks}
      />
    </>
  );
}
