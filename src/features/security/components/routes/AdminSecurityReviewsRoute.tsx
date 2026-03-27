import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Check, ChevronDown, Download } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import {
  AdminSecurityPolicyDetail,
  getFileNameFromDisposition,
  getPolicyPdfFileName,
} from '~/features/security/components/AdminSecurityPolicyDetail';
import { AdminSecurityReportDetail } from '~/features/security/components/AdminSecurityReportDetail';
import { SecurityPolicyMarkdownRenderer } from '~/features/security/components/SecurityPolicyMarkdownRenderer';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import {
  AdminSecurityReviewsTab,
  type AutoCollectedEvidenceLink,
} from '~/features/security/components/tabs/AdminSecurityReviewsTab';
import {
  getReviewTaskBadgeVariant,
  getReviewTaskStatusLabel,
  mergeReviewRunSummaryWithDetail,
} from '~/features/security/formatters';
import type { SecurityReviewsSearch } from '~/features/security/search';
import { finalizeReviewRunServerFn } from '~/features/security/server/security-reviews';
import type {
  EvidenceReportDetail,
  ReviewRunDetail,
  ReviewRunSummary,
  ReviewTaskDetail,
  SecurityPolicyDetail,
} from '~/features/security/types';

export function AdminSecurityReviewsRoute(props: { search: SecurityReviewsSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl } = useSecurityNavigation();
  const refreshReviewRunAutomation = useAction(api.securityReviews.refreshReviewRunAutomation);
  const ensureCurrentAnnualReviewRun = useMutation(
    api.securityReviews.ensureCurrentAnnualReviewRun,
  );
  const createTriggeredReviewRun = useMutation(api.securityReviews.createTriggeredReviewRun);
  const attestReviewTask = useMutation(api.securityReviews.attestReviewTask);
  const setReviewTaskException = useMutation(api.securityReviews.setReviewTaskException);
  const openTriggeredFollowUp = useMutation(api.securityReviews.openTriggeredFollowUp);
  const currentAnnualReviewRunQuery = useQuery(api.securityReviews.getCurrentAnnualReviewRun, {}) as
    | ReviewRunSummary
    | null
    | undefined;
  const triggeredReviewRuns = useQuery(api.securityReviews.listTriggeredReviewRuns, {}) as
    | ReviewRunSummary[]
    | undefined;
  const [localAnnualReviewRun, setLocalAnnualReviewRun] = useState<ReviewRunSummary | null>(null);
  const [localAnnualReviewDetail, setLocalAnnualReviewDetail] = useState<ReviewRunDetail | null>(
    null,
  );
  const currentAnnualReviewRun = currentAnnualReviewRunQuery ?? localAnnualReviewRun;
  const currentAnnualReviewDetailQuery = useQuery(
    api.securityReviews.getReviewRunDetail,
    currentAnnualReviewRun?.id
      ? { reviewRunId: currentAnnualReviewRun.id as Id<'reviewRuns'> }
      : 'skip',
  ) as ReviewRunDetail | null | undefined;
  const currentAnnualReviewDetail = currentAnnualReviewDetailQuery ?? localAnnualReviewDetail;
  const selectedReviewRunDetail = useQuery(
    api.securityReviews.getReviewRunDetail,
    props.search.selectedReviewRun
      ? { reviewRunId: props.search.selectedReviewRun as Id<'reviewRuns'> }
      : 'skip',
  ) as ReviewRunDetail | null | undefined;
  const selectedReviewRunSummary = useMemo(() => {
    if (!props.search.selectedReviewRun) {
      return null;
    }
    if (currentAnnualReviewRun?.id === props.search.selectedReviewRun) {
      return currentAnnualReviewRun;
    }
    return triggeredReviewRuns?.find((run) => run.id === props.search.selectedReviewRun) ?? null;
  }, [currentAnnualReviewRun, props.search.selectedReviewRun, triggeredReviewRuns]);
  const [busyReviewRunAction, setBusyReviewRunAction] = useState<string | null>(null);
  const [busyReviewTaskAction, setBusyReviewTaskAction] = useState<string | null>(null);
  const [isPreparingAnnualReview, setIsPreparingAnnualReview] = useState(false);
  const [reviewTaskNotes, setReviewTaskNotes] = useState<Record<string, string>>({});
  const [reviewTaskDocuments, setReviewTaskDocuments] = useState<
    Record<string, { label: string; url: string; version: string }>
  >({});
  const [newTriggeredReviewTitle, setNewTriggeredReviewTitle] = useState('');
  const [newTriggeredReviewType, setNewTriggeredReviewType] = useState('manual_follow_up');
  const [batchReviewTasks, setBatchReviewTasks] = useState<ReviewTaskDetail[]>([]);
  const [isBatchReviewOpen, setIsBatchReviewOpen] = useState(false);
  const [viewingTask, setViewingTask] = useState<ReviewTaskDetail | null>(null);
  const [viewingEvidenceLink, setViewingEvidenceLink] = useState<
    AutoCollectedEvidenceLink['link'] | null
  >(null);

  const viewingPolicyDetail = useQuery(
    api.securityPolicies.getSecurityPolicyDetail,
    viewingTask?.policy ? { policyId: viewingTask.policy.policyId } : 'skip',
  ) as SecurityPolicyDetail | null | undefined;

  const viewingReportDetail = useQuery(
    api.securityReports.getEvidenceReportDetail,
    viewingEvidenceLink?.sourceType === 'evidence_report' ||
      viewingEvidenceLink?.sourceType === 'backup_verification_report'
      ? { id: viewingEvidenceLink.sourceId as Id<'evidenceReports'> }
      : 'skip',
  ) as EvidenceReportDetail | null | undefined;

  const reviewsInitializedRef = useRef(false);
  const reviewsRefreshedForRunRef = useRef<string | null>(null);

  // --- Reviews effects ---
  useEffect(() => {
    if (currentAnnualReviewRunQuery !== undefined) {
      setLocalAnnualReviewRun(currentAnnualReviewRunQuery);
    }
  }, [currentAnnualReviewRunQuery]);

  useEffect(() => {
    if (currentAnnualReviewDetailQuery !== undefined) {
      setLocalAnnualReviewDetail(currentAnnualReviewDetailQuery);
    }
  }, [currentAnnualReviewDetailQuery]);

  useEffect(() => {
    if (reviewsInitializedRef.current) {
      return;
    }
    if (currentAnnualReviewRunQuery === undefined) {
      return;
    }
    if (currentAnnualReviewRunQuery !== null) {
      reviewsInitializedRef.current = true;
      return;
    }

    reviewsInitializedRef.current = true;
    setIsPreparingAnnualReview(true);
    void ensureCurrentAnnualReviewRun({})
      .then(async (run) => {
        setLocalAnnualReviewRun(run);
        const detail = await refreshReviewRunAutomation({
          reviewRunId: run.id as Id<'reviewRuns'>,
        });
        if (detail) {
          setLocalAnnualReviewDetail(detail);
          setLocalAnnualReviewRun(mergeReviewRunSummaryWithDetail(run, detail));
        }
      })
      .catch((error: unknown) => {
        reviewsInitializedRef.current = false;
        showToast(
          error instanceof Error ? error.message : 'Failed to initialize annual review.',
          'error',
        );
      })
      .finally(() => {
        setIsPreparingAnnualReview(false);
      });
  }, [
    currentAnnualReviewRunQuery,
    ensureCurrentAnnualReviewRun,
    refreshReviewRunAutomation,
    showToast,
  ]);

  useEffect(() => {
    if (!currentAnnualReviewRun?.id) {
      return;
    }
    if (reviewsRefreshedForRunRef.current === currentAnnualReviewRun.id) {
      return;
    }

    reviewsRefreshedForRunRef.current = currentAnnualReviewRun.id;
    void refreshReviewRunAutomation({
      reviewRunId: currentAnnualReviewRun.id as Id<'reviewRuns'>,
    })
      .then((detail) => {
        if (detail) {
          setLocalAnnualReviewDetail(detail);
          setLocalAnnualReviewRun((current) => mergeReviewRunSummaryWithDetail(current, detail));
        }
      })
      .catch((error: unknown) => {
        reviewsRefreshedForRunRef.current = null;
        showToast(
          error instanceof Error ? error.message : 'Failed to refresh review evidence.',
          'error',
        );
      });
  }, [currentAnnualReviewRun?.id, refreshReviewRunAutomation, showToast]);

  const reviewTaskGroups = useMemo(
    () => ({
      autoCollected:
        currentAnnualReviewDetail?.tasks.filter((task) => task.taskType === 'automated_check') ??
        [],
      blocked:
        currentAnnualReviewDetail?.tasks.filter(
          (task) =>
            task.status === 'blocked' && task.findingsSummary === null && task.vendor === null,
        ) ?? [],
      findingsReview:
        currentAnnualReviewDetail?.tasks.filter((task) => task.findingsSummary !== null) ?? [],
      needsAttestation:
        currentAnnualReviewDetail?.tasks.filter(
          (task) =>
            task.taskType === 'attestation' &&
            task.status !== 'completed' &&
            task.findingsSummary === null &&
            task.vendor === null,
        ) ?? [],
      needsDocumentUpload:
        currentAnnualReviewDetail?.tasks.filter(
          (task) => task.taskType === 'document_upload' && task.status !== 'completed',
        ) ?? [],
      vendorReviews: currentAnnualReviewDetail?.tasks.filter((task) => task.vendor !== null) ?? [],
    }),
    [currentAnnualReviewDetail],
  );

  const autoCollectedEvidenceLinks = useMemo(
    () =>
      reviewTaskGroups.autoCollected.flatMap((task) => {
        const latestLink = task.evidenceLinks[0];
        return latestLink
          ? [
              {
                reviewTaskId: task.id,
                link: {
                  freshAt: latestLink.freshAt,
                  id: latestLink.id,
                  linkedAt: latestLink.linkedAt,
                  sourceId: latestLink.sourceId,
                  sourceLabel: latestLink.sourceLabel,
                  sourceType: latestLink.sourceType,
                },
                taskTitle: task.title,
              },
            ]
          : [];
      }),
    [reviewTaskGroups.autoCollected],
  );

  const reviewExceptionTasks = useMemo(
    () => currentAnnualReviewDetail?.tasks.filter((task) => task.status === 'exception') ?? [],
    [currentAnnualReviewDetail],
  );

  const reviewFinalizeState = useMemo(() => {
    const tasks = currentAnnualReviewDetail?.tasks ?? [];
    const requiredBlocked = tasks.filter((task) => task.required && task.status === 'blocked');
    const requiredRemaining = tasks.filter(
      (task) =>
        task.required &&
        task.status !== 'blocked' &&
        task.status !== 'completed' &&
        task.status !== 'exception',
    );
    const remainingByType = requiredRemaining.reduce(
      (counts, task) => {
        counts[task.taskType] += 1;
        return counts;
      },
      {
        attestation: 0,
        automated_check: 0,
        document_upload: 0,
        follow_up: 0,
      },
    );

    return {
      canFinalize: requiredBlocked.length === 0 && requiredRemaining.length === 0,
      remainingByType,
      requiredBlocked,
      requiredRemaining,
    };
  }, [currentAnnualReviewDetail]);

  const handleRefreshAnnualReview = useCallback(async () => {
    if (!currentAnnualReviewRun?.id) {
      return;
    }
    setBusyReviewRunAction('refresh');
    try {
      const detail = await refreshReviewRunAutomation({
        reviewRunId: currentAnnualReviewRun.id as Id<'reviewRuns'>,
      });
      if (detail) {
        setLocalAnnualReviewDetail(detail);
        setLocalAnnualReviewRun((current) => mergeReviewRunSummaryWithDetail(current, detail));
      }
      showToast('Annual review evidence refreshed.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to refresh annual review evidence.',
        'error',
      );
    } finally {
      setBusyReviewRunAction(null);
    }
  }, [currentAnnualReviewRun?.id, refreshReviewRunAutomation, showToast]);

  const handleFinalizeAnnualReview = useCallback(async () => {
    if (!currentAnnualReviewRun?.id) {
      return;
    }
    setBusyReviewRunAction('finalize');
    try {
      const detail = await finalizeReviewRunServerFn({
        data: {
          reviewRunId: currentAnnualReviewRun.id as Id<'reviewRuns'>,
        },
      });
      if (detail) {
        setLocalAnnualReviewDetail(detail);
        setLocalAnnualReviewRun((current) => mergeReviewRunSummaryWithDetail(current, detail));
      }
      showToast('Annual review finalized.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to finalize annual review.',
        'error',
      );
    } finally {
      setBusyReviewRunAction(null);
    }
  }, [currentAnnualReviewRun?.id, showToast]);

  const handleCreateTriggeredReviewRun = useCallback(async () => {
    const title = newTriggeredReviewTitle.trim();
    if (!title) {
      showToast('Triggered review title is required.', 'error');
      return;
    }
    setBusyReviewRunAction('create-triggered');
    try {
      await createTriggeredReviewRun({
        title,
        triggerType: newTriggeredReviewType,
      });
      setNewTriggeredReviewTitle('');
      showToast('Triggered review created.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to create triggered review.',
        'error',
      );
    } finally {
      setBusyReviewRunAction(null);
    }
  }, [createTriggeredReviewRun, newTriggeredReviewTitle, newTriggeredReviewType, showToast]);

  const handleAttestTask = useCallback(
    async (task: ReviewTaskDetail) => {
      setBusyReviewTaskAction(`${task.id}:attest`);
      try {
        const document = reviewTaskDocuments[task.id] ?? {
          label: '',
          url: '',
          version: '',
        };
        await attestReviewTask({
          documentLabel: task.taskType === 'document_upload' ? document.label.trim() : undefined,
          documentUrl: task.taskType === 'document_upload' ? document.url.trim() : undefined,
          documentVersion:
            task.taskType === 'document_upload' ? document.version.trim() || undefined : undefined,
          note: reviewTaskNotes[task.id]?.trim() || undefined,
          reviewTaskId: task.id as Id<'reviewTasks'>,
        });
        showToast(
          task.taskType === 'document_upload'
            ? 'Document-linked review task completed.'
            : 'Review task attested.',
          'success',
        );
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to save task attestation.',
          'error',
        );
      } finally {
        setBusyReviewTaskAction(null);
      }
    },
    [attestReviewTask, reviewTaskDocuments, reviewTaskNotes, showToast],
  );

  const handleExceptionTask = useCallback(
    async (task: ReviewTaskDetail) => {
      setBusyReviewTaskAction(`${task.id}:exception`);
      try {
        await setReviewTaskException({
          note: reviewTaskNotes[task.id]?.trim() || '',
          reviewTaskId: task.id as Id<'reviewTasks'>,
        });
        showToast('Task exception recorded.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to mark task exception.',
          'error',
        );
      } finally {
        setBusyReviewTaskAction(null);
      }
    },
    [reviewTaskNotes, setReviewTaskException, showToast],
  );

  const handleOpenReviewFollowUp = useCallback(
    async (task: ReviewTaskDetail) => {
      setBusyReviewTaskAction(`${task.id}:follow-up`);
      try {
        await openTriggeredFollowUp({
          note: reviewTaskNotes[task.id]?.trim() || undefined,
          reviewTaskId: task.id as Id<'reviewTasks'>,
        });
        showToast('Triggered follow-up created.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to create triggered follow-up.',
          'error',
        );
      } finally {
        setBusyReviewTaskAction(null);
      }
    },
    [openTriggeredFollowUp, reviewTaskNotes, showToast],
  );

  const handleOpenBatchReview = useCallback((tasks: ReviewTaskDetail[]) => {
    setBatchReviewTasks(tasks);
    setIsBatchReviewOpen(true);
  }, []);

  const handleViewTaskSource = useCallback((task: ReviewTaskDetail) => {
    setViewingTask(task);
  }, []);

  const handleViewEvidenceLink = useCallback((link: AutoCollectedEvidenceLink['link']) => {
    setViewingEvidenceLink(link);
  }, []);

  return (
    <>
      <AdminSecurityReviewsTab
        autoCollectedEvidenceLinks={autoCollectedEvidenceLinks}
        batchReviewTasks={batchReviewTasks}
        busyReviewRunAction={busyReviewRunAction}
        busyReviewTaskAction={busyReviewTaskAction}
        currentAnnualReviewRun={currentAnnualReviewRun}
        isBatchReviewOpen={isBatchReviewOpen}
        onBatchReviewOpenChange={setIsBatchReviewOpen}
        onOpenBatchReview={handleOpenBatchReview}
        handleAttestTask={handleAttestTask}
        handleCreateTriggeredReviewRun={handleCreateTriggeredReviewRun}
        handleExceptionTask={handleExceptionTask}
        handleFinalizeAnnualReview={handleFinalizeAnnualReview}
        handleOpenReviewFollowUp={handleOpenReviewFollowUp}
        handleRefreshAnnualReview={handleRefreshAnnualReview}
        isPreparingAnnualReview={isPreparingAnnualReview}
        navigateToControl={navigateToControl}
        onViewEvidenceLink={handleViewEvidenceLink}
        onViewTaskSource={handleViewTaskSource}
        newTriggeredReviewTitle={newTriggeredReviewTitle}
        newTriggeredReviewType={newTriggeredReviewType}
        onChangeDocumentField={(taskId, field, value) => {
          setReviewTaskDocuments((current) => ({
            ...current,
            [taskId]: {
              label: current[taskId]?.label ?? '',
              url: current[taskId]?.url ?? '',
              version: current[taskId]?.version ?? '',
              [field]: value,
            },
          }));
        }}
        onChangeNote={(taskId, value) => {
          setReviewTaskNotes((current) => ({
            ...current,
            [taskId]: value,
          }));
        }}
        reviewExceptionTasks={reviewExceptionTasks}
        reviewFinalizeState={reviewFinalizeState}
        reviewTaskDocuments={reviewTaskDocuments}
        reviewTaskGroups={reviewTaskGroups}
        reviewTaskNotes={reviewTaskNotes}
        setNewTriggeredReviewTitle={setNewTriggeredReviewTitle}
        setNewTriggeredReviewType={setNewTriggeredReviewType}
        triggeredReviewRuns={triggeredReviewRuns}
      />

      {/* Review run detail sheet */}
      <Sheet
        open={props.search.selectedReviewRun !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          void navigate({
            search: {
              ...props.search,
              selectedReviewRun: undefined,
            },
            to: getSecurityPath('reviews'),
          });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Review run detail</SheetTitle>
            <SheetDescription>
              Review the selected annual or triggered review run and the task set it owns.
            </SheetDescription>
          </SheetHeader>
          {selectedReviewRunDetail === undefined && props.search.selectedReviewRun ? (
            <DetailLoadingState label="Loading review run detail" />
          ) : selectedReviewRunDetail ? (
            <div className="space-y-6 p-1">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">
                  {selectedReviewRunSummary?.title ?? selectedReviewRunDetail.id}
                </h2>
                <div className="text-sm text-muted-foreground">
                  <p>
                    {selectedReviewRunSummary?.kind ?? selectedReviewRunDetail.kind} ·{' '}
                    {selectedReviewRunSummary?.status ?? selectedReviewRunDetail.status}
                  </p>
                  <p>
                    Created{' '}
                    {new Date(
                      selectedReviewRunSummary?.createdAt ?? selectedReviewRunDetail.createdAt,
                    ).toLocaleString()}
                  </p>
                  {selectedReviewRunSummary?.triggerType ? (
                    <p>Trigger: {selectedReviewRunSummary.triggerType}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Tasks</p>
                {selectedReviewRunDetail.tasks.length ? (
                  selectedReviewRunDetail.tasks.map((task, index) => (
                    <div
                      key={`${selectedReviewRunDetail.id}:${task.id}:${index}`}
                      className="rounded-lg border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{task.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {task.taskType} · {task.status}
                          </p>
                        </div>
                        {task.vendor ? (
                          <Badge variant="secondary">{task.vendor.title}</Badge>
                        ) : null}
                      </div>
                      {task.description ? (
                        <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>
                      ) : null}
                      {task.controlLinks.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {task.controlLinks.map((link) => (
                            <Button
                              key={`${task.id}:${link.internalControlId}:${link.itemId}`}
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                navigateToControl(link.internalControlId);
                              }}
                            >
                              {link.nist80053Id ?? link.internalControlId}
                              {link.itemLabel ? ` · ${link.itemLabel}` : ''}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tasks are attached to this run.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Task source detail sheet (policy / vendor / findings) */}
      <Sheet
        open={viewingTask !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewingTask(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {viewingTask?.policy ? (
            viewingPolicyDetail === undefined ? (
              <DetailLoadingState label="Loading policy detail" />
            ) : viewingPolicyDetail ? (
              <>
                <AdminSecurityPolicyDetail
                  hideReviewLinkage
                  hideSourceActions
                  onOpenControl={navigateToControl}
                  policy={viewingPolicyDetail}
                >
                  {viewingPolicyDetail.sourceMarkdown ? (
                    <PolicySourceCollapsible policy={viewingPolicyDetail} />
                  ) : null}
                </AdminSecurityPolicyDetail>
                <PolicyReviewStatus
                  task={viewingTask}
                  onAttest={handleAttestTask}
                  busyAction={busyReviewTaskAction}
                />
              </>
            ) : (
              <SheetHeader>
                <SheetTitle>Policy not found</SheetTitle>
                <SheetDescription>The linked policy could not be loaded.</SheetDescription>
              </SheetHeader>
            )
          ) : viewingTask ? (
            <SheetHeader>
              <SheetTitle>{viewingTask.title}</SheetTitle>
              <SheetDescription>{viewingTask.description}</SheetDescription>
            </SheetHeader>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Evidence link detail sheet */}
      <Sheet
        open={viewingEvidenceLink !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewingEvidenceLink(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {viewingReportDetail === undefined && viewingEvidenceLink ? (
            <DetailLoadingState label="Loading evidence report" />
          ) : viewingReportDetail ? (
            <AdminSecurityReportDetail
              generatedReport={viewingReportDetail.contentJson ?? null}
              onOpenControl={navigateToControl}
              onOpenReviewRun={(reviewRunId) => {
                setViewingEvidenceLink(null);
                void navigate({
                  search: {
                    ...props.search,
                    selectedReviewRun: reviewRunId,
                  },
                  to: getSecurityPath('reviews'),
                });
              }}
              report={viewingReportDetail}
            />
          ) : viewingEvidenceLink ? (
            <SheetHeader>
              <SheetTitle>{viewingEvidenceLink.sourceLabel}</SheetTitle>
              <SheetDescription>
                Details for this evidence type are not available inline.
              </SheetDescription>
            </SheetHeader>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function PolicyReviewStatus(props: {
  busyAction: string | null;
  onAttest: (task: ReviewTaskDetail) => Promise<void>;
  task: ReviewTaskDetail;
}) {
  const { task, busyAction } = props;
  const isBusy = busyAction === `${task.id}:attest`;
  const canAttest =
    task.status === 'ready' && task.taskType !== 'automated_check' && task.taskType !== 'follow_up';

  const attestationHistory = useQuery(api.securityReviews.getReviewTaskAttestationHistory, {
    reviewTaskId: task.id as Id<'reviewTasks'>,
  });

  return (
    <div className="space-y-3 px-4">
      <h3 className="text-sm font-semibold">Review status</h3>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Review cycle
          </dt>
          <dd className="text-sm text-foreground">Annual</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </dt>
          <dd>
            <Badge variant={getReviewTaskBadgeVariant(task)}>
              {getReviewTaskStatusLabel(task)}
            </Badge>
          </dd>
        </div>
      </dl>

      {task.status === 'completed' && task.latestAttestation ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4 text-green-600" />
          <span>
            Attested by {task.latestAttestation.attestedByDisplay ?? 'Unknown'} on{' '}
            {new Date(task.latestAttestation.attestedAt).toLocaleDateString()}
          </span>
        </div>
      ) : canAttest ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={isBusy}>
              {isBusy ? 'Saving…' : 'Attest to review'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm attestation</AlertDialogTitle>
              <AlertDialogDescription>
                You are attesting that you have reviewed{' '}
                <strong>{task.policy?.title ?? task.title}</strong> and it remains current.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isBusy}
                onClick={() => {
                  void props.onAttest(task);
                }}
              >
                {isBusy ? 'Saving…' : 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {attestationHistory && attestationHistory.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Past attestations
          </p>
          <div className="space-y-1">
            {attestationHistory.map(
              (entry: { attestedAt: number; attestedByDisplay: string | null }, index: number) => (
                <div
                  key={`attestation-${index}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">
                    {entry.attestedByDisplay ?? 'Unknown'}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(entry.attestedAt).toLocaleDateString()}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PolicySourceCollapsible(props: { policy: SecurityPolicyDetail }) {
  const { policy } = props;
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownloadPdf(e: React.MouseEvent) {
    e.stopPropagation();
    const sourceMarkdown = policy.sourceMarkdown;
    if (typeof sourceMarkdown !== 'string' || sourceMarkdown.length === 0) return;

    setIsDownloading(true);
    try {
      const response = await fetch('/api/security-policy-pdf', {
        body: JSON.stringify({
          fileName: getPolicyPdfFileName(policy.title),
          markdownContent: sourceMarkdown,
          sourcePath: policy.sourcePath,
          title: policy.title,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to generate policy PDF');
      }
      const blob = await response.blob();
      const resolvedFileName = getFileNameFromDisposition(
        response.headers.get('Content-Disposition'),
        getPolicyPdfFileName(policy.title),
      );
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = resolvedFileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Policy source</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDownloading}
          onClick={(e) => void handleDownloadPdf(e)}
        >
          <Download className="size-4" />
          {isDownloading ? 'Generating PDF…' : 'Download PDF'}
        </Button>
      </div>
      <Collapsible className="rounded-md border">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium hover:bg-muted/20 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/70 [&[data-state=open]>svg]:rotate-180">
          View policy document
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-4 pb-4 pt-4">
          <SecurityPolicyMarkdownRenderer bare content={policy.sourceMarkdown!} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
