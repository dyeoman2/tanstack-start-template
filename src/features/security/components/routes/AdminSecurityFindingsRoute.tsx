import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import { AdminSecurityFindingDetail } from '~/features/security/components/AdminSecurityFindingDetail';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityFindingsTab } from '~/features/security/components/tabs/AdminSecurityFindingsTab';
import type { SecurityFindingsSearch } from '~/features/security/search';
import type { SecurityFindingsBoard, SecurityFindingListItem } from '~/features/security/types';

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

  return (
    <>
      <AdminSecurityFindingsTab
        busyFindingKey={busyFindingKey}
        findingDispositionFilter={props.search.findingDisposition}
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
        onChangeFindingDispositionFilter={(findingDisposition) => {
          updateFindingSearch({ findingDisposition });
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
              finding={selectedFinding}
              onOpenControl={navigateToControl}
              onOpenReviews={(selectedReviewRun) => {
                navigateToReviews(selectedReviewRun);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
