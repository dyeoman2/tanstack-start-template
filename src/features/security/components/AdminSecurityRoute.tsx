import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSortableHeader } from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Spinner } from '~/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useToast } from '~/components/ui/toast';
import {
  AdminSecurityControlCell,
  AdminSecurityFrameworkSummaryCell,
  AdminSecurityResponsibilityCell,
  AdminSecuritySupportCell,
} from '~/features/security/components/AdminSecurityControlCells';
import { AdminSecurityControlDetail } from '~/features/security/components/AdminSecurityControlDetail';
import { AdminSecurityFindingDetail } from '~/features/security/components/AdminSecurityFindingDetail';
import { AdminSecurityPolicyDetail } from '~/features/security/components/AdminSecurityPolicyDetail';
import { AdminSecurityReportDetail } from '~/features/security/components/AdminSecurityReportDetail';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  getSecurityPath,
  isSecurityTab,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import {
  AdminSecurityControlsTab,
  AdminSecurityOverviewTab,
  AdminSecurityPoliciesTab,
  AdminSecurityReviewsTab,
  AdminSecurityVendorsTab,
} from '~/features/security/components/tabs/AdminSecurityTabSections';
import { AdminSecurityFindingsTab } from '~/features/security/components/tabs/AdminSecurityFindingsTab';
import { AdminSecurityReportsTab } from '~/features/security/components/tabs/AdminSecurityReportsTab';
import { CONTROL_TABLE_SORT_FIELDS, POLICY_TABLE_SORT_FIELDS } from '~/features/security/constants';
import {
  formatVendorDecisionSummary,
  formatVendorRuntimePosture,
  getVendorGovernanceState,
  getVendorPrimaryActionLabel,
  getVendorPrimaryStatus,
  mergeReviewRunSummaryWithDetail,
} from '~/features/security/formatters';
import { useSecurityControlTable } from '~/features/security/hooks/useSecurityControlTable';
import type {
  SecurityCompatSearch,
  SecurityControlsSearch,
  SecurityFindingsSearch,
  SecurityPoliciesSearch,
  SecurityReportsSearch,
  SecurityTab,
  SecurityVendorsSearch,
  SecurityReviewsSearch,
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
  SecurityFindingsBoard,
  SecurityFindingListItem,
  SecurityPolicyDetail,
  SecurityPolicySummary,
  SecurityReportsBoard,
  SecurityWorkspaceOverview,
  VendorWorkspace,
} from '~/features/security/types';
import { exportSecurityControlsCsv } from '~/features/security/utils/exportSecurityControlsCsv';
import { uploadFileWithTarget } from '~/features/security/utils/upload';

function getCompatSearchForTab(tab: SecurityTab, search: SecurityCompatSearch) {
  switch (tab) {
    case 'controls':
      return {
        family: search.family,
        responsibility: search.responsibility,
        search: search.search,
        selectedControl: search.selectedControl,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
        support: search.support,
      };
    case 'policies':
      return {
        policySearch: search.policySearch,
        policySortBy: search.policySortBy,
        policySortOrder: search.policySortOrder,
        policySupport: search.policySupport,
        selectedPolicy: search.selectedPolicy,
      };
    case 'findings':
      return {
        selectedFinding: search.selectedFinding,
      };
    case 'reports':
      return {
        selectedReport: search.selectedReport,
      };
    case 'vendors':
      return {
        selectedVendor: search.selectedVendor,
      };
    case 'reviews':
      return {
        selectedReviewRun: search.selectedReviewRun,
      };
    case 'overview':
      return {};
  }
}

function SecurityPageShell(props: { activeTab: SecurityTab; children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review controls, policies, vendors, findings, evidence reports, and review workflows."
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
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
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

    const nextTab = isSecurityTab(props.search.tab ?? '') ? props.search.tab : 'overview';

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
    if (pathname === getSecurityPath('vendors')) return 'vendors';
    if (pathname === getSecurityPath('findings')) return 'findings';
    if (pathname === getSecurityPath('reports')) return 'reports';
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
      controlSummary={workspaceOverview?.controlSummary}
      summary={workspaceOverview?.postureSummary}
    />
  );
}

export function AdminSecurityControlsRoute(props: { search: SecurityControlsSearch }) {
  const navigate = useNavigate();
  const convex = useConvex();
  const { showToast } = useToast();
  const { navigateToFinding, navigateToReport, navigateToReviews, navigateToVendor } =
    useSecurityNavigation();
  const search = props.search;
  const {
    family: familyFilter,
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

    if (controlWorkspaces === undefined) {
      return undefined;
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
  }, [controlWorkspaces, controls, workspaceOverview]);
  const {
    controlSearchParams,
    familyOptions,
    responsibilityOptions,
    sortedControls,
    supportOptions,
  } = useSecurityControlTable({
    controls,
    familyFilter,
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
        sortBy: columnId,
        sortOrder: sortBy === columnId && sortOrder === 'asc' ? 'desc' : 'asc',
      });
    },
    [sortBy, sortOrder, updateControlSearch],
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
          navigateToReport(entity.entityId);
          return;
        case 'finding':
          navigateToFinding(entity.entityId);
          return;
        case 'vendor_review':
          navigateToVendor(entity.entityId as VendorWorkspace['vendor']);
          return;
        default:
          return;
      }
    },
    [navigate, navigateToFinding, navigateToReport, navigateToReviews, navigateToVendor, search],
  );

  return (
    <>
      <AdminSecurityControlsTab
        controlColumns={controlColumns}
        controlSearchParams={controlSearchParams}
        controlSearchTerm={controlSearchTerm}
        controlSummary={controlSummary}
        familyFilter={familyFilter}
        familyOptions={familyOptions}
        handleExportControls={handleExportControls}
        isExportingControls={isExportingControls}
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
                Review the selected security control, its checklist, and linked governance context.
              </SheetDescription>
            </SheetHeader>
          ) : null}
          {selectedControl === undefined && selectedControlId ? (
            <DetailLoadingState label="Loading control detail" />
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
    policySearch?: string;
    policySortBy?: (typeof POLICY_TABLE_SORT_FIELDS)[number];
    policySortOrder?: 'asc' | 'desc';
    policySupport?: 'all' | 'complete' | 'partial' | 'missing';
    responsibility?: 'all' | 'platform' | 'shared-responsibility' | 'customer';
    search?: string;
    selectedFinding?: string;
    selectedReport?: string;
    selectedReviewRun?: string;
    selectedVendor?: string;
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
            policySearch: props.search.policySearch ?? '',
            policySortBy: props.search.policySortBy ?? 'title',
            policySortOrder: props.search.policySortOrder ?? 'asc',
            policySupport: props.search.policySupport ?? 'all',
            selectedPolicy: props.search.selectedPolicy,
          }}
        />
      ) : null}
      {activeTab === 'vendors' ? (
        <AdminSecurityVendorsRoute
          search={{
            selectedVendor: props.search.selectedVendor,
          }}
        />
      ) : null}
      {activeTab === 'findings' ? (
        <AdminSecurityFindingsRoute
          search={{
            selectedFinding: props.search.selectedFinding,
          }}
        />
      ) : null}
      {activeTab === 'reports' ? (
        <AdminSecurityReportsRoute
          search={{
            selectedReport: props.search.selectedReport,
          }}
        />
      ) : null}
      {activeTab === 'reviews' ? (
        <AdminSecurityReviewsRoute
          search={{
            selectedReviewRun: props.search.selectedReviewRun,
          }}
        />
      ) : null}
    </SecurityPageShell>
  );
}

export function AdminSecurityPoliciesRoute(props: { search: SecurityPoliciesSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl } = useSecurityNavigation();
  const {
    policySearch,
    policySortBy,
    policySortOrder,
    policySupport,
    selectedPolicy: selectedPolicyId,
  } = props.search;
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

  const updatePolicySearch = useCallback(
    (
      updates: Partial<{
        policySearch: string;
        policySortBy: (typeof POLICY_TABLE_SORT_FIELDS)[number];
        policySortOrder: 'asc' | 'desc';
        policySupport: 'all' | SecurityPolicySummary['support'];
        selectedPolicy: string | undefined;
      }>,
    ) => {
      void navigate({
        search: {
          ...props.search,
          ...updates,
        },
        to: getSecurityPath('policies'),
      });
    },
    [navigate, props.search],
  );

  return (
    <>
      <AdminSecurityPoliciesTab
        busySync={isSyncingPolicies}
        onOpenPolicy={(policyId) => {
          updatePolicySearch({ selectedPolicy: policyId });
        }}
        onSyncPolicies={handleSyncPolicies}
        policies={policySummaries}
        searchTerm={policySearch}
        sortBy={policySortBy}
        sortOrder={policySortOrder}
        supportFilter={policySupport}
        updatePolicySearch={updatePolicySearch}
      />

      <Sheet
        open={selectedPolicyId !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updatePolicySearch({ selectedPolicy: undefined });
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
            <DetailLoadingState label="Loading policy detail" />
          ) : selectedPolicy ? (
            <AdminSecurityPolicyDetail onOpenControl={navigateToControl} policy={selectedPolicy} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminSecurityFindingsRoute(props: { search: SecurityFindingsSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl, navigateToReviews } = useSecurityNavigation();
  const findingsBoard = useQuery(api.securityPosture.getSecurityFindingsBoard, {}) as
    | SecurityFindingsBoard
    | undefined;
  const reviewSecurityFinding = useMutation(api.securityWorkspace.reviewSecurityFinding);
  const openSecurityFindingFollowUp = useMutation(
    api.securityWorkspace.openSecurityFindingFollowUp,
  );
  const [findingNotes, setFindingNotes] = useState<Record<string, string>>({});
  const [findingCustomerSummaries, setFindingCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [findingDispositions, setFindingDispositions] = useState<
    Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
  >({});
  const [busyFindingKey, setBusyFindingKey] = useState<string | null>(null);
  const findings = findingsBoard?.findings;
  const selectedFinding = useMemo(
    () => findings?.find((entry) => entry.findingKey === props.search.selectedFinding) ?? null,
    [findings, props.search.selectedFinding],
  );

  const updateFindingSearch = useCallback(
    (selectedFinding: string | undefined) => {
      void navigate({
        search: {
          selectedFinding,
        },
        to: getSecurityPath('findings'),
      });
    },
    [navigate],
  );

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
        const reviewRun = await openSecurityFindingFollowUp({
          findingKey: finding.findingKey,
          note: findingNotes[finding.findingKey]?.trim() || undefined,
        });
        showToast('Finding follow-up review created.', 'success');
        navigateToReviews(reviewRun.id);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to open finding follow-up.',
          'error',
        );
      } finally {
        setBusyFindingKey(null);
      }
    },
    [findingNotes, navigateToReviews, openSecurityFindingFollowUp, showToast],
  );

  return (
    <>
      <AdminSecurityFindingsTab
        busyFindingKey={busyFindingKey}
        findingCustomerSummaries={findingCustomerSummaries}
        findingDispositions={findingDispositions}
        findingNotes={findingNotes}
        findings={findings}
        navigateToControl={navigateToControl}
        navigateToReviews={navigateToReviews}
        onOpenFinding={(findingKey) => {
          updateFindingSearch(findingKey);
        }}
        onOpenFindingFollowUp={handleOpenFindingFollowUp}
        onReviewFinding={handleReviewFinding}
        setFindingCustomerSummaries={setFindingCustomerSummaries}
        setFindingDispositions={setFindingDispositions}
        setFindingNotes={setFindingNotes}
        summary={
          findingsBoard?.summary ?? {
            openCount: undefined,
            reviewPendingCount: undefined,
            totalCount: undefined,
          }
        }
      />
      <Sheet
        open={props.search.selectedFinding !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateFindingSearch(undefined);
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Finding detail</SheetTitle>
            <SheetDescription>
              Review the selected finding, its linked controls, and the review workflow hand-off.
            </SheetDescription>
          </SheetHeader>
          {selectedFinding === null && props.search.selectedFinding ? (
            <DetailLoadingState label="Loading finding detail" />
          ) : selectedFinding ? (
            <AdminSecurityFindingDetail
              finding={selectedFinding}
              onOpenControl={navigateToControl}
              onOpenReviews={() => {
                navigateToReviews();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminSecurityReportsRoute(props: { search: SecurityReportsSearch }) {
  const navigate = useNavigate();
  const { navigateToControl, navigateToReviews } = useSecurityNavigation();
  const reportsBoard = useQuery(api.securityPosture.getSecurityReportsBoard, {}) as
    | SecurityReportsBoard
    | undefined;
  const generateEvidenceReport = useAction(api.securityReports.generateEvidenceReport);
  const exportEvidenceReport = useAction(api.securityReports.exportEvidenceReport);
  const reviewEvidenceReport = useMutation(api.securityReports.reviewEvidenceReport);
  const [report, setReport] = useState<string | null>(null);
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [reportCustomerSummaries, setReportCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);
  const selectedReportDetail = useQuery(
    api.securityReports.getEvidenceReportDetail,
    props.search.selectedReport
      ? { id: props.search.selectedReport as Id<'evidenceReports'> }
      : 'skip',
  ) as EvidenceReportDetail | null | undefined;
  const selectedReport = useMemo(() => {
    if (selectedReportDetail) {
      return selectedReportDetail;
    }
    return (
      reportsBoard?.evidenceReports.find((entry) => entry.id === props.search.selectedReport) ??
      null
    );
  }, [props.search.selectedReport, reportsBoard?.evidenceReports, selectedReportDetail]);
  const auditReadiness = reportsBoard?.auditReadiness;
  const auditReadinessSummary = useMemo(() => {
    if (auditReadiness === undefined) {
      return {
        latestDrill: null,
        latestManifestHash: null,
        metadataGapCount: undefined,
        recentDeniedCount: undefined,
        recentExportCount: undefined,
        staleDrill: undefined,
      };
    }

    const latestDrill = auditReadiness?.latestBackupDrill ?? null;
    const staleDrill =
      latestDrill === null || Date.now() - latestDrill.checkedAt > 30 * 24 * 60 * 60 * 1000;

    return {
      latestDrill,
      latestManifestHash: auditReadiness?.recentExports[0]?.manifestHash ?? null,
      metadataGapCount: auditReadiness.metadataGaps.length,
      recentDeniedCount: auditReadiness.recentDeniedActions.length,
      recentExportCount: auditReadiness.recentExports.length,
      staleDrill,
    };
  }, [auditReadiness]);
  const restoreDrillFooter =
    auditReadinessSummary.staleDrill === undefined
      ? undefined
      : auditReadinessSummary.staleDrill
        ? 'Drill evidence is stale'
        : auditReadinessSummary.latestDrill
          ? `Checked ${new Date(auditReadinessSummary.latestDrill.checkedAt).toLocaleString()}`
          : 'No drill evidence recorded';

  const updateReportSearch = useCallback(
    (selectedReport: string | undefined) => {
      void navigate({
        search: {
          selectedReport,
        },
        to: getSecurityPath('reports'),
      });
    },
    [navigate],
  );

  const handleGenerateReport = useCallback(
    async (reportKind: 'audit_readiness' | 'security_posture' = 'security_posture') => {
      setIsGenerating(true);
      try {
        const generated = await generateEvidenceReport({ reportKind });
        setReport(generated.report);
        updateReportSearch(generated.id);
      } finally {
        setIsGenerating(false);
      }
    },
    [generateEvidenceReport, updateReportSearch],
  );

  const handleReviewReport = useCallback(
    async (id: Id<'evidenceReports'>, reviewStatus: 'needs_follow_up' | 'reviewed') => {
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
    },
    [reportCustomerSummaries, reportNotes, reviewEvidenceReport],
  );

  const handleExportReport = useCallback(
    async (id: Id<'evidenceReports'>) => {
      setBusyReportAction(`${id}:export`);
      try {
        const exported = await exportEvidenceReport({ id });
        setReport(exported.report);
        updateReportSearch(id);
      } finally {
        setBusyReportAction(null);
      }
    },
    [exportEvidenceReport, updateReportSearch],
  );

  return (
    <>
      <AdminSecurityReportsTab
        auditReadiness={auditReadiness}
        auditReadinessSummary={auditReadinessSummary}
        busyReportAction={busyReportAction}
        evidenceReports={reportsBoard?.evidenceReports}
        handleExportReport={handleExportReport}
        handleGenerateReport={handleGenerateReport}
        handleOpenReportDetail={(reportId) => {
          updateReportSearch(reportId);
        }}
        handleReviewReport={handleReviewReport}
        isGenerating={isGenerating}
        report={report}
        reportCustomerSummaries={reportCustomerSummaries}
        reportNotes={reportNotes}
        restoreDrillFooter={restoreDrillFooter}
        setReportCustomerSummaries={setReportCustomerSummaries}
        setReportNotes={setReportNotes}
      />

      <Sheet
        open={props.search.selectedReport !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateReportSearch(undefined);
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Evidence report detail</SheetTitle>
            <SheetDescription>
              Review the selected evidence report and linked review task context.
            </SheetDescription>
          </SheetHeader>
          {selectedReport === null && props.search.selectedReport ? (
            <DetailLoadingState label="Loading report detail" />
          ) : selectedReport ? (
            <AdminSecurityReportDetail
              generatedReport={report}
              onOpenControl={navigateToControl}
              onOpenReviewRun={(reviewRunId) => {
                navigateToReviews(reviewRunId);
              }}
              report={selectedReport}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminSecurityVendorsRoute(props: { search: SecurityVendorsSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl, navigateToReviews } = useSecurityNavigation();
  const vendorWorkspaces = useQuery(api.securityReports.listVendorReviewWorkspaces, {}) as
    | VendorWorkspace[]
    | undefined;
  const reviewVendorWorkspace = useMutation(api.securityReports.reviewVendorWorkspace);
  const [vendorSummaries, setVendorSummaries] = useState<Record<string, string>>({});
  const [vendorOwners, setVendorOwners] = useState<Record<string, string>>({});
  const [busyVendorKey, setBusyVendorKey] = useState<string | null>(null);
  const selectedVendor = useMemo(
    () => vendorWorkspaces?.find((vendor) => vendor.vendor === props.search.selectedVendor) ?? null,
    [props.search.selectedVendor, vendorWorkspaces],
  );
  const vendorSummary = useMemo(() => {
    if (vendorWorkspaces === undefined) {
      return {
        currentCount: undefined,
        dueSoonCount: undefined,
        overdueCount: undefined,
        totalCount: undefined,
      };
    }

    const vendors = vendorWorkspaces;
    return {
      currentCount: vendors.filter((vendor) => vendor.reviewStatus === 'current').length,
      dueSoonCount: vendors.filter((vendor) => vendor.reviewStatus === 'due_soon').length,
      overdueCount: vendors.filter((vendor) => vendor.reviewStatus === 'overdue').length,
      totalCount: vendors.length,
    };
  }, [vendorWorkspaces]);

  const updateVendorSearch = useCallback(
    (selectedVendor: string | undefined) => {
      void navigate({
        search: {
          selectedVendor,
        },
        to: getSecurityPath('vendors'),
      });
    },
    [navigate],
  );

  const handleReviewVendor = useCallback(
    async (vendor: VendorWorkspace) => {
      setBusyVendorKey(vendor.vendor);
      try {
        await reviewVendorWorkspace({
          owner: vendorOwners[vendor.vendor]?.trim() || undefined,
          summary: vendorSummaries[vendor.vendor]?.trim() || undefined,
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
    [reviewVendorWorkspace, showToast, vendorOwners, vendorSummaries],
  );

  return (
    <>
      <AdminSecurityTabHeader
        title="Vendors"
        description="Runtime vendor posture, governance review cadence, follow-up context, and linked controls."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <AdminSecuritySummaryCard
          title="Tracked vendors"
          description="First-class vendor governance records linked to controls."
          value={renderCardStatValue(vendorSummary.totalCount)}
        />
        <AdminSecuritySummaryCard
          title="Current reviews"
          description="Vendors reviewed within the current 12-month cadence."
          value={renderCardStatValue(vendorSummary.currentCount)}
        />
        <AdminSecuritySummaryCard
          title="Due soon"
          description="Reviews approaching expiry but still current."
          value={renderCardStatValue(vendorSummary.dueSoonCount)}
        />
        <AdminSecuritySummaryCard
          title="Overdue"
          description="These block annual review finalization until renewed."
          value={renderCardStatValue(vendorSummary.overdueCount)}
        />
      </div>

      <AdminSecurityVendorsTab
        busyVendorKey={busyVendorKey}
        handleReviewVendor={handleReviewVendor}
        navigateToControl={navigateToControl}
        navigateToReviews={navigateToReviews}
        onOpenVendor={(vendorKey) => {
          updateVendorSearch(vendorKey);
        }}
        setVendorSummaries={setVendorSummaries}
        setVendorOwners={setVendorOwners}
        vendorSummaries={vendorSummaries}
        vendorOwners={vendorOwners}
        vendorWorkspaces={vendorWorkspaces}
      />

      <Sheet
        open={props.search.selectedVendor !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updateVendorSearch(undefined);
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Vendor detail</SheetTitle>
            <SheetDescription>
              Review vendor posture, linked controls, review cadence, and follow-up linkage.
            </SheetDescription>
          </SheetHeader>
          {selectedVendor === null && props.search.selectedVendor ? (
            <DetailLoadingState label="Loading vendor detail" />
          ) : selectedVendor ? (
            (() => {
              const currentOwner =
                vendorOwners[selectedVendor.vendor] ?? selectedVendor.owner ?? '';
              const currentSummary =
                vendorSummaries[selectedVendor.vendor] ?? selectedVendor.summary ?? '';
              const isDirty =
                currentOwner !== (selectedVendor.owner ?? '') ||
                currentSummary !== (selectedVendor.summary ?? '');
              const primaryStatus = getVendorPrimaryStatus(selectedVendor);
              const governanceState = getVendorGovernanceState({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isDirty,
                owner: currentOwner,
                reviewStatus: selectedVendor.reviewStatus,
              });
              const runtimePosture = formatVendorRuntimePosture(selectedVendor);
              const decisionSummary = formatVendorDecisionSummary({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isDirty,
                lastReviewedAt: selectedVendor.lastReviewedAt,
                owner: currentOwner,
                reviewStatus: selectedVendor.reviewStatus,
                vendor: selectedVendor,
              });
              const primaryActionLabel = getVendorPrimaryActionLabel({
                controlCount: selectedVendor.relatedControls.length,
                hasDraftReview: isDirty,
                owner: currentOwner,
              });

              return (
                <div className="space-y-6 p-1">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold">{selectedVendor.title}</h2>
                      <Badge variant={primaryStatus.variant}>{primaryStatus.label}</Badge>
                      <Badge variant={governanceState.variant}>{governanceState.label}</Badge>
                    </div>
                    <p className="text-sm text-foreground">{decisionSummary}</p>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Runtime posture</p>
                        <p className="mt-2">{runtimePosture.decision}</p>
                        <p className="text-sm text-muted-foreground">
                          Environments: {runtimePosture.environments}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Data classes: {runtimePosture.dataClasses}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-lg border bg-background p-4">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">
                          Governance posture
                        </p>
                        <p className="mt-2">{currentOwner || 'Owner not assigned'}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.relatedControls.length > 0
                            ? `${selectedVendor.relatedControls.length} linked control${selectedVendor.relatedControls.length === 1 ? '' : 's'}`
                            : 'No linked controls'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.lastReviewedAt
                            ? `Last reviewed ${new Date(selectedVendor.lastReviewedAt).toLocaleString()}`
                            : 'No completed review recorded'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVendor.nextReviewAt
                            ? `Next review ${new Date(selectedVendor.nextReviewAt).toLocaleDateString()}`
                            : 'Next review not scheduled'}
                        </p>
                        <p className="text-sm text-muted-foreground">{governanceState.label}</p>
                      </div>
                      {selectedVendor.linkedAnnualReviewTask ? (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Annual review task
                          </p>
                          <p>{selectedVendor.linkedAnnualReviewTask.title}</p>
                        </div>
                      ) : null}
                      {selectedVendor.linkedEntities.length ? (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            Linked context
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                            {selectedVendor.linkedEntities.map((entity) => (
                              <li key={`${entity.entityType}:${entity.entityId}`}>
                                {entity.label}
                                {entity.status ? ` · ${entity.status}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Vendor summary</p>
                    <p className="rounded-lg border bg-background p-3 text-sm">
                      {currentSummary || 'No vendor summary recorded yet.'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Linked controls</p>
                    {selectedVendor.relatedControls.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedVendor.relatedControls.map((control) => (
                          <Button
                            key={`${selectedVendor.vendor}:${control.internalControlId}:${control.itemId ?? 'none'}`}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigateToControl(control.internalControlId);
                            }}
                          >
                            {control.nist80053Id} · {control.title}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                        No linked controls.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busyVendorKey !== null}
                      onClick={() => {
                        void handleReviewVendor(selectedVendor);
                      }}
                    >
                      {busyVendorKey === selectedVendor.vendor ? 'Saving…' : primaryActionLabel}
                    </Button>
                    {selectedVendor.linkedFollowUpRunId ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          navigateToReviews(selectedVendor.linkedFollowUpRunId ?? undefined);
                        }}
                      >
                        Open follow-up in reviews
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        navigateToReviews();
                      }}
                    >
                      Open reviews
                    </Button>
                  </div>
                </div>
              );
            })()
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function renderCardStatValue(value: number | undefined) {
  if (value === undefined) {
    return (
      <>
        <Spinner className="size-5" />
        <span className="sr-only">Loading</span>
      </>
    );
  }

  return value;
}

export function AdminSecurityReviewsRoute(props: { search: SecurityReviewsSearch }) {
  const navigate = useNavigate();
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
    <>
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

      <Sheet
        open={props.search.selectedReviewRun !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          void navigate({
            search: {
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

function DetailLoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center p-4 text-sm text-muted-foreground">
      <Spinner className="size-5" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
