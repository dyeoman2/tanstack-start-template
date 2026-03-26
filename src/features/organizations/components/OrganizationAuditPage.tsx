import { api } from '@convex/_generated/api';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from 'convex/react';
import { Braces, Download, List, Loader2, ScrollText } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import {
  createSortableHeader,
  DataTable,
  TableFilter,
  type TableFilterOption,
  TableSearch,
} from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet';
import { Spinner } from '~/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useToast } from '~/components/ui/toast';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { useStableOrganizationName } from '~/features/organizations/lib/organization-breadcrumb-state';
import type {
  OrganizationAuditEventType,
  OrganizationAuditSearchParams,
  OrganizationAuditSortField,
} from '~/features/organizations/lib/organization-management';
import { getServerFunctionErrorMessage } from '~/features/organizations/lib/organization-session';
import { exportOrganizationAuditCsvServerFn } from '~/features/organizations/server/organization-management';

const AUDIT_EVENT_FILTER_OPTIONS: TableFilterOption<'all' | OrganizationAuditEventType>[] = [
  { label: 'All events', value: 'all' },
  { label: 'Organization created', value: 'organization_created' },
  { label: 'Organization updated', value: 'organization_updated' },
  { label: 'Member added', value: 'member_added' },
  { label: 'Member removed', value: 'member_removed' },
  { label: 'Member role updated', value: 'member_role_updated' },
  { label: 'Member suspended', value: 'member_suspended' },
  { label: 'Member deactivated', value: 'member_deactivated' },
  { label: 'Member reactivated', value: 'member_reactivated' },
  { label: 'Invitation sent', value: 'member_invited' },
  { label: 'Invitation accepted', value: 'invite_accepted' },
  { label: 'Invitation rejected', value: 'invite_rejected' },
  { label: 'Invitation cancelled', value: 'invite_cancelled' },
  { label: 'Domain added', value: 'domain_added' },
  { label: 'Domain verified', value: 'domain_verification_succeeded' },
  { label: 'Domain verification failed', value: 'domain_verification_failed' },
  { label: 'Domain token regenerated', value: 'domain_verification_token_regenerated' },
  { label: 'Domain removed', value: 'domain_removed' },
  { label: 'Policies updated', value: 'organization_policy_updated' },
  { label: 'Enterprise auth mode updated', value: 'enterprise_auth_mode_updated' },
  { label: 'Enterprise break-glass used', value: 'enterprise_break_glass_used' },
  { label: 'Enterprise login succeeded', value: 'enterprise_login_succeeded' },
  { label: 'SCIM token generated', value: 'enterprise_scim_token_generated' },
  { label: 'SCIM token revoked', value: 'enterprise_scim_token_deleted' },
  { label: 'SCIM member deprovisioned', value: 'scim_member_deprovisioned' },
  { label: 'SCIM member reactivated', value: 'scim_member_reactivated' },
  { label: 'SCIM member deprovision failed', value: 'scim_member_deprovision_failed' },
  { label: 'Bulk invite revoked', value: 'bulk_invite_revoked' },
  { label: 'Bulk invite resent', value: 'bulk_invite_resent' },
  { label: 'Bulk member removed', value: 'bulk_member_removed' },
  { label: 'Support access granted', value: 'support_access_granted' },
  { label: 'Support access revoked', value: 'support_access_revoked' },
  { label: 'Support access used', value: 'support_access_used' },
  { label: 'Directory exported', value: 'directory_exported' },
  { label: 'Audit log exported', value: 'audit_log_exported' },
  { label: 'Retention hold applied', value: 'retention_hold_applied' },
  { label: 'Retention hold released', value: 'retention_hold_released' },
  { label: 'Retention purge completed', value: 'retention_purge_completed' },
  { label: 'Retention purge failed', value: 'retention_purge_failed' },
  { label: 'Retention purge skipped', value: 'retention_purge_skipped_on_hold' },
  { label: 'Chat thread created', value: 'chat_thread_created' },
  { label: 'Chat thread deleted', value: 'chat_thread_deleted' },
  { label: 'Chat attachment uploaded', value: 'chat_attachment_uploaded' },
  { label: 'Chat attachment scan passed', value: 'chat_attachment_scan_passed' },
  { label: 'Chat attachment scan failed', value: 'chat_attachment_scan_failed' },
  { label: 'PDF parse requested', value: 'pdf_parse_requested' },
  { label: 'PDF parse succeeded', value: 'pdf_parse_succeeded' },
  { label: 'PDF parse failed', value: 'pdf_parse_failed' },
  { label: 'Chat run completed', value: 'chat_run_completed' },
  { label: 'Chat run failed', value: 'chat_run_failed' },
  { label: 'Web search used', value: 'chat_web_search_used' },
];

const DOMAIN_SUMMARY_EVENT_TYPES = new Set<OrganizationAuditEventType>([
  'domain_verification_failed',
  'domain_verification_succeeded',
  'domain_verification_token_regenerated',
]);

const SCIM_SUMMARY_EVENT_TYPES = new Set<OrganizationAuditEventType>([
  'enterprise_scim_token_generated',
  'enterprise_scim_token_deleted',
]);

type QueryAuditRow = {
  id: string;
  eventType: string;
  label: string;
  actorLabel?: string;
  targetLabel?: string;
  summary?: string;
  userId?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  identifier?: string;
  sessionId?: string;
  requestId?: string;
  outcome?: 'success' | 'failure';
  severity?: 'info' | 'warning' | 'critical';
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  sourceSurface?: string;
  eventHash?: string;
  previousEventHash?: string;
  createdAt: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: unknown;
};

type RawOrganizationAuditRow = QueryAuditRow & {
  kind: 'raw';
};

type SummaryOrganizationAuditRow = {
  kind: 'summary';
  id: string;
  eventType: 'domain_verification_activity' | 'scim_token_activity';
  label: string;
  actorLabel?: string;
  targetLabel: string;
  summary: string;
  createdAt: number;
  latestCreatedAt: number;
  count: number;
  status: 'success' | 'warning' | 'active' | 'inactive';
  groupKind: 'domain_verification' | 'scim_token';
  underlyingEvents: RawOrganizationAuditRow[];
};

type OrganizationAuditRow = RawOrganizationAuditRow | SummaryOrganizationAuditRow;
type AuditViewMode = 'summary' | 'raw';

type AuditPostureSummary = {
  domainStatus: 'verified' | 'needs_attention';
  verifiedDomainCount: number;
  scimStatus: 'active' | 'inactive';
  enterpriseAuthMode: 'off' | 'optional' | 'required';
};

type AuditPostureCardConfig = {
  title: string;
  value: string;
  description: string;
  tone:
    | AuditPostureSummary['domainStatus']
    | AuditPostureSummary['scimStatus']
    | AuditPostureSummary['enterpriseAuthMode'];
  eventType:
    | 'domain_verification_succeeded'
    | 'domain_verification_failed'
    | 'enterprise_scim_token_generated'
    | 'enterprise_scim_token_deleted'
    | 'enterprise_auth_mode_updated';
};

const POLICY_CHANGE_LABELS: Record<string, string> = {
  invitePolicy: 'Invite policy',
  verifiedDomainsOnly: 'Verified domains only',
  memberCap: 'Member cap',
  mfaRequired: 'MFA required',
  enterpriseAuthMode: 'Enterprise auth mode',
  enterpriseProviderKey: 'Enterprise provider',
  enterpriseProtocol: 'Protocol',
  enterpriseEnabledAt: 'Enterprise auth enabled',
  enterpriseEnforcedAt: 'Enterprise auth enforced',
  allowBreakGlassPasswordLogin: 'Break-glass login',
};

function normalizeAuditLabel(eventType: string, fallbackLabel: string) {
  switch (eventType) {
    case 'enterprise_scim_token_generated':
      return 'SCIM token created';
    case 'enterprise_scim_token_deleted':
      return 'SCIM token revoked';
    case 'domain_verification_token_regenerated':
      return 'Domain verification token regenerated';
    default:
      return fallbackLabel;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getMetadataRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function humanizeEnterpriseAuthMode(value: unknown) {
  switch (value) {
    case 'off':
      return 'Off';
    case 'optional':
      return 'Optional';
    case 'required':
      return 'Required';
    default:
      return undefined;
  }
}

function humanizePolicyChangeKey(value: string) {
  return POLICY_CHANGE_LABELS[value] ?? value;
}

function formatAuditTableTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatAuditExactTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function toRawAuditRow(row: QueryAuditRow): RawOrganizationAuditRow {
  return {
    ...row,
    kind: 'raw',
    label: normalizeAuditLabel(row.eventType, row.label),
  };
}

function getRawAuditSummary(row: RawOrganizationAuditRow) {
  const metadataRecord = getMetadataRecord(row.metadata);

  if (row.eventType === 'organization_policy_updated') {
    const changedKeys = Array.isArray(metadataRecord?.changedKeys)
      ? metadataRecord.changedKeys.filter((value): value is string => typeof value === 'string')
      : [];
    return changedKeys.length > 0
      ? `Changed: ${changedKeys.map(humanizePolicyChangeKey).join(', ')}`
      : 'Organization policies updated.';
  }

  if (row.eventType === 'enterprise_auth_mode_updated') {
    const previousMode = humanizeEnterpriseAuthMode(metadataRecord?.previousMode);
    const nextMode = humanizeEnterpriseAuthMode(metadataRecord?.nextMode);
    if (previousMode && nextMode) {
      return `Changed from ${previousMode} to ${nextMode}.`;
    }
    return 'Enterprise auth mode updated.';
  }

  if (row.summary) {
    return row.summary;
  }

  switch (row.eventType) {
    case 'support_access_granted':
      return 'A temporary provider support grant was issued.';
    case 'support_access_revoked':
      return 'A temporary provider support grant was revoked.';
    case 'support_access_used':
      return 'Provider support used a temporary access grant.';
    case 'enterprise_scim_token_generated':
      return 'A new SCIM token was created for this provider.';
    case 'enterprise_scim_token_deleted':
      return 'The SCIM token was revoked for this provider.';
    case 'domain_verification_failed':
      return 'Domain verification failed.';
    case 'domain_verification_succeeded':
      return 'Domain verification succeeded.';
    case 'domain_verification_token_regenerated':
      return 'A new domain verification token was generated.';
    default:
      return row.label;
  }
}

function getDomainTarget(row: RawOrganizationAuditRow) {
  if (isRecord(row.metadata)) {
    return (
      getStringValue(row.metadata.domain) ??
      getStringValue(row.metadata.normalizedDomain) ??
      row.targetLabel ??
      row.identifier
    );
  }

  return row.targetLabel ?? row.identifier;
}

function getScimTarget(row: RawOrganizationAuditRow) {
  if (isRecord(row.metadata)) {
    return (
      getStringValue(row.metadata.providerLabel) ??
      row.actorLabel ??
      getStringValue(row.metadata.providerId) ??
      row.targetLabel ??
      row.identifier
    );
  }

  return row.targetLabel ?? row.identifier;
}

function compareRawRowsByCreatedAtDesc(
  left: RawOrganizationAuditRow,
  right: RawOrganizationAuditRow,
) {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id);
}

function buildDomainSummaryRow(
  targetLabel: string,
  rows: RawOrganizationAuditRow[],
): SummaryOrganizationAuditRow {
  const sortedRows = [...rows].sort(compareRawRowsByCreatedAtDesc);
  const latestRow = sortedRows[0];
  const failureCount = sortedRows.filter(
    (row) => row.eventType === 'domain_verification_failed',
  ).length;
  const regeneratedCount = sortedRows.filter(
    (row) => row.eventType === 'domain_verification_token_regenerated',
  ).length;
  const actorLabel = latestRow.actorLabel;
  const latestSucceeded = latestRow.eventType === 'domain_verification_succeeded';
  const latestFailed = latestRow.eventType === 'domain_verification_failed';

  let summary = '';
  if (latestSucceeded && failureCount > 0) {
    summary = `Verification failed ${failureCount} time${failureCount === 1 ? '' : 's'} before succeeding.`;
  } else if (latestSucceeded) {
    summary = 'Domain verification succeeded.';
  } else if (latestFailed) {
    summary = `Domain verification failed ${failureCount} time${failureCount === 1 ? '' : 's'}.`;
  } else {
    summary = `Verification token regenerated ${regeneratedCount} time${regeneratedCount === 1 ? '' : 's'}.`;
  }

  if (regeneratedCount > 0 && latestRow.eventType !== 'domain_verification_token_regenerated') {
    summary += ` Token regenerated ${regeneratedCount} time${regeneratedCount === 1 ? '' : 's'}.`;
  }

  return {
    kind: 'summary',
    id: `domain:${targetLabel}`,
    eventType: 'domain_verification_activity',
    label: latestSucceeded ? 'Domain verified' : 'Domain verification activity',
    ...(actorLabel ? { actorLabel } : {}),
    targetLabel,
    summary,
    createdAt: latestRow.createdAt,
    latestCreatedAt: latestRow.createdAt,
    count: sortedRows.length,
    status: latestSucceeded ? 'success' : 'warning',
    groupKind: 'domain_verification',
    underlyingEvents: sortedRows,
  };
}

function buildScimSummaryRow(
  groupKey: string,
  rows: RawOrganizationAuditRow[],
): SummaryOrganizationAuditRow {
  const sortedRows = [...rows].sort(compareRawRowsByCreatedAtDesc);
  const latestRow = sortedRows[0];
  const generatedCount = sortedRows.filter(
    (row) => row.eventType === 'enterprise_scim_token_generated',
  ).length;
  const deletedCount = sortedRows.filter(
    (row) => row.eventType === 'enterprise_scim_token_deleted',
  ).length;
  const rotationCount = Math.min(generatedCount, deletedCount);
  const latestDeleted = latestRow.eventType === 'enterprise_scim_token_deleted';
  const actorLabel = latestRow.actorLabel;

  let summary = '';
  if (rotationCount > 0) {
    summary = `SCIM token rotated ${rotationCount} time${rotationCount === 1 ? '' : 's'}.`;
  } else if (generatedCount > 1) {
    summary = `SCIM token created ${generatedCount} time${generatedCount === 1 ? '' : 's'}.`;
  } else if (deletedCount > 1) {
    summary = `SCIM token revoked ${deletedCount} time${deletedCount === 1 ? '' : 's'}.`;
  } else {
    summary = latestDeleted
      ? 'SCIM token is currently revoked.'
      : 'SCIM token is currently active.';
  }

  summary += latestDeleted ? ' Latest token is inactive.' : ' Latest token is active.';

  return {
    kind: 'summary',
    id: `scim:${groupKey}`,
    eventType: 'scim_token_activity',
    label: latestDeleted ? 'SCIM token revoked' : 'SCIM token created',
    ...(actorLabel ? { actorLabel } : {}),
    targetLabel: 'SCIM token',
    summary,
    createdAt: latestRow.createdAt,
    latestCreatedAt: latestRow.createdAt,
    count: sortedRows.length,
    status: latestDeleted ? 'inactive' : 'active',
    groupKind: 'scim_token',
    underlyingEvents: sortedRows,
  };
}

function buildSummaryRows(rows: RawOrganizationAuditRow[], sortOrder: 'asc' | 'desc') {
  const domainGroups = new Map<string, RawOrganizationAuditRow[]>();
  const scimGroups = new Map<string, RawOrganizationAuditRow[]>();
  const passthroughRows: OrganizationAuditRow[] = [];

  for (const row of rows) {
    if (DOMAIN_SUMMARY_EVENT_TYPES.has(row.eventType as OrganizationAuditEventType)) {
      const target = getDomainTarget(row);
      if (!target) {
        passthroughRows.push(row);
        continue;
      }

      const existingRows = domainGroups.get(target) ?? [];
      existingRows.push(row);
      domainGroups.set(target, existingRows);
      continue;
    }

    if (SCIM_SUMMARY_EVENT_TYPES.has(row.eventType as OrganizationAuditEventType)) {
      const target = getScimTarget(row);
      if (!target) {
        passthroughRows.push(row);
        continue;
      }

      const existingRows = scimGroups.get(target) ?? [];
      existingRows.push(row);
      scimGroups.set(target, existingRows);
      continue;
    }

    passthroughRows.push(row);
  }

  const summarizedRows: OrganizationAuditRow[] = [...passthroughRows];

  for (const [targetLabel, groupedRows] of domainGroups.entries()) {
    if (groupedRows.length > 1) {
      summarizedRows.push(buildDomainSummaryRow(targetLabel, groupedRows));
      continue;
    }

    summarizedRows.push(...groupedRows);
  }

  for (const [targetLabel, groupedRows] of scimGroups.entries()) {
    if (groupedRows.length > 1) {
      summarizedRows.push(buildScimSummaryRow(targetLabel, groupedRows));
      continue;
    }

    summarizedRows.push(...groupedRows);
  }

  return summarizedRows.sort((left, right) => {
    const leftCreatedAt = left.kind === 'summary' ? left.latestCreatedAt : left.createdAt;
    const rightCreatedAt = right.kind === 'summary' ? right.latestCreatedAt : right.createdAt;
    const createdAtDelta =
      sortOrder === 'asc' ? leftCreatedAt - rightCreatedAt : rightCreatedAt - leftCreatedAt;

    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    return sortOrder === 'asc' ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id);
  });
}

function getSummaryDetails(row: SummaryOrganizationAuditRow) {
  const eventLabel =
    row.groupKind === 'domain_verification' ? 'domain verification events' : 'SCIM token events';
  return `${row.summary} Includes ${row.count} raw ${eventLabel}.`;
}

function getSummaryMetadata(row: SummaryOrganizationAuditRow) {
  const latestEvent = row.underlyingEvents[0];

  return {
    status: row.status,
    groupKind: row.groupKind,
    rawEventCount: row.count,
    latestCreatedAt: row.latestCreatedAt,
    latestActor: latestEvent?.actorLabel ?? null,
    latestTarget: latestEvent?.targetLabel ?? null,
    latestEvent: latestEvent ? getRawAuditDetails(latestEvent) : null,
  };
}

function getAuditRowStatusBadge(
  row: OrganizationAuditRow,
): { label: string; variant: 'success' | 'warning' | 'outline' } | null {
  if (row.kind === 'summary') {
    switch (row.status) {
      case 'success':
        return { label: 'Verified', variant: 'success' };
      case 'warning':
        return { label: 'Failed', variant: 'warning' };
      case 'active':
        return { label: 'Active', variant: 'success' };
      case 'inactive':
        return { label: 'Inactive', variant: 'warning' };
      default:
        return null;
    }
  }

  switch (row.eventType) {
    case 'domain_verification_succeeded':
      return { label: 'Verified', variant: 'success' };
    case 'domain_verification_failed':
    case 'scim_member_deprovision_failed':
      return { label: 'Failed', variant: 'warning' };
    case 'enterprise_scim_token_generated':
      return { label: 'Active', variant: 'success' };
    case 'enterprise_scim_token_deleted':
      return { label: 'Inactive', variant: 'warning' };
    default:
      if (row.outcome === 'success') {
        return { label: 'Success', variant: 'success' };
      }
      if (row.outcome === 'failure') {
        return { label: 'Failed', variant: 'warning' };
      }
      return null;
  }
}

function getRawAuditDetails(row: RawOrganizationAuditRow) {
  const metadataRecord = getMetadataRecord(row.metadata);

  return {
    actor: {
      display: row.actorLabel ?? null,
      exactEmail:
        getStringValue(metadataRecord?.actorEmail) ??
        getStringValue(metadataRecord?.inviterEmail) ??
        null,
      userId: row.actorUserId ?? row.userId ?? null,
      identifier: row.identifier ?? null,
    },
    target: {
      display: row.resourceLabel ?? row.targetLabel ?? null,
      exactEmail:
        getStringValue(metadataRecord?.targetEmail) ??
        getStringValue(metadataRecord?.email) ??
        null,
      domain: getStringValue(metadataRecord?.domain) ?? null,
      userId: row.targetUserId ?? null,
      resourceType: row.resourceType ?? null,
      resourceId: row.resourceId ?? null,
    },
    eventKey: row.eventType,
    sessionId: row.sessionId ?? null,
    requestId: row.requestId ?? null,
    outcome: row.outcome ?? null,
    severity: row.severity ?? null,
    sourceSurface: row.sourceSurface ?? null,
    eventHash: row.eventHash ?? null,
    previousEventHash: row.previousEventHash ?? null,
    ...(row.identifier ? { identifier: row.identifier } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
    ...(row.userAgent ? { userAgent: row.userAgent } : {}),
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

function AuditDetailsSheet({
  title,
  description,
  triggerLabel,
  icon,
  children,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" aria-label={triggerLabel}>
          {icon}
          <span className="sr-only">{triggerLabel}</span>
        </Button>
      </SheetTrigger>
      <SheetContent className="h-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function AuditDetailsSection({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border border-border/60 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

function AuditDetailsDataSheet({ row }: { row: RawOrganizationAuditRow }) {
  const details = getRawAuditDetails(row);

  return (
    <div className="space-y-3">
      <AuditDetailsSection label="Timestamp" value={formatAuditExactTimestamp(row.createdAt)} />
      <AuditDetailsSection label="Summary" value={getRawAuditSummary(row)} />
      <AuditDetailsSection
        label="Actor"
        value={
          <div className="space-y-1">
            <div>{details.actor.display ?? '—'}</div>
            {details.actor.exactEmail ? (
              <div className="text-xs text-muted-foreground">Email: {details.actor.exactEmail}</div>
            ) : null}
            {details.actor.userId ? (
              <div className="text-xs text-muted-foreground">User ID: {details.actor.userId}</div>
            ) : null}
            {details.actor.identifier ? (
              <div className="text-xs text-muted-foreground">
                Identifier: {details.actor.identifier}
              </div>
            ) : null}
          </div>
        }
      />
      <AuditDetailsSection
        label="Target"
        value={
          <div className="space-y-1">
            <div>{details.target.display ?? '—'}</div>
            {details.target.exactEmail ? (
              <div className="text-xs text-muted-foreground">
                Email: {details.target.exactEmail}
              </div>
            ) : null}
            {details.target.domain ? (
              <div className="text-xs text-muted-foreground">Domain: {details.target.domain}</div>
            ) : null}
            {details.target.userId ? (
              <div className="text-xs text-muted-foreground">User ID: {details.target.userId}</div>
            ) : null}
            {details.target.resourceType ? (
              <div className="text-xs text-muted-foreground">
                Resource type: {details.target.resourceType}
              </div>
            ) : null}
            {details.target.resourceId ? (
              <div className="text-xs text-muted-foreground">
                Resource ID: {details.target.resourceId}
              </div>
            ) : null}
          </div>
        }
      />
      <AuditDetailsSection label="Event key" value={details.eventKey} />
      <AuditDetailsSection
        label="Security context"
        value={
          <div className="space-y-1">
            <div>Outcome: {details.outcome ?? '—'}</div>
            <div>Severity: {details.severity ?? '—'}</div>
            <div>Session ID: {details.sessionId ?? '—'}</div>
            <div>Request ID: {details.requestId ?? '—'}</div>
            <div>Source surface: {details.sourceSurface ?? '—'}</div>
          </div>
        }
      />
      <AuditDetailsSection
        label="Integrity"
        value={
          <div className="space-y-1">
            <div>Event hash: {details.eventHash ?? '—'}</div>
            <div>Previous hash: {details.previousEventHash ?? '—'}</div>
          </div>
        }
      />
      <AuditDetailsSection
        label="Raw payload"
        value={
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(details, null, 2)}
          </pre>
        }
      />
    </div>
  );
}

function getPostureToneClass(
  value:
    | AuditPostureSummary['domainStatus']
    | AuditPostureSummary['scimStatus']
    | AuditPostureSummary['enterpriseAuthMode'],
) {
  if (value === 'verified' || value === 'active' || value === 'required') {
    return 'text-emerald-700';
  }

  if (value === 'needs_attention' || value === 'inactive' || value === 'off') {
    return 'text-amber-700';
  }

  return 'text-foreground';
}

export function OrganizationAuditPage({
  slug,
  searchParams,
}: {
  slug: string;
  searchParams: OrganizationAuditSearchParams;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const exportAuditCsv = exportOrganizationAuditCsvServerFn;
  const [isExporting, setIsExporting] = useState(false);
  const [viewMode, setViewMode] = useState<AuditViewMode>('summary');

  const rawResponse = useQuery(api.organizationManagement.listOrganizationAuditEvents, {
    slug,
    page: searchParams.page,
    pageSize: searchParams.pageSize,
    sortBy: searchParams.sortBy,
    sortOrder: searchParams.sortOrder,
    search: searchParams.search,
    preset: searchParams.preset,
    eventType: searchParams.eventType as never,
    startDate: searchParams.startDate,
    endDate: searchParams.endDate,
    failuresOnly: searchParams.failuresOnly,
  });

  const summarySourceResponse = useQuery(api.organizationManagement.listOrganizationAuditEvents, {
    slug,
    page: 1,
    pageSize: searchParams.pageSize,
    sortBy: searchParams.sortBy,
    sortOrder: searchParams.sortOrder,
    search: searchParams.search,
    preset: searchParams.preset,
    eventType: searchParams.eventType as never,
    startDate: searchParams.startDate,
    endDate: searchParams.endDate,
    failuresOnly: searchParams.failuresOnly,
    includeAllMatching: true,
  });
  const settingsResponse = useQuery(api.organizationManagement.getOrganizationSettings, { slug });
  const domainsResponse = useQuery(api.organizationManagement.listOrganizationDomains, { slug });

  const activeResponse = viewMode === 'summary' ? summarySourceResponse : rawResponse;
  const isLoading = activeResponse === undefined;
  const organizationName = useStableOrganizationName({
    names: [rawResponse?.organization.name, summarySourceResponse?.organization.name],
    slug,
    state: location.state,
  });

  const rawAuditRows = useMemo(
    () => (rawResponse?.events ?? []).map(toRawAuditRow),
    [rawResponse?.events],
  );
  const summarySourceRows = useMemo(
    () => (summarySourceResponse?.events ?? []).map(toRawAuditRow),
    [summarySourceResponse?.events],
  );
  const groupedSummaryRows = useMemo(
    () => buildSummaryRows(summarySourceRows, searchParams.sortOrder),
    [searchParams.sortOrder, summarySourceRows],
  );

  const summaryPagination = useMemo(() => {
    const total = groupedSummaryRows.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / searchParams.pageSize);
    const currentPage = totalPages === 0 ? 1 : Math.min(searchParams.page, Math.max(1, totalPages));

    return {
      page: currentPage,
      pageSize: searchParams.pageSize,
      total,
      totalPages,
    };
  }, [groupedSummaryRows.length, searchParams.page, searchParams.pageSize]);

  const summaryRows = useMemo(() => {
    const start = (summaryPagination.page - 1) * summaryPagination.pageSize;
    const end = start + summaryPagination.pageSize;

    return groupedSummaryRows.slice(start, end);
  }, [groupedSummaryRows, summaryPagination.page, summaryPagination.pageSize]);

  const tableRows = viewMode === 'summary' ? summaryRows : rawAuditRows;
  const auditPosture = useMemo<AuditPostureSummary | null>(() => {
    if (!settingsResponse || !domainsResponse) {
      return null;
    }

    const verifiedDomainCount = domainsResponse.domains.filter(
      (domain: (typeof domainsResponse.domains)[number]) => domain.status === 'verified',
    ).length;

    return {
      domainStatus: verifiedDomainCount > 0 ? 'verified' : 'needs_attention',
      verifiedDomainCount,
      scimStatus: settingsResponse.enterpriseAuth?.scimConnectionConfigured ? 'active' : 'inactive',
      enterpriseAuthMode: settingsResponse.policies.enterpriseAuthMode,
    };
  }, [domainsResponse, settingsResponse]);

  const handleSearchChange = useCallback(
    (search: string) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          search,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handleEventTypeChange = useCallback(
    (eventType: 'all' | OrganizationAuditEventType) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          eventType,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handlePresetChange = useCallback(
    (preset: OrganizationAuditSearchParams['preset']) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          preset,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handleStartDateChange = useCallback(
    (startDate: string) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          startDate,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handleEndDateChange = useCallback(
    (endDate: string) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          endDate,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handleFailuresOnlyChange = useCallback(() => {
    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        failuresOnly: !searchParams.failuresOnly,
      },
    });
  }, [navigate, searchParams, slug]);

  const handleClearInvestigationFilters = useCallback(() => {
    void navigate({
      to: '/app/organizations/$slug/audit',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        startDate: '',
        endDate: '',
        failuresOnly: false,
      },
    });
  }, [navigate, searchParams, slug]);

  const handleSorting = useCallback(
    (columnId: OrganizationAuditSortField) => {
      const nextSortOrder =
        searchParams.sortBy === columnId && searchParams.sortOrder === 'asc' ? 'desc' : 'asc';

      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          sortBy: columnId,
          sortOrder: nextSortOrder,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          pageSize,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);

    try {
      const result = await exportAuditCsv({
        data: {
          slug,
          sortBy: searchParams.sortBy,
          sortOrder: searchParams.sortOrder,
          preset: searchParams.preset,
          eventType: searchParams.eventType,
          search: searchParams.search,
          startDate: searchParams.startDate,
          endDate: searchParams.endDate,
          failuresOnly: searchParams.failuresOnly,
        },
      });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast('Audit log exported.', 'success');
    } catch (error) {
      showToast(getServerFunctionErrorMessage(error, 'Failed to export audit log'), 'error');
    } finally {
      setIsExporting(false);
    }
  }, [
    exportAuditCsv,
    searchParams.eventType,
    searchParams.failuresOnly,
    searchParams.endDate,
    searchParams.preset,
    searchParams.search,
    searchParams.startDate,
    searchParams.sortBy,
    searchParams.sortOrder,
    showToast,
    slug,
  ]);

  const handlePostureCardClick = useCallback(
    (eventType: AuditPostureCardConfig['eventType']) => {
      setViewMode('summary');
      void navigate({
        to: '/app/organizations/$slug/audit',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          eventType,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const columns = useMemo<ColumnDef<OrganizationAuditRow, unknown>[]>(
    () => [
      {
        accessorKey: 'label',
        header:
          viewMode === 'raw'
            ? createSortableHeader('Event', 'label', searchParams, handleSorting)
            : () => <div>Event</div>,
        cell: ({ row }) => {
          const statusBadge = getAuditRowStatusBadge(row.original);

          return (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{row.original.label}</span>
              {statusBadge ? (
                <Badge variant={statusBadge.variant} className="font-normal">
                  {statusBadge.label}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'actorLabel',
        header: () => <div>Actor</div>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.actorLabel ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'targetLabel',
        header: () => <div>Target</div>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {'targetLabel' in row.original ? (row.original.targetLabel ?? '—') : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: createSortableHeader('Created', 'createdAt', searchParams, handleSorting),
        cell: ({ row }) => (
          <span
            className="text-sm text-muted-foreground"
            title={formatAuditExactTimestamp(row.original.createdAt)}
          >
            {formatAuditTableTimestamp(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'details',
        header: () => <div>Details</div>,
        cell: ({ row }) => {
          if (row.original.kind === 'summary') {
            const summaryDetails = getSummaryDetails(row.original);

            return (
              <div className="max-w-md text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="flex shrink-0 items-center gap-1">
                    <AuditDetailsSheet
                      title={`${row.original.label} metadata`}
                      description="Summary metadata for the grouped audit activity."
                      triggerLabel="View metadata"
                      icon={<Braces className="size-4" />}
                    >
                      <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                        {JSON.stringify(getSummaryMetadata(row.original), null, 2)}
                      </pre>
                    </AuditDetailsSheet>
                    <AuditDetailsSheet
                      title={`${row.original.label} raw events`}
                      description="Underlying raw audit records included in this grouped row."
                      triggerLabel="View raw events"
                      icon={<List className="size-4" />}
                    >
                      <ul className="space-y-3 text-sm text-muted-foreground">
                        {row.original.underlyingEvents.map((event) => (
                          <li key={event.id} className="rounded-md border border-border/60 p-3">
                            <div className="font-medium text-foreground">{event.label}</div>
                            <div className="mt-1 text-xs">
                              {formatAuditTableTimestamp(event.createdAt)}
                            </div>
                            <div className="mt-2 text-sm">{getRawAuditSummary(event)}</div>
                            <div className="mt-3">
                              <AuditDetailsDataSheet row={event} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </AuditDetailsSheet>
                  </div>
                  <div className="min-w-0 flex-1 truncate text-foreground" title={summaryDetails}>
                    {summaryDetails}
                  </div>
                </div>
              </div>
            );
          }

          const rawSummary = getRawAuditSummary(row.original);

          return (
            <div className="max-w-md text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <AuditDetailsSheet
                  title={`${row.original.label} details`}
                  description="Additional data captured for this audit event."
                  triggerLabel="View details"
                  icon={<ScrollText className="size-4" />}
                >
                  <AuditDetailsDataSheet row={row.original} />
                </AuditDetailsSheet>
                <div
                  className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground"
                  title={rawSummary}
                >
                  {rawSummary}
                </div>
              </div>
            </div>
          );
        },
      },
    ],
    [handleSorting, searchParams, viewMode],
  );

  const hasInvestigationFilters =
    searchParams.failuresOnly ||
    searchParams.startDate.length > 0 ||
    searchParams.endDate.length > 0;

  const content = useMemo(() => {
    if (activeResponse === null) {
      return (
        <div className="rounded-xl border border-border/60 bg-background px-6 py-5">
          <h2 className="text-lg font-semibold text-foreground">Audit access required</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization owners, organization admins, and site admins can review audit history.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {viewMode === 'summary' && auditPosture ? (
          <div className="grid gap-3 md:grid-cols-3">
            {(
              [
                {
                  title: 'Domain verification',
                  value: auditPosture.domainStatus === 'verified' ? 'Verified' : 'Needs attention',
                  description: `${auditPosture.verifiedDomainCount} verified domain${auditPosture.verifiedDomainCount === 1 ? '' : 's'}`,
                  tone: auditPosture.domainStatus,
                  eventType:
                    auditPosture.domainStatus === 'verified'
                      ? 'domain_verification_succeeded'
                      : 'domain_verification_failed',
                },
                {
                  title: 'SCIM provisioning',
                  value: auditPosture.scimStatus === 'active' ? 'Active' : 'Inactive',
                  description:
                    auditPosture.scimStatus === 'active'
                      ? 'Provisioning connection is configured.'
                      : 'Provisioning connection is not configured.',
                  tone: auditPosture.scimStatus,
                  eventType:
                    auditPosture.scimStatus === 'active'
                      ? 'enterprise_scim_token_generated'
                      : 'enterprise_scim_token_deleted',
                },
                {
                  title: 'Enterprise auth mode',
                  value: humanizeEnterpriseAuthMode(auditPosture.enterpriseAuthMode) ?? 'Unknown',
                  description: 'Current organization sign-in requirement.',
                  tone: auditPosture.enterpriseAuthMode,
                  eventType: 'enterprise_auth_mode_updated',
                },
              ] satisfies AuditPostureCardConfig[]
            ).map((card) => (
              <button
                key={card.title}
                type="button"
                onClick={() => handlePostureCardClick(card.eventType)}
                className="text-left"
              >
                <Card className="gap-0 py-4 transition-colors hover:border-primary/40 hover:bg-accent/30">
                  <CardHeader className="px-4 pb-2">
                    <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4">
                    <div className={`text-base font-semibold ${getPostureToneClass(card.tone)}`}>
                      {card.value}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{card.description}</div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <TableFilter
              value={searchParams.eventType}
              options={AUDIT_EVENT_FILTER_OPTIONS}
              onValueChange={handleEventTypeChange}
              className="sm:w-44"
              ariaLabel="Filter audit events by type"
            />
            <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as AuditViewMode)}>
              <TabsList>
                <TabsTrigger value="summary">Summary view</TabsTrigger>
                <TabsTrigger value="raw">Raw events</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={searchParams.preset}
              onValueChange={(value) =>
                handlePresetChange(value as OrganizationAuditSearchParams['preset'])
              }
            >
              <TabsList>
                <TabsTrigger value="all">All activity</TabsTrigger>
                <TabsTrigger value="security">Security events</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end sm:flex-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Input
                type="date"
                value={searchParams.startDate}
                onChange={(event) => handleStartDateChange(event.target.value)}
                className="sm:w-40"
                aria-label="Filter audit events from date"
              />
              <Input
                type="date"
                value={searchParams.endDate}
                onChange={(event) => handleEndDateChange(event.target.value)}
                className="sm:w-40"
                aria-label="Filter audit events to date"
              />
              <Button
                type="button"
                variant={searchParams.failuresOnly ? 'default' : 'outline'}
                onClick={handleFailuresOnlyChange}
              >
                Failures only
              </Button>
              {hasInvestigationFilters ? (
                <Button type="button" variant="ghost" onClick={handleClearInvestigationFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
            <TableSearch
              initialValue={searchParams.search}
              onSearch={handleSearchChange}
              isSearching={isLoading}
              placeholder="Search by actor, target, identifier, or metadata"
              className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
              ariaLabel="Search organization audit events"
            />
            <Button type="button" variant="outline" onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              <span className="sr-only">Export CSV</span>
            </Button>
          </div>
        </div>

        <DataTable<OrganizationAuditRow>
          data={tableRows}
          columns={columns}
          pagination={
            viewMode === 'summary'
              ? summaryPagination
              : (rawResponse?.pagination ?? {
                  page: searchParams.page,
                  pageSize: searchParams.pageSize,
                  total: 0,
                  totalPages: 0,
                })
          }
          searchParams={searchParams}
          isLoading={isLoading}
          isFetching={isLoading}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          emptyMessage="No audit events matched the current filters."
          loadingSkeleton={
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Spinner className="size-5" />
              <span>Loading audit history...</span>
            </div>
          }
        />
      </div>
    );
  }, [
    activeResponse,
    columns,
    handleExport,
    isExporting,
    isLoading,
    rawResponse?.pagination,
    searchParams,
    summaryPagination,
    tableRows,
    viewMode,
    auditPosture,
    hasInvestigationFilters,
    handlePostureCardClick,
    handleClearInvestigationFilters,
    handleEndDateChange,
    handleEventTypeChange,
    handleFailuresOnlyChange,
    handlePageChange,
    handlePageSizeChange,
    handlePresetChange,
    handleSearchChange,
    handleStartDateChange,
  ]);

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        title={organizationName}
        description="Review organization-member activity and export the audit trail."
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />
      {content}
    </div>
  );
}
