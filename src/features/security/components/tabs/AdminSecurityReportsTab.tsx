import type { Id } from '@convex/_generated/dataModel';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Spinner } from '~/components/ui/spinner';
import { Textarea } from '~/components/ui/textarea';
import { formatTableDate } from '~/components/data-table';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import type { AuditReadinessOverview, EvidenceReportListItem } from '~/features/security/types';

function formatEvidenceQueueReviewStatus(status: EvidenceReportListItem['reviewStatus']) {
  switch (status) {
    case 'needs_follow_up':
      return 'Needs follow-up';
    case 'pending':
      return 'Pending review';
    case 'reviewed':
      return 'Reviewed';
  }
}

function getEvidenceQueueReviewBadgeVariant(
  status: EvidenceReportListItem['reviewStatus'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'reviewed':
      return 'default';
    case 'needs_follow_up':
      return 'destructive';
    case 'pending':
      return 'outline';
  }
}

function truncateHash(value: string, visibleChars = 8) {
  if (value.length <= visibleChars * 2 + 3) {
    return value;
  }

  return `${value.slice(0, visibleChars)}...${value.slice(-visibleChars)}`;
}

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
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,0.8fr))]">
            <Input
              value={props.reportSearch}
              onChange={(event) => {
                props.onChangeReportSearch(event.target.value);
              }}
              placeholder="Search reports by kind, notes, or customer summary"
              aria-label="Search reports"
              className="bg-background"
            />
            <Select
              value={props.reportReviewStatusFilter}
              onValueChange={(value: 'all' | EvidenceReportListItem['reviewStatus']) => {
                props.onChangeReportReviewStatus(value);
              }}
            >
              <SelectTrigger aria-label="Filter reports by review status" className="bg-background">
                <SelectValue placeholder="All review states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All review states</SelectItem>
                <SelectItem value="pending">Pending review</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="needs_follow_up">Needs follow-up</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={props.reportKindFilter}
              onValueChange={(value: 'all' | EvidenceReportListItem['reportKind']) => {
                props.onChangeReportKind(value);
              }}
            >
              <SelectTrigger aria-label="Filter reports by kind" className="bg-background">
                <SelectValue placeholder="All report kinds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All report kinds</SelectItem>
                <SelectItem value="security_posture">Security posture</SelectItem>
                <SelectItem value="audit_integrity">Audit integrity</SelectItem>
                <SelectItem value="audit_readiness">Audit readiness</SelectItem>
                <SelectItem value="annual_review">Annual review</SelectItem>
                <SelectItem value="findings_snapshot">Findings snapshot</SelectItem>
                <SelectItem value="vendor_posture_snapshot">Vendor posture snapshot</SelectItem>
                <SelectItem value="control_workspace_snapshot">
                  Control workspace snapshot
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 md:grid-cols-3">
            <div className="rounded-lg bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Pending review
              </p>
              <div className="mt-2 flex min-h-8 items-center text-2xl font-semibold">
                {renderCardStatValue(
                  props.evidenceReports?.filter((item) => item.reviewStatus === 'pending').length,
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Reports waiting for first pass</p>
            </div>
            <div className="rounded-lg bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Needs follow-up
              </p>
              <div className="mt-2 flex min-h-8 items-center text-2xl font-semibold">
                {renderCardStatValue(
                  props.evidenceReports?.filter((item) => item.reviewStatus === 'needs_follow_up')
                    .length,
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Reports requiring more evidence</p>
            </div>
            <div className="rounded-lg bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Exported bundles
              </p>
              <div className="mt-2 flex min-h-8 items-center text-2xl font-semibold">
                {renderCardStatValue(
                  props.evidenceReports?.filter((item) => item.latestExport !== null).length,
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Reports already packaged</p>
            </div>
          </div>

          {props.evidenceReports?.length ? (
            <Accordion type="multiple" className="space-y-3">
              {props.evidenceReports.map((item) => {
                const currentNotes = props.reportNotes[item.id] ?? item.internalNotes ?? '';
                const currentCustomerSummary =
                  props.reportCustomerSummaries[item.id] ?? item.customerSummary ?? '';
                const isDirty =
                  currentNotes !== (item.internalNotes ?? '') ||
                  currentCustomerSummary !== (item.customerSummary ?? '');

                return (
                  <AccordionItem
                    key={item.id}
                    value={item.id}
                    className="overflow-hidden rounded-xl border bg-background"
                  >
                    <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                      <AccordionTrigger className="flex-1 py-0 hover:no-underline">
                        <div className="grid w-full gap-4 text-left lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.9fr)] lg:items-start">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-base font-semibold">{item.reportKind}</p>
                              <Badge
                                variant={getEvidenceQueueReviewBadgeVariant(item.reviewStatus)}
                              >
                                {formatEvidenceQueueReviewStatus(item.reviewStatus)}
                              </Badge>
                              {item.latestExport ? (
                                <Badge variant="secondary">Exported</Badge>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <p>Created {new Date(item.createdAt).toLocaleString()}</p>
                              <p>Content hash {truncateHash(item.contentHash)}</p>
                              {item.reviewedAt ? (
                                <p>Reviewed {new Date(item.reviewedAt).toLocaleString()}</p>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-1">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                                Export bundle
                              </p>
                              <p className="mt-1 text-foreground">
                                {item.latestExport
                                  ? truncateHash(item.latestExport.exportHash)
                                  : 'Not exported'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                                Notes
                              </p>
                              <p className="mt-1 text-foreground">
                                {isDirty ? 'Unsaved edits' : 'Saved'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
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
                    <AccordionContent className="border-t bg-muted/10 px-4 pb-4">
                      <div className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                        <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Internal notes
                              </p>
                              <Textarea
                                value={currentNotes}
                                onChange={(event) => {
                                  props.setReportNotes((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }));
                                }}
                                placeholder="Add reviewer-only notes"
                                className="min-h-28 bg-background"
                              />
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Customer summary
                              </p>
                              <Textarea
                                value={currentCustomerSummary}
                                onChange={(event) => {
                                  props.setReportCustomerSummaries((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }));
                                }}
                                placeholder="Summarize the evidence package for customers"
                                className="min-h-28 bg-background"
                              />
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg border bg-background p-3">
                              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Content hash
                              </p>
                              <p className="mt-2 break-all font-mono text-xs">{item.contentHash}</p>
                            </div>
                            <div className="rounded-lg border bg-background p-3">
                              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                Manifest hash
                              </p>
                              <p className="mt-2 break-all font-mono text-xs">
                                {item.latestExport?.manifestHash ?? 'Not recorded yet'}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-4 rounded-lg border bg-background p-4">
                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Review actions
                            </p>
                            <div className="flex flex-col gap-2">
                              <Button
                                type="button"
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
                                disabled={props.busyReportAction !== null}
                                onClick={() => {
                                  void props.handleReviewReport(item.id, 'needs_follow_up');
                                }}
                              >
                                {props.busyReportAction === `${item.id}:needs_follow_up`
                                  ? 'Saving…'
                                  : 'Needs follow-up'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={props.busyReportAction !== null}
                                onClick={() => {
                                  void props.handleExportReport(item.id);
                                }}
                              >
                                {props.busyReportAction === `${item.id}:export`
                                  ? 'Exporting…'
                                  : 'Export bundle'}
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-2 text-sm text-muted-foreground">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                                Export status
                              </p>
                              <p className="mt-1 text-foreground">
                                {item.latestExport ? 'Bundle recorded' : 'Not exported yet'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-[0.14em]">
                                Manifest
                              </p>
                              <p className="mt-1 text-foreground">
                                {item.latestExport ? 'Recorded' : 'Not recorded yet'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
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
