import { Loader2 } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
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

          <ReviewTasksCard
            busyReviewTaskAction={props.busyReviewTaskAction}
            completedTasks={props.reviewTaskGroups.completed}
            handleAttestTask={props.handleAttestTask}
            isDetailLoading={props.isDetailLoading}
            onOpenBatchReview={props.onOpenBatchReview}
            onViewEvidenceLink={props.onViewEvidenceLink}
            onViewTaskSource={props.onViewTaskSource}
            openTasks={Array.from(
              new Map(
                [
                  ...props.reviewTaskGroups.blocked,
                  ...props.reviewTaskGroups.needsAttestation,
                  ...props.reviewTaskGroups.needsDocumentUpload,
                  ...props.reviewTaskGroups.findingsReview,
                  ...props.reviewTaskGroups.vendorReviews,
                  ...props.reviewTaskGroups.autoCollected,
                ].map((task) => [task.id, task]),
              ).values(),
            )}
            pendingTasks={[
              ...props.reviewTaskGroups.needsAttestation,
              ...props.reviewTaskGroups.needsDocumentUpload,
            ]}
          />
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

function ReviewTasksCard(props: {
  busyReviewTaskAction: string | null;
  completedTasks: ReviewTaskDetail[];
  handleAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  isDetailLoading: boolean;
  onOpenBatchReview: (tasks: ReviewTaskDetail[]) => void;
  onViewEvidenceLink: (link: AutoCollectedEvidenceLink['link']) => void;
  onViewTaskSource: (task: ReviewTaskDetail) => void;
  openTasks: ReviewTaskDetail[];
  pendingTasks: ReviewTaskDetail[];
}) {
  const allTasks = Array.from(
    new Map([...props.openTasks, ...props.completedTasks].map((t) => [t.id, t])).values(),
  );
  const [activeTab, setActiveTab] = useState<'all' | 'done' | 'open'>('open');

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <CardTitle>Review Tasks</CardTitle>
          {props.pendingTasks.length > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={() => props.onOpenBatchReview(props.pendingTasks)}
            >
              Start batch review ({props.pendingTasks.length})
            </Button>
          )}
        </div>
        <CardDescription>
          All tasks for the current annual review, sorted by priority.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.isDetailLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (value === 'all' || value === 'done' || value === 'open') {
                setActiveTab(value);
              }
            }}
          >
            <TabsList>
              <TabsTrigger value="open">
                Open{props.openTasks.length > 0 ? ` (${props.openTasks.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="done">
                Done{props.completedTasks.length > 0 ? ` (${props.completedTasks.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="all">All ({allTasks.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="open" className="space-y-2">
              <ReviewTaskList
                tasks={props.openTasks}
                busyReviewTaskAction={props.busyReviewTaskAction}
                handleAttestTask={props.handleAttestTask}
                onViewEvidenceLink={props.onViewEvidenceLink}
                onViewTaskSource={props.onViewTaskSource}
                emptyMessage="No open tasks — all caught up."
              />
            </TabsContent>
            <TabsContent value="done" className="space-y-2">
              <ReviewTaskList
                tasks={props.completedTasks}
                busyReviewTaskAction={props.busyReviewTaskAction}
                handleAttestTask={props.handleAttestTask}
                onViewEvidenceLink={props.onViewEvidenceLink}
                onViewTaskSource={props.onViewTaskSource}
                emptyMessage="No completed tasks yet."
              />
            </TabsContent>
            <TabsContent value="all" className="space-y-2">
              <ReviewTaskList
                tasks={allTasks}
                busyReviewTaskAction={props.busyReviewTaskAction}
                handleAttestTask={props.handleAttestTask}
                onViewEvidenceLink={props.onViewEvidenceLink}
                onViewTaskSource={props.onViewTaskSource}
                emptyMessage="No tasks in the current review."
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewTaskList(props: {
  busyReviewTaskAction: string | null;
  emptyMessage: string;
  handleAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  onViewEvidenceLink: (link: AutoCollectedEvidenceLink['link']) => void;
  onViewTaskSource: (task: ReviewTaskDetail) => void;
  tasks: ReviewTaskDetail[];
}) {
  if (!props.tasks.length) {
    return <p className="py-4 text-sm text-muted-foreground">{props.emptyMessage}</p>;
  }

  return props.tasks.map((task, index) => (
    <div
      key={`review-task-${task.id}-${index}`}
      className="flex items-start justify-between gap-3 rounded-lg border p-3"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{task.title}</p>
          <Badge variant={getReviewTaskBadgeVariant(task)}>{getReviewTaskStatusLabel(task)}</Badge>
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
        ) : task.evidenceLinks.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onViewEvidenceLink(task.evidenceLinks[0])}
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
  ));
}
