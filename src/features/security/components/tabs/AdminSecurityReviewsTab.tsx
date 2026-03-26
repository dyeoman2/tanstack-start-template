import type { Id } from '@convex/_generated/dataModel';
import { type Dispatch, type SetStateAction } from 'react';
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
import { AdminSecurityBatchReview } from '~/features/security/components/AdminSecurityBatchReview';
import { AdminSecurityReviewTaskGroup } from '~/features/security/components/AdminSecurityReviewTaskGroup';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import {
  formatReviewRunStatus,
  formatReviewTaskEvidenceSourceType,
  formatReviewTaskStatus,
  getReviewRunStatusBadgeVariant,
} from '~/features/security/formatters';
import type {
  AuditReadinessOverview,
  EvidenceReportListItem,
  ReviewRunSummary,
  ReviewTaskDetail,
} from '~/features/security/types';

export type ReviewFinalizeState = {
  canFinalize: boolean;
  requiredBlocked: ReviewTaskDetail[];
  requiredRemaining: ReviewTaskDetail[];
  remainingByType: {
    attestation: number;
    automated_check: number;
    document_upload: number;
    follow_up: number;
  };
};

export type ReviewTaskGroups = {
  autoCollected: ReviewTaskDetail[];
  needsAttestation: ReviewTaskDetail[];
  needsDocumentUpload: ReviewTaskDetail[];
  findingsReview: ReviewTaskDetail[];
  vendorReviews: ReviewTaskDetail[];
  blocked: ReviewTaskDetail[];
};

export type AutoCollectedEvidenceLink = {
  link: {
    freshAt: number | null;
    id: string;
    linkedAt: number;
    sourceLabel: string;
    sourceType:
      | 'security_control_evidence'
      | 'evidence_report'
      | 'security_finding'
      | 'backup_verification_report'
      | 'external_document'
      | 'review_task'
      | 'vendor';
  };
  taskTitle: string;
};

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

export function AdminSecurityReviewsTab(props: {
  autoCollectedEvidenceLinks: AutoCollectedEvidenceLink[];
  busyReviewRunAction: string | null;
  busyReviewTaskAction: string | null;
  currentAnnualReviewRun: ReviewRunSummary | null;
  isPreparingAnnualReview: boolean;
  newTriggeredReviewTitle: string;
  newTriggeredReviewType: string;
  reviewExceptionTasks: ReviewTaskDetail[];
  reviewFinalizeState: ReviewFinalizeState;
  reviewTaskDocuments: Record<string, { label: string; url: string; version: string }>;
  reviewTaskGroups: ReviewTaskGroups;
  reviewTaskNotes: Record<string, string>;
  triggeredReviewRuns: ReviewRunSummary[] | undefined;
  batchReviewTasks: ReviewTaskDetail[];
  isBatchReviewOpen: boolean;
  onBatchReviewOpenChange: (open: boolean) => void;
  onOpenBatchReview: (tasks: ReviewTaskDetail[]) => void;
  handleAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  handleCreateTriggeredReviewRun: () => Promise<void>;
  handleExceptionTask: (task: ReviewTaskDetail) => Promise<void>;
  handleFinalizeAnnualReview: () => Promise<void>;
  handleOpenReviewFollowUp: (task: ReviewTaskDetail) => Promise<void>;
  handleRefreshAnnualReview: () => Promise<void>;
  navigateToControl: (internalControlId: string) => void;
  onChangeDocumentField: (
    taskId: string,
    field: 'label' | 'url' | 'version',
    value: string,
  ) => void;
  onChangeNote: (taskId: string, value: string) => void;
  setNewTriggeredReviewTitle: Dispatch<SetStateAction<string>>;
  setNewTriggeredReviewType: Dispatch<SetStateAction<string>>;
  // Report props
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
  setReportCustomerSummaries: Dispatch<SetStateAction<Record<string, string>>>;
  setReportNotes: Dispatch<SetStateAction<Record<string, string>>>;
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

  return (
    <>
      <AdminSecurityTabHeader
        title="Reviews"
        description="Annual revalidation status, triggered follow-up runs, evidence reports, and evidence collection for the security program."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!props.currentAnnualReviewRun?.id || props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleRefreshAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'refresh' ? 'Refreshing...' : 'Refresh automation'}
            </Button>
            <Button
              type="button"
              disabled={
                !props.currentAnnualReviewRun?.id ||
                props.busyReviewRunAction !== null ||
                !props.reviewFinalizeState.canFinalize
              }
              onClick={() => {
                void props.handleFinalizeAnnualReview();
              }}
            >
              {props.busyReviewRunAction === 'finalize'
                ? 'Finalizing...'
                : 'Finalize annual review'}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Current Annual Review</CardTitle>
          <CardDescription>
            Revalidate the current evidence base, complete the required attestations and document
            links, and finalize the annual review record for this cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.currentAnnualReviewRun ? (
            <>
              <div className="grid gap-4 md:grid-cols-4">
                <AdminSecuritySummaryCard
                  title="Status"
                  description="Current annual revalidation rollup."
                  value={formatReviewRunStatus(props.currentAnnualReviewRun.status)}
                />
                <AdminSecuritySummaryCard
                  title="Completed Tasks"
                  description="Tasks already completed or exceptioned."
                  value={`${props.currentAnnualReviewRun.taskCounts.completed + props.currentAnnualReviewRun.taskCounts.exception}/${props.currentAnnualReviewRun.taskCounts.total}`}
                />
                <AdminSecuritySummaryCard
                  title="Blocked"
                  description="Tasks that still need follow-up."
                  value={`${props.currentAnnualReviewRun.taskCounts.blocked}`}
                />
                <AdminSecuritySummaryCard
                  title="Ready"
                  description="Tasks currently ready for action."
                  value={`${props.currentAnnualReviewRun.taskCounts.ready}`}
                />
              </div>

              {(() => {
                const done =
                  props.currentAnnualReviewRun.taskCounts.completed +
                  props.currentAnnualReviewRun.taskCounts.exception;
                const total = props.currentAnnualReviewRun.taskCounts.total;
                const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <div className="space-y-1">
                    <div className="h-2 w-full rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {done} of {total} tasks complete ({percent}%)
                    </p>
                  </div>
                );
              })()}

              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{props.currentAnnualReviewRun.title}</p>
                    <p className="text-sm text-muted-foreground">
                      Created {new Date(props.currentAnnualReviewRun.createdAt).toLocaleString()}
                      {props.currentAnnualReviewRun.finalizedAt
                        ? ` · Finalized ${new Date(props.currentAnnualReviewRun.finalizedAt).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                  <Badge
                    variant={getReviewRunStatusBadgeVariant(props.currentAnnualReviewRun.status)}
                  >
                    {formatReviewRunStatus(props.currentAnnualReviewRun.status)}
                  </Badge>
                </div>
              </div>

              {props.reviewFinalizeState.canFinalize ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  All required revalidation tasks are complete. The annual review can be finalized
                  now.
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-medium">Finalize is still blocked.</p>
                  <p className="mt-1 text-amber-900">
                    {props.reviewFinalizeState.requiredRemaining.length > 0
                      ? `Remaining required work: ${props.reviewFinalizeState.remainingByType.attestation} attestation${props.reviewFinalizeState.remainingByType.attestation === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.document_upload} document link${props.reviewFinalizeState.remainingByType.document_upload === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.automated_check} automated check${props.reviewFinalizeState.remainingByType.automated_check === 1 ? '' : 's'}, ${props.reviewFinalizeState.remainingByType.follow_up} follow-up${props.reviewFinalizeState.remainingByType.follow_up === 1 ? '' : 's'}.`
                      : 'No remaining manual tasks are open.'}
                  </p>
                  {props.reviewFinalizeState.requiredBlocked.length > 0 ? (
                    <p className="mt-1 text-amber-900">
                      Blocked tasks:{' '}
                      {props.reviewFinalizeState.requiredBlocked
                        .map((task) => task.title)
                        .join(', ')}
                      .
                    </p>
                  ) : null}
                </div>
              )}

              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks the system generated or linked automatically for the current run."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.autoCollected}
                title="Auto-collected"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that require a human attestation to renew support for the current cycle."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onBatchReview={() => {
                  props.onOpenBatchReview(props.reviewTaskGroups.needsAttestation);
                }}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.needsAttestation}
                title="Needs attestation"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Vendor governance reviews that renew the vendor assessment cadence without affecting support rollups."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onBatchReview={() => {
                  props.onOpenBatchReview(props.reviewTaskGroups.vendorReviews);
                }}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.vendorReviews}
                title="Vendor reviews"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Grouped findings review for annual governance posture. Critical open findings must be resolved or dispositioned before attestation."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.findingsReview}
                title="Findings review"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that require a linked document so the annual review can materialize fresh support evidence."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.needsDocumentUpload}
                title="Needs document upload"
              />
              <AdminSecurityReviewTaskGroup
                busyAction={props.busyReviewTaskAction}
                description="Tasks that remain blocked or have documented exceptions needing follow-up."
                documents={props.reviewTaskDocuments}
                notes={props.reviewTaskNotes}
                onAttestTask={props.handleAttestTask}
                onChangeDocumentField={props.onChangeDocumentField}
                onChangeNote={props.onChangeNote}
                onExceptionTask={props.handleExceptionTask}
                onOpenControl={props.navigateToControl}
                onOpenFollowUp={props.handleOpenReviewFollowUp}
                tasks={props.reviewTaskGroups.blocked}
                title="Blocked by open issue"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {props.isPreparingAnnualReview
                ? 'Preparing the current annual review...'
                : 'Annual review is not ready yet. Refresh automation to try again.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-Collected Evidence</CardTitle>
          <CardDescription>
            The latest artifact currently linked to each automated annual-review task.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.autoCollectedEvidenceLinks.length ? (
            props.autoCollectedEvidenceLinks.map(({ link, taskTitle }) => (
              <div key={link.id} className="rounded-lg border p-4">
                <p className="font-medium">{link.sourceLabel}</p>
                {link.sourceLabel !== taskTitle ? (
                  <p className="text-sm text-muted-foreground">{taskTitle}</p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {formatReviewTaskEvidenceSourceType(link.sourceType)} · Linked{' '}
                  {new Date(link.linkedAt).toLocaleString()}
                  {link.freshAt ? ` · Fresh ${new Date(link.freshAt).toLocaleString()}` : ''}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No auto-collected evidence is linked yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Triggered Reviews</CardTitle>
          <CardDescription>
            Manual and repo-native follow-up runs that should not wait for the annual cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr,200px,auto]">
            <Input
              value={props.newTriggeredReviewTitle}
              onChange={(event) => {
                props.setNewTriggeredReviewTitle(event.target.value);
              }}
              placeholder="Triggered review title"
            />
            <Select
              value={props.newTriggeredReviewType}
              onValueChange={props.setNewTriggeredReviewType}
            >
              <SelectTrigger aria-label="Triggered review type">
                <SelectValue placeholder="Trigger type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual_follow_up">Manual follow-up</SelectItem>
                <SelectItem value="remediation_follow_up">Remediation</SelectItem>
                <SelectItem value="termination_follow_up">Termination</SelectItem>
                <SelectItem value="certificate_operations">Certificate operations</SelectItem>
                <SelectItem value="unsupported_component">Unsupported component</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={props.busyReviewRunAction !== null}
              onClick={() => {
                void props.handleCreateTriggeredReviewRun();
              }}
            >
              {props.busyReviewRunAction === 'create-triggered' ? 'Creating...' : 'Create run'}
            </Button>
          </div>

          {props.triggeredReviewRuns?.length ? (
            props.triggeredReviewRuns.map((run) => (
              <div key={run.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{run.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {run.triggerType ?? 'manual follow-up'} · Created{' '}
                      {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={getReviewRunStatusBadgeVariant(run.status)}>
                    {formatReviewRunStatus(run.status)}
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No triggered reviews have been created yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exceptions / Open Follow-Up</CardTitle>
          <CardDescription>
            Tasks that currently require an exception note or a triggered follow-up run.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {props.reviewExceptionTasks.length ? (
            props.reviewExceptionTasks.map((task) => (
              <div key={task.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-sm text-muted-foreground">{task.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatReviewTaskStatus(task.status)}
                      {task.latestNote ? ` · ${task.latestNote}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.busyReviewTaskAction !== null}
                      onClick={() => {
                        void props.handleExceptionTask(task);
                      }}
                    >
                      {props.busyReviewTaskAction === `${task.id}:exception`
                        ? 'Saving...'
                        : 'Mark exception'}
                    </Button>
                    <Button
                      type="button"
                      disabled={props.busyReviewTaskAction !== null}
                      onClick={() => {
                        void props.handleOpenReviewFollowUp(task);
                      }}
                    >
                      {props.busyReviewTaskAction === `${task.id}:follow-up`
                        ? 'Opening...'
                        : 'Open triggered follow-up'}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No exceptions or open follow-up items are currently tracked.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Evidence Reports section (absorbed from Reports tab) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Evidence Reports</CardTitle>
              <CardDescription>
                Generate, review, and export manifest-backed evidence snapshots.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void props.handleGenerateReport('security_posture');
                }}
                disabled={props.isGenerating}
                size="sm"
              >
                {props.isGenerating ? 'Generating...' : 'Generate evidence report'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void props.handleGenerateReport('audit_readiness');
                }}
                disabled={props.isGenerating}
              >
                {props.isGenerating ? 'Generating...' : 'Generate audit readiness report'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminSecuritySummaryCard
              title="Recent Exports"
              description="Manifest-backed audit, directory, and evidence exports recorded recently."
              value={renderCardStatValue(props.auditReadinessSummary.recentExportCount)}
              footer={
                props.auditReadinessSummary.latestManifestHash
                  ? `Latest manifest: ${props.auditReadinessSummary.latestManifestHash.slice(0, 16)}...`
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

          {props.report ? (
            <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
              {props.report}
            </pre>
          ) : null}

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
                            ? 'Saving...'
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
                                  ? 'Saving...'
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
                                  ? 'Saving...'
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
                                  ? 'Exporting...'
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

      {/* Audit Readiness Signals */}
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

      <AdminSecurityBatchReview
        busyAction={props.busyReviewTaskAction}
        onAttestTask={props.handleAttestTask}
        onOpenChange={props.onBatchReviewOpenChange}
        open={props.isBatchReviewOpen}
        tasks={props.batchReviewTasks}
      />
    </>
  );
}
