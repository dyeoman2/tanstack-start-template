import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
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
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatReviewRunStatus,
  formatReviewTaskEvidenceSourceType,
  formatReviewTaskStatus,
  getReviewRunStatusBadgeVariant,
  getReviewTaskBadgeVariant,
  getReviewTaskStatusLabel,
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
  blocked: ReviewTaskDetail[];
  completed: ReviewTaskDetail[];
  findingsReview: ReviewTaskDetail[];
  needsAttestation: ReviewTaskDetail[];
  needsDocumentUpload: ReviewTaskDetail[];
  vendorReviews: ReviewTaskDetail[];
};

export type AutoCollectedEvidenceLink = {
  reviewTaskId: string;
  link: {
    freshAt: number | null;
    id: string;
    linkedAt: number;
    sourceId: string;
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
  isDetailLoading: boolean;
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
  onViewEvidenceLink: (link: AutoCollectedEvidenceLink['link']) => void;
  onViewTaskSource: (task: ReviewTaskDetail) => void;
  setNewTriggeredReviewTitle: Dispatch<SetStateAction<string>>;
  setNewTriggeredReviewType: Dispatch<SetStateAction<string>>;
}) {
  return (
    <>
      <AdminSecurityTabHeader
        title="Reviews"
        description="Annual revalidation status, triggered follow-up runs, and evidence collection for the security program."
      />

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{props.currentAnnualReviewRun?.title ?? 'Annual Review'}</CardTitle>
            <CardDescription>
              {props.currentAnnualReviewRun ? (
                <>
                  Created {new Date(props.currentAnnualReviewRun.createdAt).toLocaleString()}
                  {props.currentAnnualReviewRun.finalizedAt
                    ? ` · Finalized ${new Date(props.currentAnnualReviewRun.finalizedAt).toLocaleString()}`
                    : ''}
                </>
              ) : (
                'Revalidate the current evidence base, complete the required attestations and document links, and finalize the annual review record for this cycle.'
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!props.currentAnnualReviewRun?.id || props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleRefreshAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'refresh' ? 'Refreshing...' : 'Refresh evidence'}
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
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <AdminSecuritySummaryCard
              title="Status"
              description="Current annual revalidation rollup."
              value={
                props.currentAnnualReviewRun && !props.isDetailLoading ? (
                  formatReviewRunStatus(props.currentAnnualReviewRun.status)
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                )
              }
            />
            <AdminSecuritySummaryCard
              title="Completed Tasks"
              description="Tasks already completed or exceptioned."
              value={
                props.currentAnnualReviewRun && !props.isDetailLoading ? (
                  `${props.currentAnnualReviewRun.taskCounts.completed + props.currentAnnualReviewRun.taskCounts.exception}/${props.currentAnnualReviewRun.taskCounts.total}`
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                )
              }
            />
            <AdminSecuritySummaryCard
              title="Blocked"
              description="Tasks that still need follow-up."
              value={
                props.currentAnnualReviewRun && !props.isDetailLoading ? (
                  `${props.currentAnnualReviewRun.taskCounts.blocked}`
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                )
              }
            />
            <AdminSecuritySummaryCard
              title="Ready"
              description="Tasks currently ready for action."
              value={
                props.currentAnnualReviewRun && !props.isDetailLoading ? (
                  `${props.currentAnnualReviewRun.taskCounts.ready}`
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                )
              }
            />
          </div>

          {(() => {
            const run = props.currentAnnualReviewRun;
            if (!run) {
              return props.isDetailLoading ? null : (
                <p className="text-sm text-muted-foreground">
                  Annual review is not ready yet. Refresh evidence to try again.
                </p>
              );
            }

            const done = run.taskCounts.completed + run.taskCounts.exception;
            const total = run.taskCounts.total;
            const percent = total > 0 ? Math.round((done / total) * 100) : 0;
            const actionableCount =
              props.reviewTaskGroups.needsAttestation.length +
              props.reviewTaskGroups.needsDocumentUpload.length;
            const blockedCount = props.reviewTaskGroups.blocked.length;

            return (
              <div className="space-y-1">
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                {!props.isDetailLoading ? (
                  <p className="text-sm text-muted-foreground">
                    {done} of {total} tasks complete
                    {actionableCount > 0
                      ? ` \u2014 ${actionableCount} need${actionableCount === 1 ? 's' : ''} your action`
                      : ''}
                    {blockedCount > 0 ? `, ${blockedCount} blocked` : ''}
                  </p>
                ) : null}
              </div>
            );
          })()}

          {(() => {
            const allPendingTasks = [
              ...props.reviewTaskGroups.needsAttestation,
              ...props.reviewTaskGroups.needsDocumentUpload,
            ];
            const flatTaskListRaw = [
              ...props.reviewTaskGroups.blocked,
              ...props.reviewTaskGroups.needsAttestation,
              ...props.reviewTaskGroups.needsDocumentUpload,
              ...props.reviewTaskGroups.findingsReview,
              ...props.reviewTaskGroups.vendorReviews,
              ...props.reviewTaskGroups.autoCollected,
            ];
            const flatTaskList = Array.from(
              new Map(flatTaskListRaw.map((task) => [task.id, task])).values(),
            );
            return (
              <Card>
                <CardHeader>
                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <CardTitle>Review Tasks</CardTitle>
                    {allPendingTasks.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => props.onOpenBatchReview(allPendingTasks)}
                      >
                        Start batch review ({allPendingTasks.length})
                      </Button>
                    )}
                  </div>
                  <CardDescription>
                    All tasks for the current annual review, sorted by priority.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {props.isDetailLoading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading...
                    </div>
                  ) : flatTaskList.length ? (
                    flatTaskList.map((task, index) => (
                      <div
                        key={`annual-review-task-${task.id}-${index}`}
                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{task.title}</p>
                            <Badge variant={getReviewTaskBadgeVariant(task)}>
                              {getReviewTaskStatusLabel(task)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {task.taskType === 'automated_check'
                                ? 'Auto'
                                : task.taskType === 'document_upload'
                                  ? 'Document'
                                  : task.taskType === 'follow_up'
                                    ? 'Follow-up'
                                    : 'Attestation'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{task.description}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {task.policy || task.vendor || task.findingsSummary ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => props.onViewTaskSource(task)}
                            >
                              View
                            </Button>
                          ) : null}
                          {task.taskType !== 'follow_up' &&
                          task.taskType !== 'automated_check' &&
                          task.status !== 'completed' &&
                          task.status !== 'exception' ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={props.busyReviewTaskAction !== null}
                              onClick={() => void props.handleAttestTask(task)}
                            >
                              {props.busyReviewTaskAction === `${task.id}:attest`
                                ? 'Saving\u2026'
                                : task.taskType === 'document_upload'
                                  ? 'Upload'
                                  : 'Attest'}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No tasks in the current review.</p>
                  )}

                  {!props.isDetailLoading && props.reviewTaskGroups.completed.length > 0 && (
                    <CompletedTasksSection
                      tasks={props.reviewTaskGroups.completed}
                      onViewTaskSource={props.onViewTaskSource}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })()}
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
          {props.isDetailLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : props.autoCollectedEvidenceLinks.length ? (
            props.autoCollectedEvidenceLinks.map(({ link, reviewTaskId, taskTitle }) => (
              <div
                key={`${reviewTaskId}:${link.id}`}
                className="flex items-start justify-between gap-3 rounded-lg border p-4"
              >
                <div className="min-w-0 flex-1">
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => props.onViewEvidenceLink(link)}
                >
                  View
                </Button>
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

          {props.triggeredReviewRuns === undefined ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : props.triggeredReviewRuns.length ? (
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
          {props.isDetailLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading...
            </div>
          ) : props.reviewExceptionTasks.length ? (
            props.reviewExceptionTasks.map((task, index) => (
              <div key={`review-exception-${task.id}-${index}`} className="rounded-lg border p-4">
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

function CompletedTasksSection(props: {
  tasks: ReviewTaskDetail[];
  onViewTaskSource: (task: ReviewTaskDetail) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-4 border-t pt-4">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={`size-4 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`}
          />
          Completed ({props.tasks.length})
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {props.tasks.map((task, index) => (
          <div
            key={`completed-task-${task.id}-${index}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-muted bg-muted/30 p-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Check className="size-4 text-green-600" />
                <p className="font-medium text-muted-foreground">{task.title}</p>
                <Badge variant={getReviewTaskBadgeVariant(task)}>
                  {getReviewTaskStatusLabel(task)}
                </Badge>
              </div>
              {task.latestAttestation ? (
                <p className="text-xs text-muted-foreground">
                  {task.latestAttestation.attestedByDisplay ?? 'Unknown'} ·{' '}
                  {new Date(task.latestAttestation.attestedAt).toLocaleDateString()}
                </p>
              ) : null}
            </div>
            {task.policy || task.vendor || task.findingsSummary ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => props.onViewTaskSource(task)}
              >
                View
              </Button>
            ) : null}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
