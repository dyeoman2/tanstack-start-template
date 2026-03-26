import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import { createSortableHeader } from '~/components/data-table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import {
  AdminSecurityControlCell,
  AdminSecurityFrameworkSummaryCell,
  AdminSecurityResponsibilityCell,
  AdminSecuritySupportCell,
} from '~/features/security/components/AdminSecurityControlCells';
import { AdminSecurityControlDetail } from '~/features/security/components/AdminSecurityControlDetail';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityControlsTab } from '~/features/security/components/tabs/AdminSecurityControlsTab';
import { CONTROL_TABLE_SORT_FIELDS } from '~/features/security/constants';
import { useSecurityControlTable } from '~/features/security/hooks/useSecurityControlTable';
import type { SecurityControlsSearch } from '~/features/security/search';
import { createSignedServeUrlServerFn } from '~/features/security/server/file-serving';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  SecurityChecklistEvidence,
  SecurityControlWorkspace,
  SecurityControlWorkspaceExport,
  SecurityControlWorkspaceSummary,
  SecurityWorkspaceOverview,
  VendorWorkspace,
} from '~/features/security/types';
import { exportSecurityControlsCsv } from '~/features/security/utils/exportSecurityControlsCsv';
import { uploadFileWithTarget } from '~/features/security/utils/upload';

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
          const resolved = await createSignedServeUrlServerFn({
            data: {
              storageId: evidence.storageId,
            },
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
    [showToast],
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
        case 'vendor':
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
