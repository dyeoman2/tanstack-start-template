import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSortableHeader } from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useToast } from '~/components/ui/toast';
import {
  AdminSecurityControlCell,
  AdminSecurityFrameworkSummaryCell,
  AdminSecurityResponsibilityCell,
  AdminSecuritySupportCell,
} from '~/features/security/components/AdminSecurityControlCells';
import { AdminSecurityControlDetail } from '~/features/security/components/AdminSecurityControlDetail';
import { AdminSecurityPolicyDetail } from '~/features/security/components/AdminSecurityPolicyDetail';
import {
  AdminSecurityControlsTab,
  AdminSecurityOperationsTab,
  AdminSecurityOverviewTab,
  AdminSecurityPoliciesTab,
  AdminSecurityReviewsTab,
} from '~/features/security/components/tabs/AdminSecurityTabSections';
import {
  CONTROL_PAGE_SIZE_OPTIONS,
  CONTROL_TABLE_SORT_FIELDS,
  SECURITY_TAB_PATHS,
  SECURITY_TABS,
} from '~/features/security/constants';
import { mergeReviewRunSummaryWithDetail } from '~/features/security/formatters';
import { useSecurityControlTable } from '~/features/security/hooks/useSecurityControlTable';
import type {
  SecurityCompatSearch,
  SecurityControlsSearch,
  SecurityOperationsSearch,
  SecurityPoliciesSearch,
  SecurityTab,
} from '~/features/security/search';
import type {
  EvidenceReportDetail,
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  ReviewRunDetail,
  ReviewRunSummary,
  ReviewTaskDetail,
  SecurityChecklistEvidence,
  SecurityControlWorkspace,
  SecurityControlWorkspaceExport,
  SecurityControlWorkspaceSummary,
  SecurityFindingListItem,
  SecurityOperationDetail,
  SecurityOperationsBoard,
  SecurityPolicyDetail,
  SecurityPolicySummary,
  SecurityWorkspaceOverview,
  VendorWorkspace,
} from '~/features/security/types';
import { exportSecurityControlsCsv } from '~/features/security/utils/exportSecurityControlsCsv';
import { uploadFileWithTarget } from '~/features/security/utils/upload';

function isSecurityTab(value: string): value is SecurityTab {
  return SECURITY_TABS.includes(value as SecurityTab);
}

function getSecurityPath(tab: SecurityTab) {
  return SECURITY_TAB_PATHS[tab];
}

const EMPTY_CONTROL_SUMMARY = {
  byResponsibility: {
    customer: 0,
    platform: 0,
    sharedResponsibility: 0,
  },
  bySupport: {
    complete: 0,
    missing: 0,
    partial: 0,
  },
  totalControls: 0,
};

function getCompatSearchForTab(tab: SecurityTab, search: SecurityCompatSearch) {
  switch (tab) {
    case 'controls':
      return {
        family: search.family,
        page: search.page,
        pageSize: search.pageSize,
        responsibility: search.responsibility,
        search: search.search,
        selectedControl: search.selectedControl,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
        support: search.support,
      };
    case 'policies':
      return {
        selectedPolicy: search.selectedPolicy,
      };
    case 'operations':
      return {
        selectedOperationId: search.selectedOperationId,
        selectedOperationType: search.selectedOperationType,
      };
    case 'overview':
    case 'reviews':
      return {};
  }
}

function useSecurityNavigation() {
  const navigate = useNavigate();

  const navigateToControl = useCallback(
    (internalControlId: string) => {
      void navigate({
        to: getSecurityPath('controls'),
        search: {
          selectedControl: internalControlId,
        },
      });
    },
    [navigate],
  );

  const navigateToPolicy = useCallback(
    (policyId: string) => {
      void navigate({
        to: getSecurityPath('policies'),
        search: {
          selectedPolicy: policyId,
        },
      });
    },
    [navigate],
  );

  const navigateToOperation = useCallback(
    (
      operationType: 'evidence_report' | 'finding' | 'vendor_review' | 'review_run',
      operationId: string,
    ) => {
      void navigate({
        to: getSecurityPath('operations'),
        search: {
          selectedOperationId: operationId,
          selectedOperationType: operationType,
        },
      });
    },
    [navigate],
  );

  const navigateToReviews = useCallback(() => {
    void navigate({
      to: getSecurityPath('reviews'),
    });
  }, [navigate]);

  return {
    navigateToControl,
    navigateToOperation,
    navigateToPolicy,
    navigateToReviews,
  };
}

function SecurityPageShell(props: { activeTab: SecurityTab; children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review control implementation, evidence posture, vendor boundaries, and security oversight workflows."
      />

      <Tabs
        value={props.activeTab}
        onValueChange={(value) => {
          if (!isSecurityTab(value) || value === props.activeTab) {
            return;
          }

          void navigate({
            to: getSecurityPath(value),
          });
        }}
      >
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
        </TabsList>
      </Tabs>

      {props.children}
    </div>
  );
}

export function AdminSecurityLayout(props: {
  children: React.ReactNode;
  search: SecurityCompatSearch;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname !== getSecurityPath('overview')) {
      return;
    }

    if (!props.search.tab || props.search.tab === 'overview') {
      return;
    }

    const nextTab = isSecurityTab(props.search.tab) ? props.search.tab : 'overview';

    void navigate({
      replace: true,
      search: getCompatSearchForTab(nextTab, props.search),
      to: getSecurityPath(nextTab),
    });
  }, [location.pathname, navigate, props.search]);

  const activeTab = useMemo<SecurityTab>(() => {
    const pathname = location.pathname;

    if (pathname === getSecurityPath('controls')) return 'controls';
    if (pathname === getSecurityPath('policies')) return 'policies';
    if (pathname === getSecurityPath('operations')) return 'operations';
    if (pathname === getSecurityPath('reviews')) return 'reviews';
    return 'overview';
  }, [location.pathname]);

  return <SecurityPageShell activeTab={activeTab}>{props.children}</SecurityPageShell>;
}

export function AdminSecurityOverviewRoute() {
  const workspaceOverview = useQuery(api.securityPosture.getSecurityWorkspaceOverview, {}) as
    | SecurityWorkspaceOverview
    | undefined;

  return (
    <AdminSecurityOverviewTab
      controlSummary={workspaceOverview?.controlSummary ?? EMPTY_CONTROL_SUMMARY}
      summary={workspaceOverview?.postureSummary}
    />
  );
}

export function AdminSecurityControlsRoute(props: { search: SecurityControlsSearch }) {
  const navigate = useNavigate();
  const convex = useConvex();
  const { showToast } = useToast();
  const { navigateToOperation, navigateToReviews } = useSecurityNavigation();
  const search = props.search;
  const {
    family: familyFilter,
    page,
    pageSize,
    responsibility: responsibilityFilter,
    search: controlSearchTerm,
    selectedControl: selectedControlId,
    sortBy,
    sortOrder,
    support: supportFilter,
  } = search;
  const workspaceOverview = useQuery(api.securityPosture.getSecurityWorkspaceOverview, {}) as
    | SecurityWorkspaceOverview
    | undefined;
  const controlWorkspaces = useQuery(api.securityWorkspace.listSecurityControlWorkspaces, {}) as
    | SecurityControlWorkspaceSummary[]
    | undefined;
  const selectedControl = useQuery(
    api.securityWorkspace.getSecurityControlWorkspaceDetail,
    selectedControlId ? { internalControlId: selectedControlId } : 'skip',
  ) as SecurityControlWorkspace | null | undefined;
  const reviewControlEvidence = useMutation(api.securityWorkspace.reviewSecurityControlEvidence);
  const addEvidenceLink = useMutation(api.securityWorkspace.addSecurityControlEvidenceLink);
  const addEvidenceNote = useMutation(api.securityWorkspace.addSecurityControlEvidenceNote);
  const archiveControlEvidence = useMutation(api.securityWorkspace.archiveSecurityControlEvidence);
  const createEvidenceUploadTarget = useAction(
    api.securityWorkspace.createSecurityControlEvidenceUploadTarget,
  );
  const finalizeEvidenceUpload = useAction(
    api.securityWorkspace.finalizeSecurityControlEvidenceUpload,
  );
  const renewControlEvidence = useMutation(api.securityWorkspace.renewSecurityControlEvidence);
  const createSignedServeUrl = useAction(api.fileServing.createSignedServeUrl);
  const [isExportingControls, setIsExportingControls] = useState(false);
  const [busyControlAction, setBusyControlAction] = useState<string | null>(null);
  const controls = useMemo(() => controlWorkspaces ?? [], [controlWorkspaces]);
  const controlSummary = useMemo(() => {
    if (workspaceOverview?.controlSummary) {
      return workspaceOverview.controlSummary;
    }

    return controls.reduce(
      (summaryAccumulator, control) => {
        summaryAccumulator.totalControls += 1;
        if (control.responsibility === 'shared-responsibility') {
          summaryAccumulator.byResponsibility.sharedResponsibility += 1;
        } else if (control.responsibility) {
          summaryAccumulator.byResponsibility[control.responsibility] += 1;
        }
        summaryAccumulator.bySupport[control.support] += 1;
        return summaryAccumulator;
      },
      {
        totalControls: 0,
        byResponsibility: {
          customer: 0,
          platform: 0,
          sharedResponsibility: 0,
        },
        bySupport: {
          complete: 0,
          missing: 0,
          partial: 0,
        },
      },
    );
  }, [controls, workspaceOverview]);
  const {
    controlPagination,
    controlSearchParams,
    familyOptions,
    paginatedControls,
    responsibilityOptions,
    sortedControls,
    supportOptions,
  } = useSecurityControlTable({
    controls,
    familyFilter,
    page,
    pageSize,
    responsibilityFilter,
    searchTerm: controlSearchTerm,
    sortBy,
    sortOrder,
    supportFilter,
  });

  const updateControlSearch = useCallback(
    (
      updates: Partial<{
        family: string;
        page: number;
        pageSize: (typeof CONTROL_PAGE_SIZE_OPTIONS)[number];
        responsibility: 'all' | NonNullable<SecurityControlWorkspaceSummary['responsibility']>;
        search: string;
        selectedControl: string | undefined;
        sortBy: (typeof CONTROL_TABLE_SORT_FIELDS)[number];
        sortOrder: 'asc' | 'desc';
        support: 'all' | SecurityControlWorkspaceSummary['support'];
      }>,
    ) => {
      void navigate({
        search: {
          ...search,
          ...updates,
        },
        to: getSecurityPath('controls'),
      });
    },
    [navigate, search],
  );

  const handleControlSorting = useCallback(
    (columnId: (typeof CONTROL_TABLE_SORT_FIELDS)[number]) => {
      updateControlSearch({
        page: 1,
        sortBy: columnId,
        sortOrder: sortBy === columnId && sortOrder === 'asc' ? 'desc' : 'asc',
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
        cell: ({ row }) => <AdminSecurityControlCell control={row.original} />,
        header: createSortableHeader(
          'Control',
          'control',
          controlSearchParams,
          handleControlSorting,
        ),
      },
      {
        accessorKey: 'responsibility',
        cell: ({ row }) => <AdminSecurityResponsibilityCell control={row.original} />,
        header: createSortableHeader(
          'Responsibility',
          'responsibility',
          controlSearchParams,
          handleControlSorting,
        ),
      },
      {
        accessorKey: 'support',
        cell: ({ row }) => <AdminSecuritySupportCell control={row.original} />,
        header: createSortableHeader(
          'Support',
          'support',
          controlSearchParams,
          handleControlSorting,
        ),
      },
      {
        accessorKey: 'family',
        cell: ({ row }) => <AdminSecurityFrameworkSummaryCell control={row.original} />,
        header: createSortableHeader(
          'Frameworks',
          'family',
          controlSearchParams,
          handleControlSorting,
        ),
      },
    ],
    [controlSearchParams, handleControlSorting],
  );

  const handleExportControls = useCallback(async () => {
    setIsExportingControls(true);

    try {
      const exportControls = (await convex.query(
        api.securityWorkspace.listSecurityControlWorkspaceExports,
        {
          controlIds: sortedControls.map((control) => control.internalControlId),
        },
      )) as SecurityControlWorkspaceExport[];
      exportSecurityControlsCsv(exportControls);
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
          source: args.source,
          storageId: uploadedStorageId ?? target.storageId,
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

  const handleOpenLinkedEntity = useCallback(
    (entity: SecurityControlWorkspace['linkedEntities'][number]) => {
      switch (entity.entityType) {
        case 'control':
          void navigate({
            search: {
              ...search,
              selectedControl: entity.entityId,
            },
            to: getSecurityPath('controls'),
          });
          return;
        case 'review_run':
        case 'review_task':
          navigateToReviews();
          return;
        case 'evidence_report':
        case 'finding':
        case 'vendor_review':
          navigateToOperation(entity.entityType, entity.entityId);
          return;
        default:
          return;
      }
    },
    [navigate, navigateToOperation, navigateToReviews, search],
  );

  return (
    <>
      <AdminSecurityControlsTab
        controlColumns={controlColumns}
        controlPagination={controlPagination}
        controlSearchParams={controlSearchParams}
        controlSearchTerm={controlSearchTerm}
        controlSummary={controlSummary}
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
        supportFilter={supportFilter}
        supportOptions={supportOptions}
        updateControlSearch={updateControlSearch}
      />

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
          {!selectedControl ? (
            <SheetHeader className="sr-only">
              <SheetTitle>Security control detail</SheetTitle>
              <SheetDescription>
                Review the selected security control, its checklist, and linked operations.
              </SheetDescription>
            </SheetHeader>
          ) : null}
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
              onOpenLinkedEntity={handleOpenLinkedEntity}
              onOpenReviews={navigateToReviews}
              onRenewEvidence={handleRenewEvidence}
              onReviewEvidence={handleReviewEvidence}
              onUploadEvidenceFile={handleUploadEvidenceFile}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminSecurityRoute(props: {
  search: SecurityCompatSearch & {
    family?: string;
    page?: number;
    pageSize?: 10 | 20 | 50;
    responsibility?: 'all' | 'platform' | 'shared-responsibility' | 'customer';
    search?: string;
    sortBy?: 'control' | 'support' | 'responsibility' | 'family';
    sortOrder?: 'asc' | 'desc';
    support?: 'all' | 'complete' | 'partial' | 'missing';
    tab?: SecurityTab;
  };
}) {
  const activeTab = props.search.tab ?? 'overview';

  return (
    <SecurityPageShell activeTab={activeTab}>
      {activeTab === 'overview' ? <AdminSecurityOverviewRoute /> : null}
      {activeTab === 'controls' ? (
        <AdminSecurityControlsRoute
          search={{
            family: props.search.family ?? 'all',
            page: props.search.page ?? 1,
            pageSize: props.search.pageSize ?? 10,
            responsibility: props.search.responsibility ?? 'all',
            search: props.search.search ?? '',
            selectedControl: props.search.selectedControl,
            sortBy: props.search.sortBy ?? 'control',
            sortOrder: props.search.sortOrder ?? 'asc',
            support: props.search.support ?? 'all',
          }}
        />
      ) : null}
      {activeTab === 'policies' ? (
        <AdminSecurityPoliciesRoute
          search={{
            selectedPolicy: props.search.selectedPolicy,
          }}
        />
      ) : null}
      {activeTab === 'operations' ? (
        <AdminSecurityOperationsRoute
          search={{
            selectedOperationId: props.search.selectedOperationId,
            selectedOperationType: props.search.selectedOperationType,
          }}
        />
      ) : null}
      {activeTab === 'reviews' ? <AdminSecurityReviewsRoute /> : null}
    </SecurityPageShell>
  );
}

export function AdminSecurityPoliciesRoute(props: { search: SecurityPoliciesSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl } = useSecurityNavigation();
  const selectedPolicyId = props.search.selectedPolicy;
  const policySummaries = useQuery(api.securityPolicies.listSecurityPolicies, {}) as
    | SecurityPolicySummary[]
    | undefined;
  const selectedPolicy = useQuery(
    api.securityPolicies.getSecurityPolicyDetail,
    selectedPolicyId ? { policyId: selectedPolicyId } : 'skip',
  ) as SecurityPolicyDetail | null | undefined;
  const syncSecurityPoliciesFromSeed = useAction(api.securityPolicies.syncSecurityPoliciesFromSeed);
  const [isSyncingPolicies, setIsSyncingPolicies] = useState(false);

  const handleSyncPolicies = useCallback(async () => {
    setIsSyncingPolicies(true);
    try {
      await syncSecurityPoliciesFromSeed({});
      showToast('Policy catalog synced from repo markdown.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to sync policies.', 'error');
    } finally {
      setIsSyncingPolicies(false);
    }
  }, [showToast, syncSecurityPoliciesFromSeed]);

  return (
    <>
      <AdminSecurityPoliciesTab
        busySync={isSyncingPolicies}
        onOpenPolicy={(policyId) => {
          void navigate({
            search: {
              selectedPolicy: policyId,
            },
            to: getSecurityPath('policies'),
          });
        }}
        onSyncPolicies={handleSyncPolicies}
        policies={policySummaries}
      />

      <Sheet
        open={selectedPolicyId !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          void navigate({
            search: {
              selectedPolicy: undefined,
            },
            to: getSecurityPath('policies'),
          });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Security policy detail</SheetTitle>
            <SheetDescription>
              Review the selected policy, its mapped controls, and annual review linkage.
            </SheetDescription>
          </SheetHeader>
          {selectedPolicy === undefined && selectedPolicyId ? (
            <div className="p-4 text-sm text-muted-foreground">Loading policy detail…</div>
          ) : selectedPolicy ? (
            <AdminSecurityPolicyDetail onOpenControl={navigateToControl} policy={selectedPolicy} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminSecurityOperationsRoute(props: { search: SecurityOperationsSearch }) {
  const { showToast } = useToast();
  const { navigateToControl, navigateToOperation, navigateToReviews } = useSecurityNavigation();
  const { selectedOperationId, selectedOperationType } = props.search;
  const [report, setReport] = useState<string | null>(null);
  const [localSelectedReportId, setLocalSelectedReportId] = useState<Id<'evidenceReports'> | null>(
    null,
  );
  const operationsBoard = useQuery(api.securityPosture.getSecurityOperationsBoard, {}) as
    | SecurityOperationsBoard
    | undefined;
  const selectedReportId = useMemo(() => {
    if (selectedOperationType === 'evidence_report' && selectedOperationId) {
      return selectedOperationId as Id<'evidenceReports'>;
    }
    return localSelectedReportId;
  }, [localSelectedReportId, selectedOperationId, selectedOperationType]);
  const selectedReportDetail = useQuery(
    api.securityReports.getEvidenceReportDetail,
    selectedReportId ? { id: selectedReportId } : 'skip',
  ) as EvidenceReportDetail | null | undefined;
  const generateEvidenceReport = useAction(api.securityReports.generateEvidenceReport);
  const exportEvidenceReport = useAction(api.securityReports.exportEvidenceReport);
  const reviewEvidenceReport = useMutation(api.securityReports.reviewEvidenceReport);
  const reviewSecurityFinding = useMutation(api.securityWorkspace.reviewSecurityFinding);
  const openSecurityFindingFollowUp = useMutation(
    api.securityWorkspace.openSecurityFindingFollowUp,
  );
  const reviewVendorWorkspace = useMutation(api.securityReports.reviewVendorWorkspace);
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [reportCustomerSummaries, setReportCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [findingNotes, setFindingNotes] = useState<Record<string, string>>({});
  const [findingCustomerSummaries, setFindingCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [findingDispositions, setFindingDispositions] = useState<
    Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
  >({});
  const [vendorNotes, setVendorNotes] = useState<Record<string, string>>({});
  const [vendorCustomerSummaries, setVendorCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [vendorOwners, setVendorOwners] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);
  const [busyFindingKey, setBusyFindingKey] = useState<string | null>(null);
  const [busyVendorKey, setBusyVendorKey] = useState<string | null>(null);
  const evidenceReports = operationsBoard?.evidenceReports;
  const securityFindings = operationsBoard?.findings;
  const vendorWorkspaces = operationsBoard?.vendorWorkspaces;
  const triggeredReviewRuns = operationsBoard?.triggeredReviewRuns;
  const auditReadiness = operationsBoard?.auditReadiness;
  const resolvedSelectedOperationType =
    selectedOperationType ?? (selectedReportId ? 'evidence_report' : undefined);
  const resolvedSelectedOperationId = selectedOperationId ?? selectedReportId ?? undefined;
  const selectedOperationDetail = useMemo<SecurityOperationDetail | null>(() => {
    if (!resolvedSelectedOperationId || !resolvedSelectedOperationType) {
      return null;
    }

    switch (resolvedSelectedOperationType) {
      case 'evidence_report': {
        const reportItem =
          (selectedReportDetail ?? null) ||
          evidenceReports?.find((entry) => entry.id === resolvedSelectedOperationId);
        if (!reportItem) {
          return null;
        }
        return {
          id: resolvedSelectedOperationId as Id<'evidenceReports'>,
          kind: 'evidence_report',
          report: reportItem,
          status: reportItem.reviewStatus,
          title: `${reportItem.reportKind} report`,
        };
      }
      case 'finding': {
        const finding = securityFindings?.find(
          (entry) => entry.findingKey === resolvedSelectedOperationId,
        );
        if (!finding) {
          return null;
        }
        return {
          finding,
          id: finding.findingKey,
          kind: 'finding',
          status: finding.disposition,
          title: finding.title,
        };
      }
      case 'vendor_review': {
        const vendorReview = vendorWorkspaces?.find(
          (entry) => entry.vendor === resolvedSelectedOperationId,
        );
        if (!vendorReview) {
          return null;
        }
        return {
          id: vendorReview.vendor,
          kind: 'vendor_review',
          status: vendorReview.reviewStatus,
          title: vendorReview.displayName,
          vendorReview,
        };
      }
      case 'review_run': {
        const reviewRun = triggeredReviewRuns?.find(
          (entry) => entry.id === resolvedSelectedOperationId,
        );
        if (!reviewRun) {
          return null;
        }
        return {
          id: reviewRun.id,
          kind: 'review_run',
          reviewRun,
          status: reviewRun.status,
          title: reviewRun.title,
        };
      }
    }
  }, [
    evidenceReports,
    resolvedSelectedOperationId,
    resolvedSelectedOperationType,
    securityFindings,
    selectedReportDetail,
    triggeredReviewRuns,
    vendorWorkspaces,
  ]);
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
    return {
      openCount: findingItems.filter((finding) => finding.status === 'open').length,
      reviewPendingCount: findingItems.filter((finding) => finding.disposition === 'pending_review')
        .length,
      totalCount: findingItems.length,
    };
  }, [securityFindings]);

  const handleGenerateReport = async (
    reportKind: 'audit_readiness' | 'security_posture' = 'security_posture',
  ) => {
    setIsGenerating(true);
    try {
      const generated = await generateEvidenceReport({ reportKind });
      setReport(generated.report);
      setLocalSelectedReportId(generated.id);
      navigateToOperation('evidence_report', generated.id);
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
        customerSummary: reportCustomerSummaries[id]?.trim() || undefined,
        id,
        internalNotes: reportNotes[id]?.trim() || undefined,
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
      setLocalSelectedReportId(id);
      navigateToOperation('evidence_report', id);
    } finally {
      setBusyReportAction(null);
    }
  };

  const handleReviewFinding = useCallback(
    async (findingKey: SecurityFindingListItem['findingKey']) => {
      setBusyFindingKey(findingKey);
      try {
        await reviewSecurityFinding({
          customerSummary: findingCustomerSummaries[findingKey]?.trim() || undefined,
          disposition: findingDispositions[findingKey] ?? 'pending_review',
          findingKey,
          internalNotes: findingNotes[findingKey]?.trim() || undefined,
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
    [findingCustomerSummaries, findingDispositions, findingNotes, reviewSecurityFinding, showToast],
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
          customerSummary: vendorCustomerSummaries[vendor.vendor]?.trim() || undefined,
          internalNotes: vendorNotes[vendor.vendor]?.trim() || undefined,
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
    [reviewVendorWorkspace, showToast, vendorCustomerSummaries, vendorNotes, vendorOwners],
  );

  const handleOpenReportDetail = useCallback(
    (reportId: Id<'evidenceReports'>) => {
      setLocalSelectedReportId(reportId);
      navigateToOperation('evidence_report', reportId);
    },
    [navigateToOperation],
  );

  const handleSelectOperation = useCallback(
    (
      operationType: 'evidence_report' | 'finding' | 'vendor_review' | 'review_run',
      operationId: string,
    ) => {
      if (operationType === 'evidence_report') {
        setLocalSelectedReportId(operationId as Id<'evidenceReports'>);
      } else {
        setLocalSelectedReportId(null);
      }
      navigateToOperation(operationType, operationId);
    },
    [navigateToOperation],
  );

  return (
    <AdminSecurityOperationsTab
      auditReadiness={auditReadiness}
      auditReadinessSummary={auditReadinessSummary}
      busyFindingKey={busyFindingKey}
      busyReportAction={busyReportAction}
      busyVendorKey={busyVendorKey}
      evidenceReports={evidenceReports}
      findingCustomerSummaries={findingCustomerSummaries}
      findingDispositions={findingDispositions}
      findingNotes={findingNotes}
      findingSummary={findingSummary}
      handleExportReport={handleExportReport}
      handleGenerateReport={handleGenerateReport}
      handleOpenFindingFollowUp={handleOpenFindingFollowUp}
      handleOpenReportDetail={handleOpenReportDetail}
      handleReviewFinding={handleReviewFinding}
      handleReviewReport={handleReviewReport}
      handleReviewVendor={handleReviewVendor}
      isGenerating={isGenerating}
      navigateToControl={navigateToControl}
      navigateToReviews={navigateToReviews}
      onSelectOperation={handleSelectOperation}
      report={report}
      reportCustomerSummaries={reportCustomerSummaries}
      reportNotes={reportNotes}
      restoreDrillFooter={restoreDrillFooter}
      securityFindings={securityFindings}
      selectedOperationDetail={selectedOperationDetail}
      selectedOperationId={resolvedSelectedOperationId}
      selectedOperationType={resolvedSelectedOperationType}
      setFindingCustomerSummaries={setFindingCustomerSummaries}
      setFindingDispositions={setFindingDispositions}
      setFindingNotes={setFindingNotes}
      setReportCustomerSummaries={setReportCustomerSummaries}
      setReportNotes={setReportNotes}
      setVendorCustomerSummaries={setVendorCustomerSummaries}
      setVendorNotes={setVendorNotes}
      setVendorOwners={setVendorOwners}
      triggeredReviewRuns={triggeredReviewRuns}
      vendorCustomerSummaries={vendorCustomerSummaries}
      vendorNotes={vendorNotes}
      vendorOwners={vendorOwners}
      vendorWorkspaces={vendorWorkspaces}
    />
  );
}

export function AdminSecurityReviewsRoute() {
  const { showToast } = useToast();
  const { navigateToControl } = useSecurityNavigation();
  const refreshReviewRunAutomation = useAction(api.securityReviews.refreshReviewRunAutomation);
  const finalizeReviewRun = useAction(api.securityReviews.finalizeReviewRun);
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
  const [busyReviewRunAction, setBusyReviewRunAction] = useState<string | null>(null);
  const [busyReviewTaskAction, setBusyReviewTaskAction] = useState<string | null>(null);
  const [isPreparingAnnualReview, setIsPreparingAnnualReview] = useState(false);
  const [reviewTaskNotes, setReviewTaskNotes] = useState<Record<string, string>>({});
  const [reviewTaskDocuments, setReviewTaskDocuments] = useState<
    Record<string, { label: string; url: string; version: string }>
  >({});
  const [newTriggeredReviewTitle, setNewTriggeredReviewTitle] = useState('');
  const [newTriggeredReviewType, setNewTriggeredReviewType] = useState('manual_follow_up');
  const reviewsInitializedRef = useRef(false);
  const reviewsRefreshedForRunRef = useRef<string | null>(null);

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
      blocked: currentAnnualReviewDetail?.tasks.filter((task) => task.status === 'blocked') ?? [],
      needsAttestation:
        currentAnnualReviewDetail?.tasks.filter(
          (task) => task.taskType === 'attestation' && task.status !== 'completed',
        ) ?? [],
      needsDocumentUpload:
        currentAnnualReviewDetail?.tasks.filter(
          (task) => task.taskType === 'document_upload' && task.status !== 'completed',
        ) ?? [],
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
  );
}
