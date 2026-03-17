import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Textarea } from '~/components/ui/textarea';

export const Route = createFileRoute('/app/admin/security')({
  component: AdminSecurityRoute,
});

function AdminSecurityRoute() {
  const summary = useQuery(api.security.getSecurityPostureSummary, {});
  const evidenceReports = useQuery(api.security.listEvidenceReports, { limit: 10 });
  const generateEvidenceReport = useAction(api.security.generateEvidenceReport);
  const exportEvidenceReport = useAction(api.security.exportEvidenceReport);
  const reviewEvidenceReport = useMutation(api.security.reviewEvidenceReport);
  const [report, setReport] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<Id<'evidenceReports'> | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [busyReportAction, setBusyReportAction] = useState<string | null>(null);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const generated = await generateEvidenceReport({});
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
        reviewNotes: reviewNotes[id]?.trim() || undefined,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review the always-on regulated baseline, outbound vendor posture, and evidence readiness workflow."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="MFA Coverage"
          description="Phishing-resistant MFA coverage across Better Auth users, including passkeys."
          value={
            summary
              ? `${summary.auth.mfaCoveragePercent}% (${summary.auth.mfaEnabledUsers}/${summary.auth.totalUsers})`
              : 'Loading…'
          }
          footer={
            summary
              ? `${summary.auth.passkeyEnabledUsers} users have passkeys; verified email is always required`
              : undefined
          }
        />
        <SummaryCard
          title="File Inspection"
          description="Attachment and document inspection outcomes from the built-in inspection pipeline."
          value={
            summary
              ? `${summary.scanner.totalScans} inspected, ${summary.scanner.quarantinedCount} quarantined, ${summary.scanner.rejectedCount} rejected`
              : 'Loading…'
          }
          footer={
            summary?.scanner.lastScanAt
              ? `Last inspection ${new Date(summary.scanner.lastScanAt).toLocaleString()}`
              : 'No inspection events recorded yet'
          }
        />
        <SummaryCard
          title="Audit Integrity"
          description="Hash-chain failure signal from the audit subsystem."
          value={summary ? `${summary.audit.integrityFailures} integrity failures` : 'Loading…'}
          footer={
            summary?.audit.lastEventAt
              ? `Last audit event ${new Date(summary.audit.lastEventAt).toLocaleString()}`
              : 'No audit activity yet'
          }
        />
        <SummaryCard
          title="Retention Jobs"
          description="Latest retention or cleanup execution status."
          value={
            summary?.retention.lastJobStatus
              ? summary.retention.lastJobStatus
              : 'No retention job recorded'
          }
          footer={
            summary?.retention.lastJobAt
              ? `Last run ${new Date(summary.retention.lastJobAt).toLocaleString()}`
              : undefined
          }
        />
        <SummaryCard
          title="Telemetry"
          description="External telemetry posture for the regulated baseline."
          value={
            summary
              ? summary.telemetry.sentryApproved
                ? 'Sentry approved'
                : 'Sentry blocked by default'
              : 'Loading…'
          }
          footer={
            summary
              ? summary.telemetry.sentryEnabled
                ? 'Telemetry sink configured with explicit approval'
                : 'No approved telemetry sink active'
              : undefined
          }
        />
        <SummaryCard
          title="Session Policy"
          description="Short-lived verification posture applied across the app."
          value={
            summary
              ? `${summary.sessions.freshWindowMinutes} minute step-up window`
              : 'Loading…'
          }
          footer={
            summary
              ? `${summary.sessions.sessionExpiryHours}h sessions, ${summary.sessions.temporaryLinkTtlMinutes} minute temporary links`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Boundary</CardTitle>
          <CardDescription>
            Approved outbound integrations and the data classes each one is allowed to receive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary?.vendors.map((vendor) => (
            <div key={vendor.vendor} className="rounded-md border px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{vendor.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    {vendor.allowedDataClasses.join(', ')}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {vendor.approved
                    ? vendor.approvedByDefault
                      ? 'Approved by default'
                      : `Approved via ${vendor.approvalEnvVar}`
                    : `Blocked until ${vendor.approvalEnvVar ?? 'approved'}`}
                </p>
              </div>
            </div>
          )) ?? <p className="text-sm text-muted-foreground">Loading vendor posture…</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Report</CardTitle>
          <CardDescription>
            Generate a JSON evidence snapshot suitable for internal review and export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleGenerateReport} disabled={isGenerating}>
            {isGenerating ? 'Generating…' : 'Generate evidence report'}
          </Button>
          {report ? (
            <pre className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
              {report}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Review Queue</CardTitle>
          <CardDescription>
            Review generated evidence, capture notes, and export integrity-linked bundles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidenceReports?.length ? (
            evidenceReports.map((item) => (
              <div
                key={item.id}
                className="space-y-3 rounded-lg border p-4"
                data-selected={selectedReportId === item.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {item.reportKind} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Review: {item.reviewStatus} · Content hash: {item.contentHash}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.exportHash ? `Last export hash: ${item.exportHash}` : 'Not exported yet'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busyReportAction !== null}
                      onClick={() => {
                        void handleReviewReport(item.id, 'reviewed');
                      }}
                    >
                      {busyReportAction === `${item.id}:reviewed` ? 'Saving…' : 'Mark reviewed'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busyReportAction !== null}
                      onClick={() => {
                        void handleReviewReport(item.id, 'needs_follow_up');
                      }}
                    >
                      {busyReportAction === `${item.id}:needs_follow_up`
                        ? 'Saving…'
                        : 'Needs follow-up'}
                    </Button>
                    <Button
                      type="button"
                      disabled={busyReportAction !== null}
                      onClick={() => {
                        void handleExportReport(item.id);
                      }}
                    >
                      {busyReportAction === `${item.id}:export` ? 'Exporting…' : 'Export bundle'}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={reviewNotes[item.id] ?? item.reviewNotes ?? ''}
                  onChange={(event) => {
                    setReviewNotes((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }));
                  }}
                  placeholder="Reviewer notes"
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No evidence reports generated yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard(props: {
  description: string;
  footer?: string;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold">{props.value}</div>
        {props.footer ? <p className="text-sm text-muted-foreground">{props.footer}</p> : null}
      </CardContent>
    </Card>
  );
}
