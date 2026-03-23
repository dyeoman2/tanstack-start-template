import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSortableHeader } from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import { Sheet, SheetContent } from '~/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useToast } from '~/components/ui/toast';
import {
  AdminSecurityControlCell,
  AdminSecurityEvidenceReadinessCell,
  AdminSecurityFrameworkSummaryCell,
  AdminSecurityResponsibilityCell,
} from '~/features/security/components/AdminSecurityControlCells';
import { AdminSecurityControlDetail } from '~/features/security/components/AdminSecurityControlDetail';
import {
  AdminSecurityControlsTab,
  AdminSecurityEvidenceTab,
  AdminSecurityOverviewTab,
  AdminSecurityReviewsTab,
  AdminSecurityVendorsTab,
} from '~/features/security/components/tabs/AdminSecurityTabSections';
import {
  CONTROL_PAGE_SIZE_OPTIONS,
  CONTROL_TABLE_SORT_FIELDS,
  SECURITY_TABS,
} from '~/features/security/constants';
import { mergeReviewRunSummaryWithDetail } from '~/features/security/formatters';
import { useSecurityControlTable } from '~/features/security/hooks/useSecurityControlTable';
import type { SecuritySearch } from '~/features/security/search';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceReportDetail,
  EvidenceReportListItem,
  EvidenceSource,
  ReviewRunDetail,
  ReviewRunSummary,
  ReviewTaskDetail,
  SecurityChecklistEvidence,
  SecurityControlWorkspace,
  SecurityControlWorkspaceSummary,
  SecurityFindingListItem,
  SecurityWorkspaceOverview,
  VendorWorkspace,
} from '~/features/security/types';
import { exportSecurityControlsCsv } from '~/features/security/utils/exportSecurityControlsCsv';
import { uploadFileWithTarget } from '~/features/security/utils/upload';
function isSecurityTab(value: string): value is (typeof SECURITY_TABS)[number] {
  return SECURITY_TABS.includes(value as (typeof SECURITY_TABS)[number]);
}

export function AdminSecurityRoute(props: { search: SecuritySearch }) {
  const navigate = useNavigate();
  const convex = useConvex();
  const search = props.search;
  const {
    tab: activeTab,
    page,
    pageSize,
    sortBy,
    sortOrder,
    search: controlSearchTerm,
    responsibility: responsibilityFilter,
    evidenceReadiness: evidenceReadinessFilter,
    family: familyFilter,
    selectedControl: selectedControlId,
  } = props.search;
  const { showToast } = useToast();
  const [report, setReport] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<Id<'evidenceReports'> | null>(null);
  const workspaceOverview = useQuery(api.security.getSecurityWorkspaceOverview, {}) as
    | SecurityWorkspaceOverview
    | undefined;
  const controlsTabActive = activeTab === 'controls';
  const evidenceTabActive = activeTab === 'evidence';
  const vendorsTabActive = activeTab === 'vendors';
  const reviewsTabActive = activeTab === 'reviews';
  const controlWorkspaces = useQuery(
    api.security.listSecurityControlWorkspaces,
    controlsTabActive ? {} : 'skip',
  ) as SecurityControlWorkspaceSummary[] | undefined;
  const selectedControl = useQuery(
    api.security.getSecurityControlWorkspaceDetail,
    controlsTabActive && selectedControlId ? { internalControlId: selectedControlId } : 'skip',
  ) as SecurityControlWorkspace | null | undefined;
  const evidenceReports = useQuery(
    api.security.listEvidenceReports,
    evidenceTabActive ? { limit: 20 } : 'skip',
  ) as EvidenceReportListItem[] | undefined;
  const securityFindings = useQuery(
    api.security.listSecurityFindings,
    evidenceTabActive ? {} : 'skip',
  ) as SecurityFindingListItem[] | undefined;
  const vendorWorkspaces = useQuery(
    api.security.listVendorReviewWorkspaces,
    vendorsTabActive ? {} : 'skip',
  ) as VendorWorkspace[] | undefined;
  const summary = workspaceOverview?.postureSummary;
  const selectedReportDetail = useQuery(
    api.security.getEvidenceReportDetail,
    evidenceTabActive && selectedReportId ? { id: selectedReportId } : 'skip',
  ) as EvidenceReportDetail | null | undefined;
  const auditReadiness = workspaceOverview?.auditReadiness;
  const generateEvidenceReport = useAction(api.security.generateEvidenceReport);
  const exportEvidenceReport = useAction(api.security.exportEvidenceReport);
  const reviewEvidenceReport = useMutation(api.security.reviewEvidenceReport);
  const reviewSecurityFinding = useMutation(api.security.reviewSecurityFinding);
  const openSecurityFindingFollowUp = useMutation(api.security.openSecurityFindingFollowUp);
  const reviewControlEvidence = useMutation(api.security.reviewSecurityControlEvidence);
  const addEvidenceLink = useMutation(api.security.addSecurityControlEvidenceLink);
  const addEvidenceNote = useMutation(api.security.addSecurityControlEvidenceNote);
  const archiveControlEvidence = useMutation(api.security.archiveSecurityControlEvidence);
  const createEvidenceUploadTarget = useAction(
    api.security.createSecurityControlEvidenceUploadTarget,
  );
  const finalizeEvidenceUpload = useAction(api.security.finalizeSecurityControlEvidenceUpload);
  const renewControlEvidence = useMutation(api.security.renewSecurityControlEvidence);
  const createSignedServeUrl = useAction(api.fileServing.createSignedServeUrl);
  const refreshReviewRunAutomation = useAction(api.security.refreshReviewRunAutomation);
  const finalizeReviewRun = useAction(api.security.finalizeReviewRun);
  const ensureCurrentAnnualReviewRun = useMutation(api.security.ensureCurrentAnnualReviewRun);
  const createTriggeredReviewRun = useMutation(api.security.createTriggeredReviewRun);
  const reviewVendorWorkspace = useMutation(api.security.reviewVendorWorkspace);
  const attestReviewTask = useMutation(api.security.attestReviewTask);
  const setReviewTaskException = useMutation(api.security.setReviewTaskException);
  const openTriggeredFollowUp = useMutation(api.security.openTriggeredFollowUp);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [findingNotes, setFindingNotes] = useState<Record<string, string>>({});
  const [findingDispositions, setFindingDispositions] = useState<
    Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
  >({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);
  const [busyFindingKey, setBusyFindingKey] = useState<string | null>(null);
  const [busyVendorKey, setBusyVendorKey] = useState<string | null>(null);
  const [isExportingControls, setIsExportingControls] = useState(false);
  const [busyControlAction, setBusyControlAction] = useState<string | null>(null);
  const [busyReviewRunAction, setBusyReviewRunAction] = useState<string | null>(null);
  const [busyReviewTaskAction, setBusyReviewTaskAction] = useState<string | null>(null);
  const [localAnnualReviewRun, setLocalAnnualReviewRun] = useState<ReviewRunSummary | null>(null);
  const [localAnnualReviewDetail, setLocalAnnualReviewDetail] = useState<ReviewRunDetail | null>(
    null,
  );
  const [isPreparingAnnualReview, setIsPreparingAnnualReview] = useState(false);
  const [reviewTaskNotes, setReviewTaskNotes] = useState<Record<string, string>>({});
  const [reviewTaskDocuments, setReviewTaskDocuments] = useState<
    Record<string, { label: string; url: string; version: string }>
  >({});
  const [newTriggeredReviewTitle, setNewTriggeredReviewTitle] = useState('');
  const [newTriggeredReviewType, setNewTriggeredReviewType] = useState('manual_follow_up');
  const [vendorNotes, setVendorNotes] = useState<Record<string, string>>({});
  const [vendorOwners, setVendorOwners] = useState<Record<string, string>>({});
  const reviewsInitializedRef = useRef(false);
  const reviewsRefreshedForRunRef = useRef<string | null>(null);
  const controls = controlWorkspaces;
  const controlItems = useMemo(() => controls ?? [], [controls]);
  const currentAnnualReviewRunQuery = useQuery(
    api.security.getCurrentAnnualReviewRun,
    reviewsTabActive ? {} : 'skip',
  ) as ReviewRunSummary | null | undefined;
  const triggeredReviewRuns = useQuery(
    api.security.listTriggeredReviewRuns,
    reviewsTabActive ? {} : 'skip',
  ) as ReviewRunSummary[] | undefined;
  const currentAnnualReviewRun =
    workspaceOverview?.currentAnnualReviewRun ??
    currentAnnualReviewRunQuery ??
    localAnnualReviewRun;
  const currentAnnualReviewDetailQuery = useQuery(
    api.security.getReviewRunDetail,
    reviewsTabActive && currentAnnualReviewRun?.id
      ? { reviewRunId: currentAnnualReviewRun.id as Id<'reviewRuns'> }
      : 'skip',
  ) as ReviewRunDetail | null | undefined;
  const currentAnnualReviewDetail = currentAnnualReviewDetailQuery ?? localAnnualReviewDetail;
  const auditReadinessSummary = useMemo(() => {
    const latestDrill = auditReadiness?.latestBackupDrill ?? null;
    const staleDrill =
      latestDrill === null || Date.now() - latestDrill.checkedAt > 30 * 24 * 60 * 60 * 1000;

    return {
      latestDrill,
      latestManifestHash: auditReadiness?.recentExports[0]?.manifestHash ?? null,
      metadataGapCount: auditReadiness?.metadataGaps.length ?? 0,
      recentDeniedCount: auditReadiness?.recentDeniedActions.length ?? 0,
      recentExportCount: auditReadiness?.recentExports.length ?? 0,
      staleDrill,
    };
  }, [auditReadiness]);
  const restoreDrillFooter = auditReadinessSummary.staleDrill
    ? 'Drill evidence is stale'
    : auditReadinessSummary.latestDrill
      ? `Checked ${new Date(auditReadinessSummary.latestDrill.checkedAt).toLocaleString()}`
      : 'No drill evidence recorded';
  const findingSummary = useMemo(() => {
    const findingItems = securityFindings ?? [];
    if (findingItems.length === 0 && workspaceOverview?.findingSummary) {
      return {
        openCount: workspaceOverview.findingSummary.openCount,
        reviewPendingCount: workspaceOverview.findingSummary.undispositionedCount,
        totalCount: workspaceOverview.findingSummary.totalCount,
      };
    }
    return {
      openCount: findingItems.filter((finding) => finding.status === 'open').length,
      reviewPendingCount: findingItems.filter((finding) => finding.disposition === 'pending_review')
        .length,
      totalCount: findingItems.length,
    };
  }, [securityFindings, workspaceOverview]);
  const controlSummary = useMemo(() => {
    if (workspaceOverview?.controlSummary) {
      return workspaceOverview.controlSummary;
    }
    return controlItems.reduce(
      (summaryAccumulator, control) => {
        summaryAccumulator.totalControls += 1;
        if (control.responsibility === 'shared-responsibility') {
          summaryAccumulator.byResponsibility.sharedResponsibility += 1;
        } else if (control.responsibility) {
          summaryAccumulator.byResponsibility[control.responsibility] += 1;
        }
        summaryAccumulator.byEvidence[control.evidenceReadiness] += 1;
        return summaryAccumulator;
      },
      {
        totalControls: 0,
        byResponsibility: {
          platform: 0,
          sharedResponsibility: 0,
          customer: 0,
        },
        byEvidence: {
          ready: 0,
          partial: 0,
          missing: 0,
        },
      },
    );
  }, [controlItems, workspaceOverview]);

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
    if (!reviewsTabActive) {
      return;
    }
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
    reviewsTabActive,
    showToast,
  ]);

  useEffect(() => {
    if (!reviewsTabActive || !currentAnnualReviewRun?.id) {
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
  }, [currentAnnualReviewRun?.id, refreshReviewRunAutomation, reviewsTabActive, showToast]);

  const reviewTaskGroups = useMemo(
    () => ({
      autoCollected:
        currentAnnualReviewDetail?.tasks.filter((task) => task.taskType === 'automated_check') ??
        [],
      needsAttestation:
        currentAnnualReviewDetail?.tasks.filter(
          (task) => task.taskType === 'attestation' && task.status !== 'completed',
        ) ?? [],
      needsDocumentUpload:
        currentAnnualReviewDetail?.tasks.filter(
          (task) => task.taskType === 'document_upload' && task.status !== 'completed',
        ) ?? [],
      blocked: currentAnnualReviewDetail?.tasks.filter((task) => task.status === 'blocked') ?? [],
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
        task.status !== 'completed' &&
        task.status !== 'exception' &&
        task.status !== 'blocked',
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
      requiredBlocked,
      requiredRemaining,
      remainingByType,
    };
  }, [currentAnnualReviewDetail]);
  const {
    controlPagination,
    controlSearchParams,
    evidenceReadinessOptions,
    familyOptions,
    paginatedControls,
    responsibilityOptions,
    sortedControls,
  } = useSecurityControlTable({
    controls: controlItems,
    evidenceReadinessFilter,
    familyFilter,
    page,
    pageSize,
    responsibilityFilter,
    searchTerm: controlSearchTerm,
    sortBy,
    sortOrder,
  });
  const updateControlSearch = useCallback(
    (
      updates: Partial<{
        page: number;
        pageSize: (typeof CONTROL_PAGE_SIZE_OPTIONS)[number];
        sortBy: (typeof CONTROL_TABLE_SORT_FIELDS)[number];
        sortOrder: 'asc' | 'desc';
        search: string;
        responsibility: 'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>;
        evidenceReadiness: 'all' | SecurityControlWorkspaceSummary['evidenceReadiness'];
        family: string;
        selectedControl: string | undefined;
      }>,
    ) => {
      void navigate({
        to: '/app/admin/security',
        search: {
          ...search,
          ...updates,
        },
      });
    },
    [navigate, search],
  );
  const navigateToControl = useCallback(
    (internalControlId: string) => {
      void navigate({
        to: '/app/admin/security',
        search: {
          ...search,
          selectedControl: internalControlId,
          tab: 'controls',
        },
      });
    },
    [navigate, search],
  );
  const navigateToReviews = useCallback(() => {
    void navigate({
      to: '/app/admin/security',
      search: {
        ...search,
        tab: 'reviews',
      },
    });
  }, [navigate, search]);
  const handleControlSorting = useCallback(
    (columnId: (typeof CONTROL_TABLE_SORT_FIELDS)[number]) => {
      updateControlSearch({
        sortBy: columnId,
        sortOrder: sortBy === columnId && sortOrder === 'asc' ? 'desc' : 'asc',
        page: 1,
      });
    },
    [sortBy, sortOrder, updateControlSearch],
  );
  const handleControlPageChange = useCallback(
    (nextPage: number) => {
      updateControlSearch({ page: nextPage });
    },
    [updateControlSearch],
  );
  const handleControlPageSizeChange = useCallback(
    (nextPageSize: number) => {
      updateControlSearch({
        page: 1,
        pageSize: CONTROL_PAGE_SIZE_OPTIONS.includes(
          nextPageSize as (typeof CONTROL_PAGE_SIZE_OPTIONS)[number],
        )
          ? (nextPageSize as (typeof CONTROL_PAGE_SIZE_OPTIONS)[number])
          : 10,
      });
    },
    [updateControlSearch],
  );
  const controlColumns = useMemo<ColumnDef<SecurityControlWorkspaceSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'control',
        header: createSortableHeader(
          'Control',
          'control',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <AdminSecurityControlCell control={row.original} />,
      },
      {
        accessorKey: 'responsibility',
        header: createSortableHeader(
          'Responsibility',
          'responsibility',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <AdminSecurityResponsibilityCell control={row.original} />,
      },
      {
        accessorKey: 'evidence',
        header: createSortableHeader(
          'Evidence',
          'evidence',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <AdminSecurityEvidenceReadinessCell control={row.original} />,
      },
      {
        accessorKey: 'family',
        header: createSortableHeader(
          'Frameworks',
          'family',
          controlSearchParams,
          handleControlSorting,
        ),
        cell: ({ row }) => <AdminSecurityFrameworkSummaryCell control={row.original} />,
      },
    ],
    [controlSearchParams, handleControlSorting],
  );
  const handleExportControls = useCallback(async () => {
    setIsExportingControls(true);

    try {
      const detailedControls = (
        await Promise.all(
          sortedControls.map(async (control) => {
            return await convex.query(api.security.getSecurityControlWorkspaceDetail, {
              internalControlId: control.internalControlId,
            });
          }),
        )
      ).filter(
        (control): control is NonNullable<typeof control> => control !== null,
      ) as SecurityControlWorkspace[];
      exportSecurityControlsCsv(detailedControls);
      showToast('Control register exported.', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to export control register',
        'error',
      );
    } finally {
      setIsExportingControls(false);
    }
  }, [convex, showToast, sortedControls]);

  const handleOpenReportDetail = useCallback((reportId: Id<'evidenceReports'>) => {
    setSelectedReportId(reportId);
  }, []);

  const handleAddEvidenceLink = useCallback(
    async (args: {
      description?: string;
      evidenceDate: number;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: SecurityChecklistEvidence['sufficiency'];
      title: string;
      url: string;
    }) => {
      setBusyControlAction(`${args.internalControlId}:${args.itemId}:link`);
      try {
        await addEvidenceLink(args);
        showToast('Evidence link attached.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to attach evidence link',
          'error',
        );
      } finally {
        setBusyControlAction(null);
      }
    },
    [addEvidenceLink, showToast],
  );

  const handleAddEvidenceNote = useCallback(
    async (args: {
      description: string;
      evidenceDate: number;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: SecurityChecklistEvidence['sufficiency'];
      title: string;
    }) => {
      setBusyControlAction(`${args.internalControlId}:${args.itemId}:note`);
      try {
        await addEvidenceNote(args);
        showToast('Evidence note attached.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to attach evidence note',
          'error',
        );
      } finally {
        setBusyControlAction(null);
      }
    },
    [addEvidenceNote, showToast],
  );

  const handleUploadEvidenceFile = useCallback(
    async (args: {
      description?: string;
      evidenceDate: number;
      file: File;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: SecurityChecklistEvidence['sufficiency'];
      title: string;
    }) => {
      setBusyControlAction(`${args.internalControlId}:${args.itemId}:file`);
      try {
        const target = await createEvidenceUploadTarget({
          contentType: args.file.type || 'application/octet-stream',
          fileName: args.file.name,
          fileSize: args.file.size,
          internalControlId: args.internalControlId,
          itemId: args.itemId,
        });
        const uploadedStorageId = await uploadFileWithTarget(args.file, target);
        await finalizeEvidenceUpload({
          backendMode: target.backendMode,
          description: args.description,
          evidenceDate: args.evidenceDate,
          fileName: args.file.name,
          fileSize: args.file.size,
          internalControlId: args.internalControlId,
          itemId: args.itemId,
          mimeType: args.file.type || 'application/octet-stream',
          reviewDueIntervalMonths: args.reviewDueIntervalMonths,
          storageId: uploadedStorageId ?? target.storageId,
          source: args.source,
          sufficiency: args.sufficiency,
          title: args.title,
        });
        showToast('Evidence file uploaded.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to upload evidence file',
          'error',
        );
      } finally {
        setBusyControlAction(null);
      }
    },
    [createEvidenceUploadTarget, finalizeEvidenceUpload, showToast],
  );

  const handleOpenEvidence = useCallback(
    async (evidence: SecurityChecklistEvidence) => {
      if (evidence.evidenceType === 'link' && evidence.url) {
        window.open(evidence.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (evidence.storageId) {
        try {
          const resolved = await createSignedServeUrl({
            storageId: evidence.storageId,
          });
          window.open(resolved.url, '_blank', 'noopener,noreferrer');
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : 'Failed to open evidence file',
            'error',
          );
        }
      }
    },
    [createSignedServeUrl, showToast],
  );

  const handleArchiveEvidence = useCallback(
    async (args: { evidenceId: string; internalControlId: string; itemId: string }) => {
      setBusyControlAction(`${args.evidenceId}:archive`);
      try {
        await archiveControlEvidence(args);
        showToast('Evidence archived.', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to archive evidence', 'error');
      } finally {
        setBusyControlAction(null);
      }
    },
    [archiveControlEvidence, showToast],
  );

  const handleRenewEvidence = useCallback(
    async (args: { evidenceId: string; internalControlId: string; itemId: string }) => {
      setBusyControlAction(`${args.evidenceId}:renew`);
      try {
        await renewControlEvidence(args);
        showToast(
          'Evidence renewed. Review the new copy before it counts toward completion.',
          'success',
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to renew evidence', 'error');
      } finally {
        setBusyControlAction(null);
      }
    },
    [renewControlEvidence, showToast],
  );

  const handleReviewEvidence = useCallback(
    async (args: { evidenceId: string }) => {
      setBusyControlAction(`${args.evidenceId}:review`);
      try {
        await reviewControlEvidence({
          evidenceId: args.evidenceId as Id<'securityControlEvidence'>,
          reviewStatus: 'reviewed',
        });
        showToast('Evidence marked as reviewed.', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to review evidence', 'error');
      } finally {
        setBusyControlAction(null);
      }
    },
    [reviewControlEvidence, showToast],
  );

  const handleGenerateReport = async (
    reportKind: 'audit_readiness' | 'security_posture' = 'security_posture',
  ) => {
    setIsGenerating(true);
    try {
      const generated = await generateEvidenceReport({ reportKind });
      setReport(generated.report);
      setSelectedReportId(generated.id);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReviewReport = async (
    id: Id<'evidenceReports'>,
    reviewStatus: 'needs_follow_up' | 'reviewed',
  ) => {
    setBusyReportAction(`${id}:${reviewStatus}`);
    try {
      await reviewEvidenceReport({
        id,
        internalReviewNotes: reviewNotes[id]?.trim() || undefined,
        reviewStatus,
      });
    } finally {
      setBusyReportAction(null);
    }
  };

  const handleExportReport = async (id: Id<'evidenceReports'>) => {
    setBusyReportAction(`${id}:export`);
    try {
      const exported = await exportEvidenceReport({ id });
      setReport(exported.report);
      setSelectedReportId(id);
    } finally {
      setBusyReportAction(null);
    }
  };

  const handleReviewFinding = useCallback(
    async (findingKey: SecurityFindingListItem['findingKey']) => {
      setBusyFindingKey(findingKey);
      try {
        await reviewSecurityFinding({
          disposition: findingDispositions[findingKey] ?? 'pending_review',
          findingKey,
          internalReviewNotes: findingNotes[findingKey]?.trim() || undefined,
        });
        showToast('Security finding review saved.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to save security finding review.',
          'error',
        );
      } finally {
        setBusyFindingKey(null);
      }
    },
    [findingDispositions, findingNotes, reviewSecurityFinding, showToast],
  );
  const handleOpenFindingFollowUp = useCallback(
    async (finding: SecurityFindingListItem) => {
      setBusyFindingKey(finding.findingKey);
      try {
        await openSecurityFindingFollowUp({
          findingKey: finding.findingKey,
          note: findingNotes[finding.findingKey]?.trim() || undefined,
        });
        showToast('Finding follow-up review created.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to open finding follow-up.',
          'error',
        );
      } finally {
        setBusyFindingKey(null);
      }
    },
    [findingNotes, openSecurityFindingFollowUp, showToast],
  );
  const handleReviewVendor = useCallback(
    async (vendor: VendorWorkspace, reviewStatus: VendorWorkspace['reviewStatus']) => {
      setBusyVendorKey(vendor.vendor);
      try {
        await reviewVendorWorkspace({
          internalReviewNotes: vendorNotes[vendor.vendor]?.trim() || undefined,
          owner: vendorOwners[vendor.vendor]?.trim() || undefined,
          reviewStatus,
          vendorKey: vendor.vendor,
        });
        showToast('Vendor review saved.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to save vendor review.',
          'error',
        );
      } finally {
        setBusyVendorKey(null);
      }
    },
    [reviewVendorWorkspace, showToast, vendorNotes, vendorOwners],
  );

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
      const detail = await finalizeReviewRun({
        reviewRunId: currentAnnualReviewRun.id as Id<'reviewRuns'>,
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
  }, [currentAnnualReviewRun?.id, finalizeReviewRun, showToast]);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review control implementation, evidence posture, vendor boundaries, and security oversight workflows."
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isSecurityTab(value) || value === activeTab) {
            return;
          }

          void navigate({
            to: '/app/admin/security',
            search: {
              ...search,
              tab: value,
              selectedControl: value === 'controls' ? search.selectedControl : undefined,
            },
          });
        }}
      >
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <AdminSecurityOverviewTab controlSummary={controlSummary} summary={summary} />
        </TabsContent>

        <TabsContent value="controls" className="space-y-6">
          <AdminSecurityControlsTab
            controlColumns={controlColumns}
            controlPagination={controlPagination}
            controlSearchParams={controlSearchParams}
            controlSearchTerm={controlSearchTerm}
            controlSummary={controlSummary}
            evidenceReadinessFilter={evidenceReadinessFilter}
            evidenceReadinessOptions={evidenceReadinessOptions}
            familyFilter={familyFilter}
            familyOptions={familyOptions}
            handleControlPageChange={handleControlPageChange}
            handleControlPageSizeChange={handleControlPageSizeChange}
            handleExportControls={handleExportControls}
            isExportingControls={isExportingControls}
            paginatedControls={paginatedControls}
            responsibilityFilter={responsibilityFilter}
            responsibilityOptions={responsibilityOptions}
            sortedControls={sortedControls}
            updateControlSearch={updateControlSearch}
          />
        </TabsContent>

        <TabsContent value="evidence" className="space-y-6">
          <AdminSecurityEvidenceTab
            auditReadiness={auditReadiness}
            auditReadinessSummary={auditReadinessSummary}
            busyFindingKey={busyFindingKey}
            busyReportAction={busyReportAction}
            evidenceReports={evidenceReports}
            findingDispositions={findingDispositions}
            findingNotes={findingNotes}
            findingSummary={findingSummary}
            handleExportReport={handleExportReport}
            handleGenerateReport={handleGenerateReport}
            handleOpenFindingFollowUp={handleOpenFindingFollowUp}
            handleOpenReportDetail={handleOpenReportDetail}
            handleReviewFinding={handleReviewFinding}
            handleReviewReport={handleReviewReport}
            isGenerating={isGenerating}
            navigateToControl={navigateToControl}
            navigateToReviews={navigateToReviews}
            report={report}
            restoreDrillFooter={restoreDrillFooter}
            reviewNotes={reviewNotes}
            securityFindings={securityFindings}
            selectedReportDetail={selectedReportDetail}
            selectedReportId={selectedReportId}
            setFindingDispositions={setFindingDispositions}
            setFindingNotes={setFindingNotes}
            setReviewNotes={setReviewNotes}
          />
        </TabsContent>

        <TabsContent value="reviews" className="space-y-6">
          <AdminSecurityReviewsTab
            autoCollectedEvidenceLinks={autoCollectedEvidenceLinks}
            busyReviewRunAction={busyReviewRunAction}
            busyReviewTaskAction={busyReviewTaskAction}
            currentAnnualReviewRun={currentAnnualReviewRun}
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
        </TabsContent>

        <TabsContent value="vendors">
          <AdminSecurityVendorsTab
            busyVendorKey={busyVendorKey}
            handleReviewVendor={handleReviewVendor}
            navigateToControl={navigateToControl}
            navigateToReviews={navigateToReviews}
            setVendorNotes={setVendorNotes}
            setVendorOwners={setVendorOwners}
            vendorNotes={vendorNotes}
            vendorOwners={vendorOwners}
            vendorWorkspaces={vendorWorkspaces}
          />
        </TabsContent>
      </Tabs>

      <Sheet
        open={selectedControlId !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateControlSearch({ selectedControl: undefined });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {selectedControl === undefined && selectedControlId ? (
            <div className="p-4 text-sm text-muted-foreground">Loading control detail…</div>
          ) : selectedControl ? (
            <AdminSecurityControlDetail
              busyAction={busyControlAction}
              control={selectedControl}
              onAddEvidenceLink={handleAddEvidenceLink}
              onAddEvidenceNote={handleAddEvidenceNote}
              onArchiveEvidence={handleArchiveEvidence}
              onOpenEvidence={handleOpenEvidence}
              onOpenReviews={navigateToReviews}
              onReviewEvidence={handleReviewEvidence}
              onRenewEvidence={handleRenewEvidence}
              onUploadEvidenceFile={handleUploadEvidenceFile}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
