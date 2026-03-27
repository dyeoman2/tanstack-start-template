import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { AdminSecurityFindingDetail } from '~/features/security/components/AdminSecurityFindingDetail';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityFindingsTab } from '~/features/security/components/tabs/AdminSecurityFindingsTab';
import type { SecurityFindingsSearch } from '~/features/security/search';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  EvidenceSufficiency,
} from '~/features/security/types';
import type { SecurityFindingsBoard, SecurityFindingListItem } from '~/features/security/types';
import { uploadFileWithTarget } from '~/features/security/utils/upload';

export function AdminSecurityFindingsRoute(props: { search: SecurityFindingsSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const auth = useAuth();
  const { navigateToControl, navigateToReviews } = useSecurityNavigation();
  const findingsBoard = useQuery(api.securityPosture.getSecurityFindingsBoard, {}) as
    | SecurityFindingsBoard
    | undefined;
  const reviewSecurityFinding = useMutation(api.securityWorkspace.reviewSecurityFinding);
  const createFollowUpAction = useMutation(
    api.securityWorkspace.createSecurityFindingFollowUpAction,
  );
  const updateFollowUpAction = useMutation(
    api.securityWorkspace.updateSecurityFindingFollowUpAction,
  );
  const resolveFollowUpAction = useMutation(
    api.securityWorkspace.resolveSecurityFindingFollowUpAction,
  );
  const openSecurityFindingFollowUp = useMutation(
    api.securityWorkspace.openSecurityFindingFollowUp,
  );
  const addEvidenceLink = useMutation(api.securityWorkspace.addSecurityControlEvidenceLink);
  const addEvidenceNote = useMutation(api.securityWorkspace.addSecurityControlEvidenceNote);
  const createEvidenceUploadTarget = useAction(
    api.securityWorkspace.createSecurityControlEvidenceUploadTarget,
  );
  const finalizeEvidenceUpload = useAction(
    api.securityWorkspace.finalizeSecurityControlEvidenceUpload,
  );
  const [findingNotes, setFindingNotes] = useState<Record<string, string>>({});
  const [findingCustomerSummaries, setFindingCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [findingDispositions, setFindingDispositions] = useState<
    Record<SecurityFindingListItem['findingKey'], SecurityFindingListItem['disposition']>
  >({});
  const [busyFindingKey, setBusyFindingKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const allFindings = findingsBoard?.findings;
  const findings = useMemo(() => {
    const rows = allFindings;
    if (!rows) {
      return rows;
    }

    const searchTerm = props.search.findingSearch.trim().toLowerCase();
    return rows.filter((finding) => {
      if (props.search.findingStatus !== 'all' && finding.status !== props.search.findingStatus) {
        return false;
      }
      if (
        props.search.findingDisposition !== 'all' &&
        finding.disposition !== props.search.findingDisposition
      ) {
        return false;
      }
      if (
        props.search.findingSeverity !== 'all' &&
        finding.severity !== props.search.findingSeverity
      ) {
        return false;
      }
      if (
        props.search.findingType &&
        props.search.findingType !== 'all' &&
        finding.findingType !== props.search.findingType
      ) {
        return false;
      }
      if (props.search.findingFollowUp === 'has_follow_up' && !finding.hasOpenFollowUp) {
        return false;
      }
      if (props.search.findingFollowUp === 'no_follow_up' && finding.hasOpenFollowUp) {
        return false;
      }
      if (props.search.findingFollowUp === 'overdue_follow_up' && !finding.followUpOverdue) {
        return false;
      }
      if (!searchTerm) {
        return true;
      }

      const haystack = [
        finding.title,
        finding.description,
        finding.sourceLabel,
        finding.internalNotes ?? '',
        finding.customerSummary ?? '',
        finding.relatedControls
          .map((control) => `${control.nist80053Id} ${control.title}`)
          .join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    });
  }, [
    allFindings,
    props.search.findingDisposition,
    props.search.findingFollowUp,
    props.search.findingSearch,
    props.search.findingSeverity,
    props.search.findingStatus,
    props.search.findingType,
  ]);
  const selectedFinding = useMemo(
    () => allFindings?.find((entry) => entry.findingKey === props.search.selectedFinding) ?? null,
    [allFindings, props.search.selectedFinding],
  );

  const updateFindingSearch = useCallback(
    (nextSearch: Partial<SecurityFindingsSearch>) => {
      void navigate({
        search: {
          ...props.search,
          ...nextSearch,
        },
        to: getSecurityPath('findings'),
      });
    },
    [navigate, props.search],
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

  const handleCreateFollowUpAction = useCallback(
    async (args: {
      controlLinks: Array<{ internalControlId: string; itemId: string }>;
      dueAt?: number | null;
      findingKey: string;
      summary?: string | null;
    }) => {
      setBusyAction(`follow-up:create:${args.findingKey}`);
      try {
        await createFollowUpAction(args);
        showToast('Tracked follow-up started.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to create tracked follow-up.',
          'error',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [createFollowUpAction, showToast],
  );

  const handleUpdateFollowUpAction = useCallback(
    async (args: {
      assigneeUserId?: string | null;
      dueAt?: number | null;
      followUpActionId: Id<'followUpActions'>;
      latestNote?: string | null;
      status?: 'blocked' | 'in_progress' | 'open';
      summary?: string | null;
    }) => {
      setBusyAction(`follow-up:update:${args.followUpActionId}`);
      try {
        await updateFollowUpAction(args);
        showToast('Tracked follow-up updated.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to update tracked follow-up.',
          'error',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [showToast, updateFollowUpAction],
  );

  const handleResolveFollowUpAction = useCallback(
    async (args: { followUpActionId: Id<'followUpActions'>; resolutionNote?: string | null }) => {
      setBusyAction(`follow-up:resolve:${args.followUpActionId}`);
      try {
        await resolveFollowUpAction(args);
        showToast('Tracked follow-up resolved.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to resolve tracked follow-up.',
          'error',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [resolveFollowUpAction, showToast],
  );

  const handleAddFollowUpEvidenceLink = useCallback(
    async (args: {
      description?: string;
      evidenceDate: number;
      followUpActionId: Id<'followUpActions'>;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: EvidenceSufficiency;
      title: string;
      url: string;
    }) => {
      setBusyAction(`follow-up:evidence-link:${args.followUpActionId}`);
      try {
        await addEvidenceLink(args);
        showToast('Closure evidence link attached.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to attach closure evidence link.',
          'error',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [addEvidenceLink, showToast],
  );

  const handleAddFollowUpEvidenceNote = useCallback(
    async (args: {
      description: string;
      evidenceDate: number;
      followUpActionId: Id<'followUpActions'>;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: 'missing' | 'partial' | 'sufficient';
      title: string;
    }) => {
      setBusyAction(`follow-up:evidence-note:${args.followUpActionId}`);
      try {
        await addEvidenceNote(args);
        showToast('Closure evidence note attached.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to attach closure evidence note.',
          'error',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [addEvidenceNote, showToast],
  );

  const handleUploadFollowUpEvidenceFile = useCallback(
    async (args: {
      description?: string;
      evidenceDate: number;
      file: File;
      followUpActionId: Id<'followUpActions'>;
      internalControlId: string;
      itemId: string;
      reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
      source: EvidenceSource;
      sufficiency: 'missing' | 'partial' | 'sufficient';
      title: string;
    }) => {
      setBusyAction(`follow-up:evidence-file:${args.followUpActionId}`);
      try {
        const target = await createEvidenceUploadTarget({
          contentType: args.file.type || 'application/octet-stream',
          fileName: args.file.name,
          fileSize: args.file.size,
          followUpActionId: args.followUpActionId,
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
          followUpActionId: args.followUpActionId,
          internalControlId: args.internalControlId,
          itemId: args.itemId,
          mimeType: args.file.type || 'application/octet-stream',
          reviewDueIntervalMonths: args.reviewDueIntervalMonths,
          source: args.source,
          storageId: uploadedStorageId ?? target.storageId,
          sufficiency: args.sufficiency,
          title: args.title,
        });
        showToast('Closure evidence file uploaded.', 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to upload closure evidence file.',
          'error',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [createEvidenceUploadTarget, finalizeEvidenceUpload, showToast],
  );

  return (
    <>
      <AdminSecurityFindingsTab
        busyAction={busyAction}
        busyFindingKey={busyFindingKey}
        showAdvancedFilters={props.search.showAdvancedFilters}
        findingDispositionFilter={props.search.findingDisposition}
        findingFollowUpFilter={props.search.findingFollowUp}
        findingSearch={props.search.findingSearch}
        findingSeverityFilter={props.search.findingSeverity}
        findingStatusFilter={props.search.findingStatus}
        findingTypeFilter={props.search.findingType ?? 'all'}
        findingCustomerSummaries={findingCustomerSummaries}
        findingDispositions={findingDispositions}
        findingNotes={findingNotes}
        findings={findings}
        navigateToControl={navigateToControl}
        navigateToReviews={navigateToReviews}
        onChangeShowAdvancedFilters={(showAdvancedFilters) => {
          updateFindingSearch({ showAdvancedFilters });
        }}
        onChangeFindingDispositionFilter={(findingDisposition) => {
          updateFindingSearch({ findingDisposition });
        }}
        onChangeFindingFollowUpFilter={(findingFollowUp) => {
          updateFindingSearch({ findingFollowUp });
        }}
        onChangeFindingSearch={(findingSearch) => {
          updateFindingSearch({ findingSearch });
        }}
        onChangeFindingSeverityFilter={(findingSeverity) => {
          updateFindingSearch({ findingSeverity });
        }}
        onChangeFindingStatusFilter={(findingStatus) => {
          updateFindingSearch({ findingStatus });
        }}
        onChangeFindingTypeFilter={(findingType) => {
          updateFindingSearch({ findingType });
        }}
        onOpenFinding={(findingKey) => {
          updateFindingSearch({ selectedFinding: findingKey });
        }}
        onOpenFindingFollowUp={handleOpenFindingFollowUp}
        onReviewFinding={handleReviewFinding}
        setFindingCustomerSummaries={setFindingCustomerSummaries}
        setFindingDispositions={setFindingDispositions}
        setFindingNotes={setFindingNotes}
        summary={
          findingsBoard?.summary ?? {
            activeFollowUpCount: undefined,
            openCount: undefined,
            overdueFollowUpCount: undefined,
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

          updateFindingSearch({ selectedFinding: undefined });
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
              busyAction={busyAction}
              finding={selectedFinding}
              onAddFollowUpEvidenceLink={handleAddFollowUpEvidenceLink}
              onAddFollowUpEvidenceNote={handleAddFollowUpEvidenceNote}
              onAssignFollowUpToCurrentUser={(followUpActionId) => {
                if (!auth.user?.id) {
                  return;
                }
                void handleUpdateFollowUpAction({
                  assigneeUserId: auth.user.id,
                  followUpActionId,
                });
              }}
              onClearFollowUpAssignee={(followUpActionId) => {
                void handleUpdateFollowUpAction({
                  assigneeUserId: null,
                  followUpActionId,
                });
              }}
              onCreateFollowUpAction={handleCreateFollowUpAction}
              onOpenControl={navigateToControl}
              onOpenReviews={(selectedReviewRun) => {
                navigateToReviews(selectedReviewRun);
              }}
              onResolveFollowUpAction={handleResolveFollowUpAction}
              onUpdateFollowUpAction={handleUpdateFollowUpAction}
              onUploadFollowUpEvidenceFile={handleUploadFollowUpEvidenceFile}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
