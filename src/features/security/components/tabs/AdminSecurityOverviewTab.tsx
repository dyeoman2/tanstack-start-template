import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  Package,
  Shield,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Spinner } from '~/components/ui/spinner';
import { HelpTip } from '~/features/security/components/HelpTip';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import type {
  AuditReadinessOverview,
  ReviewRunSummary,
  SecurityPostureSummary,
  SecurityWorkspaceOverview,
} from '~/features/security/types';
import {
  type ControlSummary,
  SecurityControlSummaryGrid,
} from '~/features/security/components/tabs/AdminSecurityTabShared';

type ActionQueueItem = {
  count: number;
  icon: React.ReactNode;
  key: string;
  label: string;
  navigate: () => void;
  priority: 'critical' | 'warning' | 'info';
};

function ActionQueue({ actionItems }: { actionItems: ActionQueueItem[] }) {
  const [showAllActions, setShowAllActions] = useState(false);
  const primary = actionItems[0];
  const remaining = actionItems.slice(1);

  return (
    <div className="space-y-3">
      {/* Primary action hero */}
      <div className="flex items-center gap-4 rounded-lg border p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {primary.icon}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2 shrink-0 rounded-full ${primary.priority === 'critical' ? 'bg-destructive' : primary.priority === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`}
            />
            <span className="text-base font-semibold">{primary.label}</span>
            <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {primary.count}
            </span>
          </div>
        </div>
        <Button size="sm" onClick={primary.navigate}>
          Go to action
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>

      {/* Collapsible remaining items */}
      {remaining.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              setShowAllActions((prev) => !prev);
            }}
          >
            <ChevronDown
              className={`mr-2 size-4 transition-transform ${showAllActions ? 'rotate-0' : '-rotate-90'}`}
            />
            {remaining.length} more item{remaining.length === 1 ? '' : 's'} need
            {remaining.length === 1 ? 's' : ''} attention
          </Button>

          {showAllActions && (
            <div className="mt-1 divide-y rounded-lg border">
              {remaining.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  onClick={item.navigate}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    {item.icon}
                  </span>
                  <span
                    className={`mr-1 inline-block size-2 shrink-0 rounded-full ${item.priority === 'critical' ? 'bg-destructive' : item.priority === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground/40'}`}
                  />
                  <span className="flex-1 text-sm font-medium">{item.label}</span>
                  <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {item.count}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminSecurityOverviewTab(props: {
  auditReadiness: AuditReadinessOverview | undefined;
  controlSummary: ControlSummary | undefined;
  currentAnnualReviewRun: ReviewRunSummary | null | undefined;
  findingSummary: SecurityWorkspaceOverview['findingSummary'] | undefined;
  queues: SecurityWorkspaceOverview['queues'] | undefined;
  summary: SecurityPostureSummary | undefined;
  vendorSummary: SecurityWorkspaceOverview['vendorSummary'] | undefined;
}) {
  const navigate = useNavigate();

  const navigateToFindings = useCallback(
    (search?: Record<string, string>) => {
      void navigate({ to: '/app/admin/security/findings', search: search ?? {} });
    },
    [navigate],
  );

  const navigateToReviews = useCallback(() => {
    void navigate({
      to: '/app/admin/security/reviews',
      search: {
        selectedReviewRun: undefined,
      },
    });
  }, [navigate]);

  const navigateToVendors = useCallback(() => {
    void navigate({ to: '/app/admin/security/vendors', search: {} });
  }, [navigate]);

  const navigateToControls = useCallback(
    (search?: Record<string, string>) => {
      void navigate({ to: '/app/admin/security/controls', search: search ?? {} });
    },
    [navigate],
  );

  const actionItems = useMemo(() => {
    const items: ActionQueueItem[] = [];

    // Critical priority — action required immediately
    if (props.auditReadiness?.lastIntegrityFailure) {
      items.push({
        count: 1,
        icon: <AlertTriangle className="size-4 text-red-600" />,
        key: 'audit-integrity-failure',
        label: 'Investigate audit integrity failure',
        navigate: navigateToReviews,
        priority: 'critical',
      });
    }

    if (props.queues?.blockedReviewTasks && props.queues.blockedReviewTasks > 0) {
      const n = props.queues.blockedReviewTasks;
      items.push({
        count: n,
        icon: <ClipboardList className="size-4 text-red-600" />,
        key: 'blocked-review-tasks',
        label: `Unblock ${n} review task${n === 1 ? '' : 's'}`,
        navigate: navigateToReviews,
        priority: 'critical',
      });
    }

    // Warning priority — needs attention soon
    if (props.queues?.undispositionedFindings && props.queues.undispositionedFindings > 0) {
      const n = props.queues.undispositionedFindings;
      items.push({
        count: n,
        icon: <AlertTriangle className="size-4 text-amber-600" />,
        key: 'undispositioned-findings',
        label: `Review ${n} undispositioned finding${n === 1 ? '' : 's'}`,
        navigate: () => {
          navigateToFindings({ findingDisposition: 'pending_review' });
        },
        priority: 'warning',
      });
    }

    if (props.queues?.pendingVendorReviews && props.queues.pendingVendorReviews > 0) {
      const n = props.queues.pendingVendorReviews;
      items.push({
        count: n,
        icon: <Package className="size-4 text-orange-600" />,
        key: 'pending-vendor-reviews',
        label: `Complete ${n} vendor review${n === 1 ? '' : 's'}`,
        navigate: navigateToVendors,
        priority: 'warning',
      });
    }

    if (props.queues?.missingSupportControls && props.queues.missingSupportControls > 0) {
      const n = props.queues.missingSupportControls;
      items.push({
        count: n,
        icon: <Shield className="size-4 text-red-600" />,
        key: 'missing-support-controls',
        label: `Add evidence for ${n} control${n === 1 ? '' : 's'}`,
        navigate: () => {
          navigateToControls({ support: 'missing' });
        },
        priority: 'warning',
      });
    }

    // Informational priority — routine follow-up
    if (
      props.currentAnnualReviewRun?.taskCounts.ready &&
      props.currentAnnualReviewRun.taskCounts.ready > 0
    ) {
      const n = props.currentAnnualReviewRun.taskCounts.ready;
      items.push({
        count: n,
        icon: <Eye className="size-4 text-blue-600" />,
        key: 'review-tasks-pending',
        label: `Complete ${n} pending review task${n === 1 ? '' : 's'}`,
        navigate: navigateToReviews,
        priority: 'info',
      });
    }

    if (props.auditReadiness) {
      const latestDrill = props.auditReadiness.latestBackupDrill;
      const staleDrill =
        latestDrill === null || Date.now() - latestDrill.checkedAt > 30 * 24 * 60 * 60 * 1000;
      if (staleDrill) {
        items.push({
          count: 1,
          icon: <AlertTriangle className="size-4 text-amber-600" />,
          key: 'stale-backup-drill',
          label: 'Renew stale backup drill evidence',
          navigate: navigateToReviews,
          priority: 'info',
        });
      }
    }

    return items;
  }, [
    props.queues,
    props.currentAnnualReviewRun,
    props.auditReadiness,
    navigateToFindings,
    navigateToReviews,
    navigateToVendors,
    navigateToControls,
  ]);

  const isLoading = props.queues === undefined;

  const loadingValue = (
    <>
      <Spinner className="size-5" />
      <span className="sr-only">Loading</span>
    </>
  );

  return (
    <>
      <AdminSecurityTabHeader
        title="Overview"
        description="Program-wide posture across authentication, audit integrity, inspection pipelines, retention jobs, telemetry, and session policy."
      />

      {/* Action queue */}
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>
            Actionable items across findings, reviews, vendors, and controls that require follow-up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Spinner className="size-5" />
              <span className="text-sm text-muted-foreground">Loading action items...</span>
            </div>
          ) : actionItems.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <CheckCircle2 className="size-5 text-emerald-600" />
              <p className="text-sm text-emerald-900">All clear -- no items need attention</p>
            </div>
          ) : (
            <ActionQueue actionItems={actionItems} />
          )}
        </CardContent>
      </Card>

      {/* Security posture summary cards */}
      <h3 className="text-lg font-semibold">Security posture</h3>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <AdminSecuritySummaryCard
          title="MFA Coverage"
          description="Phishing-resistant MFA coverage across Better Auth users, including passkeys."
          value={
            props.summary
              ? `${props.summary.auth.mfaCoveragePercent}% (${props.summary.auth.mfaEnabledUsers}/${props.summary.auth.totalUsers})`
              : loadingValue
          }
          footer={
            props.summary
              ? `${props.summary.auth.passkeyEnabledUsers} users have passkeys; verified email is always required`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="File Inspection"
          description="Attachment and document inspection outcomes from the built-in inspection pipeline."
          value={
            props.summary
              ? `${props.summary.scanner.totalScans} inspected, ${props.summary.scanner.quarantinedCount} quarantined, ${props.summary.scanner.rejectedCount} rejected`
              : loadingValue
          }
          footer={
            props.summary?.scanner.lastScanAt
              ? `Last inspection ${new Date(props.summary.scanner.lastScanAt).toLocaleString()}`
              : 'No inspection events recorded yet'
          }
        />
        <AdminSecuritySummaryCard
          title={
            <>
              Audit Integrity
              <HelpTip term="hash chain" />
            </>
          }
          description="Hash-chain failure signal from the audit subsystem."
          value={
            props.summary
              ? `${props.summary.audit.integrityFailures} integrity failures`
              : loadingValue
          }
          footer={
            props.summary?.audit.lastEventAt
              ? `Last audit event ${new Date(props.summary.audit.lastEventAt).toLocaleString()}`
              : 'No audit activity yet'
          }
        />
        <AdminSecuritySummaryCard
          title="Retention Jobs"
          description="Latest retention or cleanup execution status."
          value={
            props.summary?.retention.lastJobStatus
              ? props.summary.retention.lastJobStatus
              : 'No retention job recorded'
          }
          footer={
            props.summary?.retention.lastJobAt
              ? `Last run ${new Date(props.summary.retention.lastJobAt).toLocaleString()}`
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title="Telemetry"
          description="External telemetry posture for the regulated baseline."
          value={
            props.summary
              ? props.summary.telemetry.sentryApproved
                ? 'Sentry approved'
                : 'Sentry blocked by default'
              : loadingValue
          }
          footer={
            props.summary
              ? props.summary.telemetry.sentryEnabled
                ? 'Telemetry sink configured with explicit approval'
                : 'No approved telemetry sink active'
              : undefined
          }
        />
        <AdminSecuritySummaryCard
          title={
            <>
              Session Policy
              <HelpTip term="step-up window" />
            </>
          }
          description="Short-lived verification posture applied across the app."
          value={
            props.summary
              ? `${props.summary.sessions.freshWindowMinutes} minute step-up window`
              : loadingValue
          }
          footer={
            props.summary
              ? `${props.summary.sessions.sessionExpiryHours}h sessions, ${props.summary.sessions.temporaryLinkTtlMinutes} minute temporary links`
              : undefined
          }
        />
      </div>

      <SecurityControlSummaryGrid controlSummary={props.controlSummary} />
    </>
  );
}
