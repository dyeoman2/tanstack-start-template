import { Spinner } from '~/components/ui/spinner';
import { AdminSecuritySummaryCard } from '~/features/security/components/AdminSecuritySummaryCard';
import { AdminSecurityTabHeader } from '~/features/security/components/AdminSecurityTabHeader';
import type { SecurityPostureSummary } from '~/features/security/types';
import {
  type ControlSummary,
  SecurityControlSummaryGrid,
} from '~/features/security/components/tabs/AdminSecurityTabShared';

export function AdminSecurityOverviewTab(props: {
  controlSummary: ControlSummary | undefined;
  summary: SecurityPostureSummary | undefined;
}) {
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
          title="Audit Integrity"
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
          title="Session Policy"
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
