import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { AdminSecurityReportDetail } from '~/features/security/components/AdminSecurityReportDetail';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityReportsTab } from '~/features/security/components/tabs/AdminSecurityReportsTab';
import type { SecurityReportsSearch } from '~/features/security/search';
import {
  exportEvidenceReportServerFn,
  generateEvidenceReportServerFn,
  reviewEvidenceReportServerFn,
} from '~/features/security/server/security-reports';
import type { EvidenceReportDetail, SecurityReportsBoard } from '~/features/security/types';

export function AdminSecurityReportsRoute(props: { search: SecurityReportsSearch }) {
  const navigate = useNavigate();
  const { navigateToControl, navigateToReviews } = useSecurityNavigation();
  const reportsBoard = useQuery(api.securityPosture.getSecurityReportsBoard, {}) as
    | SecurityReportsBoard
    | undefined;
  const [report, setReport] = useState<string | null>(null);
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [reportCustomerSummaries, setReportCustomerSummaries] = useState<Record<string, string>>(
    {},
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);
  const allReports = reportsBoard?.evidenceReports;
  const filteredReports = useMemo(() => {
    const rows = allReports;
    if (!rows) {
      return rows;
    }

    const searchTerm = props.search.reportSearch.trim().toLowerCase();
    return rows.filter((reportItem) => {
      if (
        props.search.reportReviewStatus !== 'all' &&
        reportItem.reviewStatus !== props.search.reportReviewStatus
      ) {
        return false;
      }
      if (props.search.reportKind !== 'all' && reportItem.reportKind !== props.search.reportKind) {
        return false;
      }
      if (!searchTerm) {
        return true;
      }

      const haystack = [
        reportItem.reportKind,
        reportItem.customerSummary ?? '',
        reportItem.internalNotes ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    });
  }, [
    allReports,
    props.search.reportKind,
    props.search.reportReviewStatus,
    props.search.reportSearch,
  ]);
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
    return allReports?.find((entry) => entry.id === props.search.selectedReport) ?? null;
  }, [allReports, props.search.selectedReport, selectedReportDetail]);
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
    (nextSearch: Partial<SecurityReportsSearch>) => {
      void navigate({
        search: {
          ...props.search,
          ...nextSearch,
        },
        to: getSecurityPath('reports'),
      });
    },
    [navigate, props.search],
  );

  const handleGenerateReport = useCallback(
    async (reportKind: 'audit_readiness' | 'security_posture' = 'security_posture') => {
      setIsGenerating(true);
      try {
        const generated = await generateEvidenceReportServerFn({ data: { reportKind } });
        setReport(generated.report);
        updateReportSearch({ selectedReport: generated.id });
      } finally {
        setIsGenerating(false);
      }
    },
    [updateReportSearch],
  );

  const handleReviewReport = useCallback(
    async (id: Id<'evidenceReports'>, reviewStatus: 'needs_follow_up' | 'reviewed') => {
      setBusyReportAction(`${id}:${reviewStatus}`);
      try {
        await reviewEvidenceReportServerFn({
          data: {
            customerSummary: reportCustomerSummaries[id]?.trim() || undefined,
            id,
            internalNotes: reportNotes[id]?.trim() || undefined,
            reviewStatus,
          },
        });
      } finally {
        setBusyReportAction(null);
      }
    },
    [reportCustomerSummaries, reportNotes],
  );

  const handleExportReport = useCallback(
    async (id: Id<'evidenceReports'>) => {
      setBusyReportAction(`${id}:export`);
      try {
        const exported = await exportEvidenceReportServerFn({ data: { id } });
        setReport(exported.report);
        updateReportSearch({ selectedReport: id });
      } finally {
        setBusyReportAction(null);
      }
    },
    [updateReportSearch],
  );

  return (
    <>
      <AdminSecurityReportsTab
        auditReadiness={auditReadiness}
        auditReadinessSummary={auditReadinessSummary}
        busyReportAction={busyReportAction}
        evidenceReports={filteredReports}
        handleExportReport={handleExportReport}
        handleGenerateReport={handleGenerateReport}
        onChangeReportKind={(reportKind) => {
          updateReportSearch({ reportKind });
        }}
        onChangeReportReviewStatus={(reportReviewStatus) => {
          updateReportSearch({ reportReviewStatus });
        }}
        onChangeReportSearch={(reportSearch) => {
          updateReportSearch({ reportSearch });
        }}
        handleOpenReportDetail={(reportId) => {
          updateReportSearch({ selectedReport: reportId });
        }}
        handleReviewReport={handleReviewReport}
        isGenerating={isGenerating}
        report={report}
        reportCustomerSummaries={reportCustomerSummaries}
        reportKindFilter={props.search.reportKind}
        reportNotes={reportNotes}
        reportReviewStatusFilter={props.search.reportReviewStatus}
        reportSearch={props.search.reportSearch}
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

          updateReportSearch({ selectedReport: undefined });
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
