import type { Id } from '@convex/_generated/dataModel';
import { useMemo } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Spinner } from '~/components/ui/spinner';
import { formatTableDate } from '~/components/data-table';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatEvidenceQueueReviewStatus,
  getEvidenceQueueReviewBadgeVariant,
  truncateHash,
} from '~/features/security/formatters';
import type { AuditReadinessOverview, EvidenceReportListItem } from '~/features/security/types';

const REVIEW_STATUS_OPTIONS: Array<
  TableFilterOption<'all' | EvidenceReportListItem['reviewStatus']>
> = [
  { label: 'All review states', value: 'all' },
  { label: 'Pending review', value: 'pending' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'Needs follow-up', value: 'needs_follow_up' },
];

const REPORT_KIND_OPTIONS: Array<TableFilterOption<'all' | EvidenceReportListItem['reportKind']>> =
  [
    { label: 'All report kinds', value: 'all' },
    { label: 'Security posture', value: 'security_posture' },
    { label: 'Audit integrity', value: 'audit_integrity' },
    { label: 'Audit readiness', value: 'audit_readiness' },
    { label: 'Annual review', value: 'annual_review' },
    { label: 'Findings snapshot', value: 'findings_snapshot' },
    { label: 'Vendor posture', value: 'vendor_posture_snapshot' },
    { label: 'Control workspace', value: 'control_workspace_snapshot' },
  ];

export function AdminSecurityReportsTab(props: {
  auditReadiness: AuditReadinessOverview | undefined;
  auditReadinessSummary: {
    latestDrill: AuditReadinessOverview['latestBackupDrill'];
    latestManifestHash: string | null;
    metadataGapCount: number | undefined;
    recentDeniedCount: number | undefined;
    recentExportCount: number | undefined;
    staleDrill: boolean | undefined;
  };
  busyReportAction: string | null;
  evidenceReports: EvidenceReportListItem[] | undefined;
  isGenerating: boolean;
  onChangeReportKind: (value: 'all' | EvidenceReportListItem['reportKind']) => void;
  onChangeReportReviewStatus: (value: 'all' | EvidenceReportListItem['reviewStatus']) => void;
  onChangeReportSearch: (value: string) => void;
  report: string | null;
  reportCustomerSummaries: Record<string, string>;
  reportKindFilter: 'all' | EvidenceReportListItem['reportKind'];
  reportNotes: Record<string, string>;
  reportReviewStatusFilter: 'all' | EvidenceReportListItem['reviewStatus'];
  reportSearch: string;
  restoreDrillFooter: string | undefined;
  handleExportReport: (id: Id<'evidenceReports'>) => Promise<void>;
  handleGenerateReport: (reportKind?: 'audit_readiness' | 'security_posture') => Promise<void>;
  handleOpenReportDetail: (reportId: Id<'evidenceReports'>) => void;
  handleReviewReport: (
    id: Id<'evidenceReports'>,
    reviewStatus: 'needs_follow_up' | 'reviewed',
  ) => Promise<void>;
  setReportCustomerSummaries: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setReportNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const archiveStatus = props.auditReadiness?.archiveStatus ?? {
    configured: false,
    driftDetected: false,
    exporterEnabled: false,
    failureReason: null,
    lagCount: 0,
    lastVerifiedAt: null,
    lastVerifiedSealEndSequence: null,
    lastVerificationStatus: 'disabled' as const,
    latestExportEndSequence: null,
    latestManifestObjectKey: null,
    latestPayloadObjectKey: null,
    latestSealEndSequence: null,
    required: false,
  };

  const reviewQueueCounts = useMemo(() => {
    if (!props.evidenceReports) {
      return { pending: undefined, needsFollowUp: undefined, exported: undefined };
    }
    return {
      pending: props.evidenceReports.filter((item) => item.reviewStatus === 'pending').length,
      needsFollowUp: props.evidenceReports.filter((item) => item.reviewStatus === 'needs_follow_up')
        .length,
      exported: props.evidenceReports.filter((item) => item.latestExport !== null).length,
    };
  }, [props.evidenceReports]);

  return (
    <>
      <AdminSecurityTabHeader
        title="Reports"
        description="Generate, review, and audit evidence exports plus readiness signals for the security program."
        actions={
          <>
            <Button
              onClick={() => {
                void props.handleGenerateReport('security_posture');
              }}
              disabled={props.isGenerating}
            >
              {props.isGenerating ? 'Generating…' : 'Generate evidence report'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void props.handleGenerateReport('audit_readiness');
              }}
              disabled={props.isGenerating}
            >
              {props.isGenerating ? 'Generating…' : 'Generate audit readiness report'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminSecuritySummaryCard
          title="Recent Exports"
          description="Manifest-backed audit, directory, and evidence exports recorded recently."
          value={renderCardStatValue(props.auditReadinessSummary.recentExportCount)}
          footer={
            props.auditReadinessSummary.latestManifestHash
              ? `Latest manifest: ${props.auditReadinessSummary.latestManifestHash.slice(0, 16)}…`
              : 'No export manifests recorded'
          }
        />
        <AdminSecuritySummaryCard
          title="Denied Actions"
          description="Recent authorization denials captured through the canonical audit path."
          value={renderCardStatValue(props.auditReadinessSummary.recentDeniedCount)}
          footer="Review the latest denial reasons below"
        />
        <AdminSecuritySummaryCard
          title="Metadata Gaps"
          description="Recent privileged events missing required evidence metadata fields."
          value={renderCardStatValue(props.auditReadinessSummary.metadataGapCount)}
          footer={
            props.auditReadinessSummary.metadataGapCount === undefined
              ? undefined
              : props.auditReadinessSummary.metadataGapCount === 0
                ? 'No gaps in the latest scan'
                : 'Investigate before sharing audit artifacts'
          }
        />
        <AdminSecuritySummaryCard
          title="Restore Drill"
          description="Most recent restore or operator-recorded backup verification evidence."
          value={
            props.auditReadiness === undefined
              ? renderCardStatValue(undefined)
              : props.auditReadinessSummary.latestDrill
                ? props.auditReadinessSummary.latestDrill.status
                : 'missing'
          }
          footer={props.restoreDrillFooter}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Reports</CardTitle>
          <CardDescription>
            Generate, review, and export manifest-backed evidence snapshots without mixing them into
            findings or review-run ownership.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.report ? (
            <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
              {props.report}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Readiness Signals</CardTitle>
          <CardDescription>
            Surface manifest history, authorization denials, metadata gaps, and backup drill
            evidence without opening raw JSON.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Latest Backup Drill</h3>
            {props.auditReadiness?.latestBackupDrill ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  {props.auditReadiness.latestBackupDrill.status} ·{' '}
                  {props.auditReadiness.latestBackupDrill.drillType}
                </p>
                <p>{props.auditReadiness.latestBackupDrill.sourceDataset}</p>
                <p>
                  {formatTableDate(props.auditReadiness.latestBackupDrill.checkedAt)} ·{' '}
                  {props.auditReadiness.latestBackupDrill.targetEnvironment}
                </p>
                <p>Verification: {props.auditReadiness.latestBackupDrill.verificationMethod}</p>
                <p>Restored items: {props.auditReadiness.latestBackupDrill.restoredItemCount}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No drill evidence recorded yet.</p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Recent Export Artifacts</h3>
            {props.auditReadiness?.recentExports?.length ? (
              <div className="space-y-2">
                {props.auditReadiness.recentExports.slice(0, 5).map((artifact) => (
                  <div
                    key={`${artifact.artifactType}:${artifact.manifestHash}`}
                    className="rounded-md border p-3 text-sm"
                  >
                    <p className="font-medium">{artifact.artifactType}</p>
                    <p className="text-muted-foreground">
                      {new Date(artifact.exportedAt).toLocaleString()}
                    </p>
                    <p className="text-muted-foreground">Manifest: {artifact.manifestHash}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No export artifacts recorded yet.</p>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Recent Readiness Signals</h3>
            <div className="space-y-2">
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Ledger verification</p>
                {props.auditReadiness?.currentHead ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <p>
                      Head #{props.auditReadiness.currentHead.headSequence} ·{' '}
                      {props.auditReadiness.latestCheckpoint?.status ?? 'unverified'}
                    </p>
                    <p>Unverified tail: {props.auditReadiness.unverifiedTailCount}</p>
                    <p>
                      Latest checkpoint:{' '}
                      {props.auditReadiness.latestCheckpoint
                        ? new Date(props.auditReadiness.latestCheckpoint.checkedAt).toLocaleString()
                        : 'none'}
                    </p>
                    <p>
                      Last seal:{' '}
                      {props.auditReadiness.lastSealAt
                        ? new Date(props.auditReadiness.lastSealAt).toLocaleString()
                        : 'none'}
                    </p>
                    <p>
                      Immutable archive:{' '}
                      {props.auditReadiness.immutableExportHealthy ? 'healthy' : 'lagging'}
                    </p>
                    <p>Immutable archive lag: {props.auditReadiness.immutableExportLagCount}</p>
                    <p>Archive verification: {archiveStatus.lastVerificationStatus}</p>
                    <p>Archive configured: {archiveStatus.configured ? 'yes' : 'no'}</p>
                    <p>Archive drift: {archiveStatus.driftDetected ? 'detected' : 'none'}</p>
                    <p>
                      Last immutable export:{' '}
                      {props.auditReadiness.latestImmutableExport
                        ? new Date(
                            props.auditReadiness.latestImmutableExport.exportedAt,
                          ).toLocaleString()
                        : 'none'}
                    </p>
                    <p>
                      Last archive verification:{' '}
                      {archiveStatus.lastVerifiedAt
                        ? new Date(archiveStatus.lastVerifiedAt).toLocaleString()
                        : 'none'}
                    </p>
                    <p>Last verified seal: {archiveStatus.lastVerifiedSealEndSequence ?? 'none'}</p>
                    {archiveStatus.failureReason ? (
                      <p>Archive issue: {archiveStatus.failureReason}</p>
                    ) : null}
                    {props.auditReadiness.lastIntegrityFailure ? (
                      <p>
                        Last failure: #{props.auditReadiness.lastIntegrityFailure.expectedSequence}{' '}
                        ·{' '}
                        {new Date(
                          props.auditReadiness.lastIntegrityFailure.checkedAt,
                        ).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">No audit ledger head recorded.</p>
                )}
              </div>
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Metadata gaps</p>
                {props.auditReadiness?.metadataGaps?.length ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {props.auditReadiness.metadataGaps.slice(0, 3).map((gap) => (
                      <p key={gap.id}>
                        {gap.eventType} · {new Date(gap.createdAt).toLocaleString()}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">No recent metadata gaps.</p>
                )}
              </div>
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Authorization denials</p>
                {props.auditReadiness?.recentDeniedActions?.length ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {props.auditReadiness.recentDeniedActions.slice(0, 3).map((denial) => (
                      <p key={denial.id}>
                        {new Date(denial.createdAt).toLocaleString()} ·{' '}
                        {denial.organizationId ?? 'global'}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">No recent denials.</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review Queue</CardTitle>
          <CardDescription>
            Review generated evidence, capture notes, and export integrity-linked bundles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <AdminSecuritySummaryCard
              title="Pending review"
              description="Reports waiting for first pass."
              value={renderCardStatValue(reviewQueueCounts.pending)}
              footer={
                reviewQueueCounts.pending !== undefined
                  ? `${reviewQueueCounts.needsFollowUp ?? 0} need follow-up`
                  : undefined
              }
            />
            <AdminSecuritySummaryCard
              title="Needs follow-up"
              description="Reports requiring more evidence."
              value={renderCardStatValue(reviewQueueCounts.needsFollowUp)}
              footer={
                reviewQueueCounts.needsFollowUp !== undefined
                  ? `${reviewQueueCounts.exported ?? 0} already exported`
                  : undefined
              }
            />
            <AdminSecuritySummaryCard
              title="Exported bundles"
              description="Reports already packaged."
              value={renderCardStatValue(reviewQueueCounts.exported)}
              footer={
                reviewQueueCounts.exported !== undefined
                  ? `${props.evidenceReports?.length ?? 0} total reports`
                  : undefined
              }
            />
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="inline-flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
              <p className="text-sm text-muted-foreground whitespace-nowrap">
                {props.evidenceReports?.length ?? 0} matches
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <TableFilter<'all' | EvidenceReportListItem['reviewStatus']>
                  value={props.reportReviewStatusFilter}
                  options={REVIEW_STATUS_OPTIONS}
                  onValueChange={props.onChangeReportReviewStatus}
                  className="shrink-0"
                  ariaLabel="Filter reports by review status"
                />
                <TableFilter<'all' | EvidenceReportListItem['reportKind']>
                  value={props.reportKindFilter}
                  options={REPORT_KIND_OPTIONS}
                  onValueChange={props.onChangeReportKind}
                  className="shrink-0"
                  ariaLabel="Filter reports by kind"
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end xl:justify-end xl:flex-1">
              <TableSearch
                initialValue={props.reportSearch}
                onSearch={props.onChangeReportSearch}
                placeholder="Search reports by kind, notes, or customer summary"
                isSearching={false}
                className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
                ariaLabel="Search reports"
              />
            </div>
          </div>

          {props.evidenceReports?.length ? (
            <div className="space-y-3">
              {props.evidenceReports.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border bg-background p-4 lg:flex-row lg:items-start lg:justify-between"
                >
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      props.handleOpenReportDetail(item.id);
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold">{item.reportKind}</p>
                        <Badge variant={getEvidenceQueueReviewBadgeVariant(item.reviewStatus)}>
                          {formatEvidenceQueueReviewStatus(item.reviewStatus)}
                        </Badge>
                        {item.latestExport ? <Badge variant="secondary">Exported</Badge> : null}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <p>Created {new Date(item.createdAt).toLocaleString()}</p>
                        <p>Content hash {truncateHash(item.contentHash)}</p>
                        {item.reviewedAt ? (
                          <p>Reviewed {new Date(item.reviewedAt).toLocaleString()}</p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={item.reviewStatus === 'reviewed' ? 'outline' : 'default'}
                      disabled={props.busyReportAction !== null}
                      onClick={() => {
                        void props.handleReviewReport(item.id, 'reviewed');
                      }}
                    >
                      {props.busyReportAction === `${item.id}:reviewed`
                        ? 'Saving…'
                        : 'Mark reviewed'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        props.handleOpenReportDetail(item.id);
                      }}
                    >
                      View details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No evidence reports generated yet.</p>
          )}
        </CardContent>
      </Card>
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
