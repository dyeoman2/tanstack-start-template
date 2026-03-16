import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
import { useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

export const Route = createFileRoute('/app/admin/security')({
  component: AdminSecurityRoute,
});

function AdminSecurityRoute() {
  const summary = useQuery(api.security.getSecurityPostureSummary, {});
  const generateEvidenceReport = useAction(api.security.generateEvidenceReport);
  const [report, setReport] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const generated = await generateEvidenceReport({});
      setReport(generated.report);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review regulated baseline controls, MFA coverage, scan health, retention jobs, and evidence exports."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="MFA Coverage"
          description="Two-factor coverage across Better Auth users."
          value={
            summary
              ? `${summary.auth.mfaCoveragePercent}% (${summary.auth.mfaEnabledUsers}/${summary.auth.totalUsers})`
              : 'Loading…'
          }
        />
        <SummaryCard
          title="Scanner Activity"
          description="Attachment scan volume and quarantine outcomes."
          value={
            summary
              ? `${summary.scanner.totalScans} scans, ${summary.scanner.quarantinedCount} quarantined`
              : 'Loading…'
          }
          footer={
            summary?.scanner.lastScanAt
              ? `Last scan ${new Date(summary.scanner.lastScanAt).toLocaleString()}`
              : 'No scans recorded yet'
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
          title="Backup Verification"
          description="Latest operator-reported backup verification outcome."
          value={
            summary?.backups.lastStatus
              ? summary.backups.lastStatus
              : 'No backup verification recorded'
          }
          footer={
            summary?.backups.lastCheckedAt
              ? `Checked ${new Date(summary.backups.lastCheckedAt).toLocaleString()}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evidence Report</CardTitle>
          <CardDescription>
            Generate a JSON evidence snapshot suitable for internal review and control walkthroughs.
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
