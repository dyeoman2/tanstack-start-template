import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityReviewsTab } from '~/features/security/components/tabs/AdminSecurityReviewsTab';
import { mergeReviewRunSummaryWithDetail } from '~/features/security/formatters';
import type { SecurityReviewsSearch } from '~/features/security/search';
import { finalizeReviewRunServerFn } from '~/features/security/server/security-reviews';
import type {
  ReviewRunDetail,
  ReviewRunSummary,
  ReviewTaskDetail,
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
          error instanceof Error ? error.message : 'Failed to refresh review automation.',
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
                link: latestLink,
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
      showToast('Annual review automation refreshed.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to refresh annual review automation.',
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
                  selectedReviewRunDetail.tasks.map((task) => (
                    <div key={task.id} className="rounded-lg border p-4">
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
    </>
  );
}
