import { render, screen, waitFor, within } from '@testing-library/react';
import { getFunctionName } from 'convex/server';
import userEvent from '@testing-library/user-event';
import { AdminSecurityControlsRoute } from '~/features/security/components/routes/AdminSecurityControlsRoute';
import { AdminSecurityFindingsRoute } from '~/features/security/components/routes/AdminSecurityFindingsRoute';
import { AdminSecurityOverviewRoute } from '~/features/security/components/routes/AdminSecurityOverviewRoute';
import { AdminSecurityPoliciesRoute } from '~/features/security/components/routes/AdminSecurityPoliciesRoute';
import { AdminSecurityReportsRoute } from '~/features/security/components/routes/AdminSecurityReportsRoute';
import { AdminSecurityReviewsRoute } from '~/features/security/components/routes/AdminSecurityReviewsRoute';
import { AdminSecurityPageShell } from '~/features/security/components/routes/AdminSecurityShell';
import { AdminSecurityVendorsRoute } from '~/features/security/components/routes/AdminSecurityVendorsRoute';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useSearchMock,
  useLocationMock,
  navigateMock,
  useQueryMock,
  useActionMock,
  useMutationMock,
  useConvexMock,
  showToastMock,
} = vi.hoisted(() => ({
  useSearchMock: vi.fn(),
  useLocationMock: vi.fn(),
  navigateMock: vi.fn(),
  useQueryMock: vi.fn(),
  useActionMock: vi.fn(),
  useMutationMock: vi.fn(),
  useConvexMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
    useSearch: useSearchMock,
  }),
  useLocation: () => useLocationMock(),
  useNavigate: () => navigateMock,
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useConvex: () => useConvexMock(),
}));

vi.mock('~/components/data-table', () => ({
  createSortableHeader: (label: string) => label,
  formatTableDate: (value: number) => new Date(value).toLocaleDateString(),
  DataTable: ({
    data,
    onRowClick,
    emptyMessage,
  }: {
    data: Array<{ internalControlId: string; title: string }>;
    onRowClick?: (row: { internalControlId: string; title: string }) => void;
    emptyMessage: string;
  }) =>
    data.length > 0 ? (
      <div>
        {data.map((row) => (
          <button
            key={row.internalControlId}
            type="button"
            onClick={() => {
              onRowClick?.(row);
            }}
          >
            {row.title}
          </button>
        ))}
      </div>
    ) : (
      <p>{emptyMessage}</p>
    ),
  TableFilter: () => <div />,
  TableSearch: () => <div />,
}));

vi.mock('~/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

vi.mock('~/features/security/components/SecurityPolicyMarkdownRenderer', () => ({
  SecurityPolicyMarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

type SearchState = {
  tab: 'overview' | 'controls' | 'policies' | 'vendors' | 'findings' | 'reports' | 'reviews';
  findingDisposition?:
    | 'all'
    | 'accepted_risk'
    | 'false_positive'
    | 'investigating'
    | 'pending_review'
    | 'resolved';
  findingSearch?: string;
  findingSeverity?: 'all' | 'critical' | 'warning' | 'info';
  findingStatus?: 'all' | 'open' | 'resolved';
  sortBy: 'control' | 'support' | 'responsibility' | 'family';
  sortOrder: 'asc' | 'desc';
  reportKind?:
    | 'all'
    | 'security_posture'
    | 'audit_integrity'
    | 'audit_readiness'
    | 'annual_review'
    | 'findings_snapshot'
    | 'vendor_posture_snapshot'
    | 'control_workspace_snapshot';
  reportReviewStatus?: 'all' | 'needs_follow_up' | 'pending' | 'reviewed';
  reportSearch?: string;
  policySearch?: string;
  policySortBy?: 'title' | 'support' | 'owner' | 'mappedControlCount' | 'nextReviewAt';
  policySortOrder?: 'asc' | 'desc';
  policySupport?: 'all' | 'complete' | 'partial' | 'missing';
  search: string;
  responsibility: 'all' | 'platform' | 'shared-responsibility' | 'customer';
  support: 'all' | 'complete' | 'partial' | 'missing';
  family: string;
  selectedControl?: string;
  selectedFinding?: string;
  selectedPolicy?: string;
  selectedReport?: string;
  selectedReviewRun?: string;
  selectedVendor?: string;
};

const defaultSearch: SearchState = {
  tab: 'reports',
  findingDisposition: 'all',
  findingSearch: '',
  findingSeverity: 'all',
  findingStatus: 'all',
  policySearch: '',
  policySortBy: 'title',
  policySortOrder: 'asc',
  policySupport: 'all',
  reportKind: 'all',
  reportReviewStatus: 'all',
  reportSearch: '',
  sortBy: 'control',
  sortOrder: 'asc',
  search: '',
  responsibility: 'all',
  support: 'all',
  family: 'all',
  selectedControl: undefined,
  selectedFinding: undefined,
  selectedPolicy: undefined,
  selectedReport: undefined,
  selectedReviewRun: undefined,
  selectedVendor: undefined,
};

function buildSummary() {
  return {
    auth: {
      mfaCoveragePercent: 75,
      mfaEnabledUsers: 3,
      totalUsers: 4,
      passkeyEnabledUsers: 1,
    },
    scanner: {
      totalScans: 12,
      quarantinedCount: 0,
      rejectedCount: 0,
      lastScanAt: Date.parse('2026-03-18T08:00:00.000Z'),
    },
    audit: {
      integrityFailures: 0,
      lastEventAt: Date.parse('2026-03-18T08:00:00.000Z'),
    },
    retention: {
      lastJobStatus: 'completed',
      lastJobAt: Date.parse('2026-03-18T08:00:00.000Z'),
    },
    telemetry: {
      sentryApproved: true,
      sentryEnabled: true,
    },
    sessions: {
      freshWindowMinutes: 15,
      sessionExpiryHours: 24,
      temporaryLinkTtlMinutes: 15,
    },
    vendors: [
      {
        vendor: 'aws',
        displayName: 'AWS',
        allowedDataClasses: ['metadata'],
        allowedEnvironments: ['production'],
        approved: true,
        approvedByDefault: true,
        approvalEnvVar: null,
      },
    ],
  };
}

function buildAuditReadiness(overrides?: Partial<Record<string, unknown>>) {
  return {
    latestBackupDrill: {
      artifactHash: 'artifact-hash-1',
      checkedAt: Date.parse('2026-03-17T08:00:00.000Z'),
      drillId: 'drill-1',
      drillType: 'restore_verification',
      failureReason: null,
      initiatedByKind: 'user',
      initiatedByUserId: 'admin-user',
      restoredItemCount: 4,
      sourceDataset: 'auditLedgerEvents',
      status: 'success',
      targetEnvironment: 'test',
      verificationMethod: 'checksum-compare',
    },
    latestRetentionJob: {
      createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
      details: 'ok',
      jobKind: 'attachment_purge',
      processedCount: 2,
      status: 'success',
    },
    metadataGaps: [],
    recentDeniedActions: [],
    recentExports: [
      {
        artifactType: 'evidence_report_export',
        exportedAt: Date.parse('2026-03-18T09:00:00.000Z'),
        manifestHash: 'manifest-hash-1',
        sourceReportId: 'report-1',
      },
    ],
    ...overrides,
  };
}

function buildControlEvidence(overrides?: Partial<Record<string, unknown>>) {
  return {
    archivedAt: null,
    archivedByDisplay: null,
    createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
    description: 'Collected for quarterly review.',
    evidenceDate: Date.parse('2026-03-01T00:00:00.000Z'),
    evidenceType: 'link',
    expiryStatus: 'current',
    fileName: null,
    id: 'evidence-1',
    lifecycleStatus: 'active',
    mimeType: null,
    renewedFromEvidenceId: null,
    replacedByEvidenceId: null,
    reviewDueIntervalMonths: 3,
    reviewStatus: 'pending',
    reviewedAt: null,
    reviewedByDisplay: null,
    sizeBytes: null,
    source: 'internal_review',
    storageId: null,
    sufficiency: 'sufficient',
    title: 'Access review packet',
    uploadedByDisplay: 'Casey',
    url: 'https://example.com/evidence/access-review',
    validUntil: Date.parse('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildControl(
  overrides?: Partial<Record<string, unknown>> & {
    platformChecklist?: Array<Record<string, unknown>>;
  },
) {
  return {
    controlStatement: 'Access to systems is approved and reviewed.',
    implementationSummary: 'The platform enforces access review workflows for privileged systems.',
    familyId: 'AC',
    familyTitle: 'Access Control',
    internalControlId: 'ac-1',
    mappings: {
      csf20: [],
      hipaa: [],
      nist80066: [],
      soc2: [],
    },
    nist80053Id: 'AC-2',
    owner: 'Security team',
    priority: 'p1',
    responsibility: 'platform',
    customerResponsibilityNotes: null,
    title: 'Account Management',
    support: 'partial',
    hasExpiringSoonEvidence: false,
    lastReviewedAt: null,
    linkedEntities: [],
    platformChecklist: [
      {
        completedAt: null,
        description: 'Collect access review evidence.',
        evidence: [],
        support: 'missing',
        hasExpiringSoonEvidence: false,
        itemId: 'item-access-review',
        label: 'Collect access review evidence',
        lastReviewedAt: null,
        owner: null,
        operatorNotes: null,
        required: true,
        reviewArtifact: null,
        suggestedEvidenceTypes: ['link', 'file'],
        verificationMethod: 'Review uploaded report',
      },
    ],
    scopeId: 'provider',
    scopeType: 'provider_global',
    ...overrides,
  };
}

function buildPolicySummary(overrides?: Partial<Record<string, unknown>>) {
  return {
    contentHash: 'policy-hash-1',
    lastReviewedAt: Date.parse('2026-03-18T08:00:00.000Z'),
    linkedAnnualReviewTask: {
      id: 'task-policy-1',
      status: 'ready',
      title: 'Access Control Policy reviewed',
    },
    mappedControlCount: 3,
    mappedControlCountsBySupport: {
      complete: 2,
      missing: 0,
      partial: 1,
    },
    nextReviewAt: Date.parse('2027-03-18T08:00:00.000Z'),
    owner: 'Security team',
    policyId: 'access-control',
    scopeId: 'provider',
    scopeType: 'provider_global',
    sourcePath: 'docs/security-policies/access-control-policy.md',
    summary: 'Defines provider access requirements.',
    support: 'partial',
    title: 'Access Control Policy',
    ...overrides,
  };
}

function buildPolicyDetail(overrides?: Partial<Record<string, unknown>>) {
  return {
    contentHash: 'policy-hash-1',
    lastReviewedAt: Date.parse('2026-03-18T08:00:00.000Z'),
    linkedAnnualReviewTask: {
      id: 'task-policy-1',
      status: 'ready',
      title: 'Access Control Policy reviewed',
    },
    mappedControls: [
      {
        familyId: 'AC',
        familyTitle: 'Access Control',
        implementationSummary: 'Role-based access is enforced.',
        internalControlId: 'CTRL-AC-002',
        isPrimary: true,
        nist80053Id: 'AC-2',
        responsibility: 'platform',
        support: 'complete',
        title: 'Account Management',
      },
    ],
    nextReviewAt: Date.parse('2027-03-18T08:00:00.000Z'),
    owner: 'Security team',
    policyId: 'access-control',
    scopeId: 'provider',
    scopeType: 'provider_global',
    sourcePath: 'docs/security-policies/access-control-policy.md',
    sourceMarkdown:
      '# Access Control Policy\n\n## Purpose\n\nDefines provider access requirements.\n',
    summary: 'Defines provider access requirements.',
    support: 'partial',
    title: 'Access Control Policy',
    ...overrides,
  };
}

function buildEvidenceReport(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'report-1',
    reportKind: 'security_posture',
    createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
    scopeId: 'provider',
    scopeType: 'provider_global',
    reviewStatus: 'pending',
    contentHash: 'hash-123',
    latestExport: null,
    generatedByUserId: 'admin-user',
    customerSummary: null,
    internalNotes: null,
    reviewedAt: null,
    reviewedByUserId: null,
    ...overrides,
  };
}

function buildEvidenceReportDetail(overrides?: Partial<Record<string, unknown>>) {
  return {
    contentHash: 'hash-123',
    contentJson: '{"status":"persisted"}',
    createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
    latestExport: {
      exportHash: 'export-hash-1',
      exportedAt: Date.parse('2026-03-18T09:00:00.000Z'),
      exportedByUserId: 'admin-user',
      id: 'artifact-1',
      integritySummary: {
        checkedAt: '2026-03-18T08:59:00.000Z',
        failureCount: 0,
        verified: true,
      },
      manifestHash: 'manifest-hash-1',
      manifestJson: '{"manifest":"ok"}',
      schemaVersion: 'audit-evidence-v1',
    },
    generatedByUserId: 'admin-user',
    id: 'report-1',
    linkedTasks: [
      {
        controlLinks: [
          {
            controlTitle: 'Account Management',
            internalControlId: 'ac-1',
            itemId: 'item-access-review',
            itemLabel: 'Collect access review evidence',
            nist80053Id: 'AC-2',
          },
        ],
        reviewRunId: 'review-run-1',
        reviewRunKind: 'annual',
        reviewRunStatus: 'ready',
        reviewRunTitle: 'Annual Security Review 2026',
        taskId: 'review-task-1',
        taskStatus: 'ready',
        taskTitle: 'Security posture reviewed',
      },
    ],
    organizationId: 'org-1',
    scopeId: 'provider',
    scopeType: 'provider_global',
    reportKind: 'security_posture',
    customerSummary: null,
    internalNotes: null,
    reviewStatus: 'pending',
    reviewedAt: null,
    reviewedByDisplay: null,
    ...overrides,
  };
}

function buildSecurityFinding(overrides?: Partial<Record<string, unknown>>) {
  return {
    customerSummary: null,
    description: 'Audit integrity failures require provider follow-up.',
    disposition: 'pending_review',
    findingKey: 'audit_integrity_failures',
    findingType: 'audit_integrity_failures',
    firstObservedAt: Date.parse('2026-03-18T08:00:00.000Z'),
    internalNotes: null,
    lastObservedAt: Date.parse('2026-03-18T08:00:00.000Z'),
    latestLinkedReviewRun: null,
    relatedControls: [
      {
        internalControlId: 'CTRL-AU-006',
        itemId: 'provider-review-procedure',
        itemLabel: 'Provider review procedure',
        nist80053Id: 'AU-6',
        title: 'Audit Review Procedure',
      },
    ],
    scopeId: 'provider',
    scopeType: 'provider_global',
    reviewedAt: null,
    reviewedByDisplay: null,
    severity: 'critical',
    sourceLabel: 'Audit log integrity verification',
    sourceRecordId: 'audit-1',
    sourceType: 'audit_log',
    status: 'open',
    title: 'Audit integrity monitoring',
    ...overrides,
  };
}

function buildReviewRunSummary(overrides?: Partial<Record<string, unknown>>) {
  return {
    createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
    finalizedAt: null,
    id: 'review-run-1',
    kind: 'annual',
    scopeId: 'provider',
    scopeType: 'provider_global',
    status: 'ready',
    taskCounts: {
      blocked: 0,
      completed: 2,
      exception: 0,
      ready: 3,
      total: 5,
    },
    title: 'Annual Security Review 2026',
    triggerType: null,
    year: 2026,
    ...overrides,
  };
}

function buildReviewRunDetail(overrides?: Partial<Record<string, unknown>>) {
  return {
    createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
    finalReportId: null,
    finalizedAt: null,
    id: 'review-run-1',
    kind: 'annual',
    scopeId: 'provider',
    scopeType: 'provider_global',
    sourceRecordId: null,
    sourceRecordType: null,
    status: 'ready',
    tasks: [
      {
        allowException: true,
        controlLinks: [
          {
            controlTitle: 'Audit Review Procedure',
            internalControlId: 'CTRL-AU-006',
            itemId: 'provider-review-procedure',
            itemLabel: 'Provider review procedure',
            nist80053Id: 'AU-6',
          },
        ],
        description: 'Review the audit review procedure and attest that it remains current.',
        evidenceLinks: [],
        freshnessWindowDays: 365,
        id: 'review-task-1',
        latestAttestation: null,
        latestNote: null,
        policy: null,
        policyControls: [],
        required: true,
        satisfiedAt: null,
        satisfiedThroughAt: null,
        status: 'ready',
        taskType: 'attestation',
        templateKey: 'annual:attest:audit-review-procedure',
        title: 'Audit review procedure reviewed',
      },
      {
        allowException: true,
        controlLinks: [
          {
            controlTitle: 'Assessment Planning',
            internalControlId: 'CTRL-CA-002',
            itemId: 'provider-assessment-plan-documented',
            itemLabel: 'Provider assessment plan documented',
            nist80053Id: 'CA-2',
          },
        ],
        description: 'Attach or link the current control assessment plan and confirm its version.',
        evidenceLinks: [],
        freshnessWindowDays: 365,
        id: 'review-task-2',
        latestAttestation: null,
        latestNote: null,
        policy: null,
        policyControls: [],
        required: true,
        satisfiedAt: null,
        satisfiedThroughAt: null,
        status: 'ready',
        taskType: 'document_upload',
        templateKey: 'annual:document:assessment-plan',
        title: 'Control assessment plan linked',
      },
    ],
    title: 'Annual Security Review 2026',
    triggerType: null,
    year: 2026,
    ...overrides,
  };
}

function buildVendorWorkspace(overrides?: Partial<Record<string, unknown>>) {
  return {
    allowedDataClasses: ['metadata'],
    allowedEnvironments: ['production'],
    approvalEnvVar: null,
    approved: true,
    approvedByDefault: true,
    linkedAnnualReviewTask: null,
    linkedEntities: [],
    linkedFollowUpRunId: null,
    lastReviewedAt: null,
    nextReviewAt: null,
    owner: 'Platform Security',
    relatedControls: [
      {
        internalControlId: 'CTRL-SA-009',
        itemId: 'external-services-inventory',
        nist80053Id: 'SA-9',
        title: 'External Services',
      },
    ],
    reviewStatus: 'overdue',
    scopeId: 'provider',
    scopeType: 'provider_global',
    summary: 'SOC 2 reviewed.',
    title: 'Sentry',
    vendor: 'sentry',
    ...overrides,
  };
}

function buildFindingsBoard(args: { findings?: unknown[] }) {
  const findings = args.findings ?? [buildSecurityFinding()];
  return {
    findings,
    summary: {
      openCount: (findings as Array<{ status: string }>).filter(
        (finding) => finding.status === 'open',
      ).length,
      reviewPendingCount: (findings as Array<{ disposition: string }>).filter(
        (finding) => finding.disposition === 'pending_review',
      ).length,
      totalCount: findings.length,
    },
    scopeId: 'provider',
    scopeType: 'provider_global',
  };
}

function buildReportsBoard(args: { auditReadiness?: unknown; evidenceReports?: unknown[] }) {
  return {
    auditReadiness: args.auditReadiness ?? buildAuditReadiness(),
    evidenceReports: args.evidenceReports ?? [],
    scopeId: 'provider',
    scopeType: 'provider_global',
  };
}

function buildWorkspaceOverview(args?: {
  auditReadiness?: unknown;
  currentAnnualRun?: unknown;
  findings?: unknown[];
  controls?: unknown[];
  summary?: unknown;
  vendorWorkspaces?: unknown[];
}) {
  const findings = (args?.findings as
    | Array<{ disposition: string; status: string }>
    | undefined) ?? [buildSecurityFinding()];
  const controls = (args?.controls as
    | Array<{
        support: 'missing' | 'partial' | 'complete';
        responsibility: 'customer' | 'platform' | 'shared-responsibility';
      }>
    | undefined) ?? [buildControl()];
  const vendorWorkspaces =
    (args?.vendorWorkspaces as Array<{ approved: boolean; reviewStatus: string }> | undefined) ??
    [];

  return {
    auditReadiness: args?.auditReadiness ?? buildAuditReadiness(),
    controlSummary: {
      bySupport: {
        missing: controls.filter((control) => control.support === 'missing').length,
        partial: controls.filter((control) => control.support === 'partial').length,
        complete: controls.filter((control) => control.support === 'complete').length,
      },
      byResponsibility: {
        customer: controls.filter((control) => control.responsibility === 'customer').length,
        platform: controls.filter((control) => control.responsibility === 'platform').length,
        sharedResponsibility: controls.filter(
          (control) => control.responsibility === 'shared-responsibility',
        ).length,
      },
      totalControls: controls.length,
    },
    currentAnnualReviewRun: args?.currentAnnualRun ?? null,
    findingSummary: {
      openCount: findings.filter((finding) => finding.status === 'open').length,
      totalCount: findings.length,
      undispositionedCount: findings.filter((finding) => finding.disposition !== 'resolved').length,
    },
    postureSummary: args?.summary ?? buildSummary(),
    queues: {
      blockedReviewTasks: 0,
      missingSupportControls: controls.filter((control) => control.support === 'missing').length,
      pendingVendorReviews: vendorWorkspaces.filter((vendor) => vendor.reviewStatus === 'overdue')
        .length,
      undispositionedFindings: findings.filter((finding) => finding.disposition !== 'resolved')
        .length,
    },
    scopeId: 'provider',
    scopeType: 'provider_global',
    vendorSummary: {
      approvedCount: vendorWorkspaces.filter((vendor) => vendor.approved).length,
      dueSoonCount: vendorWorkspaces.filter((vendor) => vendor.reviewStatus === 'due_soon').length,
      overdueCount: vendorWorkspaces.filter((vendor) => vendor.reviewStatus === 'overdue').length,
      totalCount: vendorWorkspaces.length,
    },
  };
}

function renderRoute() {
  const search = useSearchMock() as SearchState;
  const activeTab = search.tab;

  return render(
    <AdminSecurityPageShell activeTab={activeTab}>
      {activeTab === 'overview' ? <AdminSecurityOverviewRoute /> : null}
      {activeTab === 'controls' ? (
        <AdminSecurityControlsRoute
          search={{
            family: search.family,
            responsibility: search.responsibility,
            search: search.search,
            selectedControl: search.selectedControl,
            sortBy: search.sortBy,
            sortOrder: search.sortOrder,
            support: search.support,
          }}
        />
      ) : null}
      {activeTab === 'policies' ? (
        <AdminSecurityPoliciesRoute
          search={{
            policySearch: search.policySearch ?? '',
            policySortBy: search.policySortBy ?? 'title',
            policySortOrder: search.policySortOrder ?? 'asc',
            policySupport: search.policySupport ?? 'all',
            selectedPolicy: search.selectedPolicy,
          }}
        />
      ) : null}
      {activeTab === 'vendors' ? (
        <AdminSecurityVendorsRoute
          search={{
            selectedVendor: search.selectedVendor,
          }}
        />
      ) : null}
      {activeTab === 'findings' ? (
        <AdminSecurityFindingsRoute
          search={{
            findingDisposition: search.findingDisposition ?? 'all',
            findingSearch: search.findingSearch ?? '',
            findingSeverity: search.findingSeverity ?? 'all',
            findingStatus: search.findingStatus ?? 'all',
            selectedFinding: search.selectedFinding,
          }}
        />
      ) : null}
      {activeTab === 'reports' ? (
        <AdminSecurityReportsRoute
          search={{
            reportKind: search.reportKind ?? 'all',
            reportReviewStatus: search.reportReviewStatus ?? 'all',
            reportSearch: search.reportSearch ?? '',
            selectedReport: search.selectedReport,
          }}
        />
      ) : null}
      {activeTab === 'reviews' ? (
        <AdminSecurityReviewsRoute
          search={{
            selectedReviewRun: search.selectedReviewRun,
          }}
        />
      ) : null}
    </AdminSecurityPageShell>,
  );
}

function mockSecurityQueries(args: {
  auditReadiness?: unknown;
  controls?: unknown[];
  currentAnnualRun?: unknown;
  evidenceReports?: unknown[];
  reportDetail?: unknown;
  findings?: unknown[];
  policies?: unknown[];
  policyDetail?: unknown;
  reviewDetail?: unknown;
  summary?: unknown;
  triggeredReviewRuns?: unknown[];
  vendorWorkspaces?: unknown[];
}) {
  useQueryMock.mockImplementation((query: unknown, queryArgs?: unknown) => {
    if (queryArgs === 'skip') {
      return undefined;
    }

    const functionName = getFunctionName(query as Parameters<typeof getFunctionName>[0]);

    switch (functionName) {
      case 'securityPosture:getSecurityWorkspaceOverview':
        return buildWorkspaceOverview(args);
      case 'securityWorkspace:listSecurityControlWorkspaces':
        return args.controls ?? [buildControl()];
      case 'securityWorkspace:getSecurityControlWorkspaceDetail': {
        const controls = (args.controls ?? [buildControl()]) as Array<Record<string, unknown>>;
        const requestedControlId =
          queryArgs && typeof queryArgs === 'object' && 'internalControlId' in queryArgs
            ? queryArgs.internalControlId
            : undefined;
        return (
          controls.find((control) => control.internalControlId === requestedControlId) ??
          controls[0] ??
          null
        );
      }
      case 'securityPolicies:listSecurityPolicies':
        return args.policies ?? [buildPolicySummary()];
      case 'securityPolicies:getSecurityPolicyDetail':
        return args.policyDetail ?? buildPolicyDetail();
      case 'securityPosture:getSecurityFindingsBoard':
        return buildFindingsBoard(args);
      case 'securityPosture:getSecurityReportsBoard':
        return buildReportsBoard(args);
      case 'securityReports:getEvidenceReportDetail':
        return args.reportDetail ?? null;
      case 'securityReports:listSecurityVendors':
        return args.vendorWorkspaces ?? [buildVendorWorkspace()];
      case 'securityReviews:getCurrentAnnualReviewRun':
        return args.currentAnnualRun ?? null;
      case 'securityReviews:getReviewRunDetail':
        return args.reviewDetail ?? null;
      case 'securityReviews:listTriggeredReviewRuns':
        return args.triggeredReviewRuns ?? [];
      default:
        return undefined;
    }
  });
}

function mockSecurityActions(actions: Partial<Record<string, (...args: never[]) => unknown>>) {
  useActionMock.mockImplementation((action: unknown) => {
    const functionName = getFunctionName(action as Parameters<typeof getFunctionName>[0]);
    return actions[functionName] ?? vi.fn();
  });
}

function mockSecurityMutations(mutations: Partial<Record<string, (...args: never[]) => unknown>>) {
  useMutationMock.mockImplementation((mutation: unknown) => {
    const functionName = getFunctionName(mutation as Parameters<typeof getFunctionName>[0]);
    return mutations[functionName] ?? vi.fn();
  });
}

describe('Admin security route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    navigateMock.mockResolvedValue(undefined);
    useSearchMock.mockReturnValue(defaultSearch);
    useActionMock.mockReset();
    useMutationMock.mockReset();
    useQueryMock.mockReset();
    useConvexMock.mockReset();
    useConvexMock.mockReturnValue({
      query: vi.fn(),
    });
    useLocationMock.mockReturnValue({ pathname: '/app/admin/security/reports' });
  });

  it('generates evidence reports and submits trimmed review notes', async () => {
    const user = userEvent.setup();
    const generateEvidenceReportMock = vi.fn().mockResolvedValue({
      id: 'report-generated',
      report: '{"status":"ok"}',
    });
    const exportEvidenceReportMock = vi.fn().mockResolvedValue({
      report: '{"status":"exported"}',
    });
    const reviewEvidenceReportMock = vi.fn().mockResolvedValue(undefined);

    mockSecurityQueries({
      controls: [buildControl()],
      evidenceReports: [buildEvidenceReport()],
      auditReadiness: buildAuditReadiness(),
    });
    mockSecurityActions({
      'securityReports:generateEvidenceReport': generateEvidenceReportMock,
      'securityReports:exportEvidenceReport': exportEvidenceReportMock,
    });
    mockSecurityMutations({
      'securityReports:reviewEvidenceReport': reviewEvidenceReportMock,
    });

    renderRoute();

    await user.click(screen.getByRole('button', { name: /generate evidence report/i }));

    await waitFor(() => {
      expect(generateEvidenceReportMock).toHaveBeenCalledWith({
        reportKind: 'security_posture',
      });
    });
    expect(screen.getAllByText('{"status":"ok"}').length).toBeGreaterThan(0);

    await user.click(screen.getAllByText(/security_posture/i)[0]!);
    const reportInternalNotesField = screen.getByPlaceholderText('Add reviewer-only notes');
    await user.clear(reportInternalNotesField);
    await user.type(reportInternalNotesField, '  needs deeper review  ');
    await user.click(screen.getAllByRole('button', { name: /needs follow-up/i }).at(-1)!);

    await waitFor(() => {
      expect(reviewEvidenceReportMock).toHaveBeenCalledWith({
        id: 'report-1',
        internalNotes: 'needs deeper review',
        reviewStatus: 'needs_follow_up',
      });
    });

    await user.click(screen.getAllByRole('button', { name: /export bundle/i }).at(-1)!);

    await waitFor(() => {
      expect(exportEvidenceReportMock).toHaveBeenCalledWith({ id: 'report-1' });
    });
    expect(screen.getAllByText('{"status":"exported"}').length).toBeGreaterThan(0);
  });

  it('does not offer approval for seeded evidence', async () => {
    const user = userEvent.setup();
    const seededEvidence = buildControlEvidence({
      id: 'ac-2:seed:item-access-review:0',
      title: 'Seeded access review instructions',
    });

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'controls',
      selectedControl: 'ac-1',
    });
    mockSecurityQueries({
      auditReadiness: buildAuditReadiness(),
      controls: [
        buildControl({
          platformChecklist: [
            {
              completedAt: null,
              description: 'Collect access review evidence.',
              evidence: [seededEvidence],
              hasExpiringSoonEvidence: false,
              itemId: 'item-access-review',
              label: 'Collect access review evidence',
              lastReviewedAt: null,
              owner: null,
              operatorNotes: null,
              required: true,
              reviewArtifact: null,
              support: 'partial',
              suggestedEvidenceTypes: ['link', 'file'],
              verificationMethod: 'Review uploaded report',
            },
          ],
        }),
      ],
      evidenceReports: [],
    });
    mockSecurityActions({});
    mockSecurityMutations({});

    renderRoute();

    await user.click(screen.getByRole('button', { name: /collect access review evidence/i }));
    await user.click(
      screen.getByRole('button', {
        name: /evidence actions for seeded access review instructions/i,
      }),
    );

    expect(screen.queryByRole('menuitem', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /archive/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /renew/i })).toBeInTheDocument();
  });

  it('renders the policies tab and opens policy detail', async () => {
    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'policies',
      selectedPolicy: 'access-control',
    });
    mockSecurityQueries({
      policies: [buildPolicySummary()],
      policyDetail: buildPolicyDetail(),
    });
    mockSecurityActions({
      'securityPolicies:syncSecurityPoliciesFromSeed': vi.fn().mockResolvedValue(undefined),
    });

    renderRoute();

    expect(
      screen.getByText(
        'Governance layer backed by repo markdown, mapped controls, and annual policy attestations.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Access Control Policy').length).toBeGreaterThan(0);

    expect(
      screen.getByText('Policy support is derived only from these mapped control support states.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view policy/i })).toBeInTheDocument();
  });

  it('shows and downloads the bundled policy markdown source as pdf', async () => {
    const user = userEvent.setup();
    const createObjectURLMock = vi.fn(() => 'blob:policy-source');
    const revokeObjectURLMock = vi.fn();
    const clickMock = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['pdf-bytes'], { type: 'application/pdf' }), {
        headers: {
          'Content-Disposition': 'attachment; filename="access-control-policy-2026-03-23.pdf"',
        },
        status: 200,
      }),
    );
    const originalFetch = global.fetch;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement');

    global.fetch = fetchMock;

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURLMock,
    });
    createElementSpy.mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        Object.defineProperty(element, 'click', {
          configurable: true,
          value: clickMock,
        });
      }
      return element;
    });

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'policies',
      selectedPolicy: 'access-control',
    });
    mockSecurityQueries({
      policies: [buildPolicySummary()],
      policyDetail: buildPolicyDetail(),
    });
    mockSecurityActions({});

    renderRoute();

    await user.click(screen.getByRole('button', { name: /view policy/i }));
    await user.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];

    expect(requestUrl).toBe('/api/security-policy-pdf');
    expect(requestInit).toMatchObject({
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      fileName: expect.stringMatching(/^access-control-policy-\d{4}-\d{2}-\d{2}\.pdf$/),
      markdownContent:
        '# Access Control Policy\n\n## Purpose\n\nDefines provider access requirements.\n',
      sourcePath: 'docs/security-policies/access-control-policy.md',
      title: 'Access Control Policy',
    });
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(clickMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:policy-source');

    const markdownDialog = screen.getByRole('dialog');
    expect(within(markdownDialog).getAllByText(/Access Control Policy/).length).toBeGreaterThan(0);
    expect(
      within(markdownDialog).getByText(/Defines provider access requirements\./),
    ).toBeInTheDocument();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    createElementSpy.mockRestore();
    global.fetch = originalFetch;
  });

  it('approves non-seeded evidence from the evidence actions menu', async () => {
    const user = userEvent.setup();
    const reviewControlEvidenceMock = vi.fn().mockResolvedValue(undefined);

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'controls',
      selectedControl: 'ac-1',
    });
    mockSecurityQueries({
      controls: [
        buildControl({
          platformChecklist: [
            {
              completedAt: null,
              description: 'Collect access review evidence.',
              evidence: [buildControlEvidence()],
              hasExpiringSoonEvidence: false,
              itemId: 'item-access-review',
              label: 'Collect access review evidence',
              lastReviewedAt: null,
              owner: null,
              operatorNotes: null,
              required: true,
              reviewArtifact: null,
              support: 'partial',
              suggestedEvidenceTypes: ['link', 'file'],
              verificationMethod: 'Review uploaded report',
            },
          ],
        }),
      ],
      evidenceReports: [],
    });
    mockSecurityActions({});
    mockSecurityMutations({
      'securityWorkspace:reviewSecurityControlEvidence': reviewControlEvidenceMock,
    });

    renderRoute();

    await user.click(screen.getByRole('button', { name: /collect access review evidence/i }));
    await user.click(
      screen.getByRole('button', { name: /evidence actions for access review packet/i }),
    );
    await user.click(screen.getByRole('menuitem', { name: /approve/i }));

    await waitFor(() => {
      expect(reviewControlEvidenceMock).toHaveBeenCalledWith({
        evidenceId: 'evidence-1',
        reviewStatus: 'reviewed',
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Evidence marked as reviewed.', 'success');
  });

  it('surfaces audit readiness signals and manifest hashes in the reports tab', () => {
    mockSecurityQueries({
      auditReadiness: buildAuditReadiness({
        metadataGaps: [
          {
            createdAt: Date.parse('2026-03-18T10:00:00.000Z'),
            eventType: 'organization_policy_updated',
            id: 'gap-1',
            resourceId: 'org-1',
          },
        ],
        recentDeniedActions: [
          {
            createdAt: Date.parse('2026-03-18T11:00:00.000Z'),
            eventType: 'authorization_denied',
            id: 'deny-1',
            metadata: '{"permission":"viewAudit","reason":"forbidden"}',
            organizationId: 'org-1',
          },
        ],
      }),
      controls: [buildControl()],
      evidenceReports: [
        buildEvidenceReport({
          latestExport: {
            exportHash: 'export-hash-1',
            exportedAt: Date.parse('2026-03-18T09:00:00.000Z'),
            exportedByUserId: 'admin-user',
            id: 'artifact-1',
            manifestHash: 'manifest-hash-1',
          },
          reportKind: 'audit_readiness',
        }),
      ],
    });
    mockSecurityActions({});
    mockSecurityMutations({});

    renderRoute();

    expect(screen.getByText('Audit Readiness Signals')).toBeInTheDocument();
    expect(screen.getByText('Recent Export Artifacts')).toBeInTheDocument();
    expect(screen.getAllByText(/manifest-hash-1/).length).toBeGreaterThan(0);
    expect(screen.getByText('Metadata gaps')).toBeInTheDocument();
    expect(screen.getByText('Authorization denials')).toBeInTheDocument();
  });

  it('loads persisted report detail and control deep-links from the reports route', async () => {
    const user = userEvent.setup();

    mockSecurityQueries({
      auditReadiness: buildAuditReadiness(),
      controls: [buildControl()],
      evidenceReports: [buildEvidenceReport()],
      reportDetail: buildEvidenceReportDetail(),
    });
    mockSecurityActions({});
    mockSecurityMutations({});

    const view = renderRoute();

    await user.click(screen.getAllByRole('button', { name: /view details/i }).at(-1)!);

    expect(navigateMock).toHaveBeenCalledWith({
      search: expect.objectContaining({
        selectedReport: 'report-1',
      }),
      to: '/app/admin/security/reports',
    });

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      selectedReport: 'report-1',
    });
    view.rerender(
      <AdminSecurityPageShell activeTab="reports">
        <AdminSecurityReportsRoute
          search={{
            reportKind: 'all',
            reportReviewStatus: 'all',
            reportSearch: '',
            selectedReport: (useSearchMock() as SearchState).selectedReport,
          }}
        />
      </AdminSecurityPageShell>,
    );

    expect(screen.getByText('Linked review tasks')).toBeInTheDocument();
    expect(screen.getByText('{"status":"persisted"}')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: /ac-2 · collect access review evidence/i,
      }),
    );

    expect(navigateMock).toHaveBeenCalledWith({
      search: expect.objectContaining({
        selectedControl: 'ac-1',
      }),
      to: '/app/admin/security/controls',
    });
  });

  it('retains provider disposition and notes for security findings', async () => {
    const user = userEvent.setup();
    const reviewSecurityFindingMock = vi.fn().mockResolvedValue(undefined);

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'findings',
    });

    mockSecurityQueries({
      controls: [buildControl()],
      evidenceReports: [buildEvidenceReport()],
      findings: [buildSecurityFinding()],
      auditReadiness: buildAuditReadiness(),
    });
    mockSecurityActions({});
    mockSecurityMutations({
      'securityWorkspace:reviewSecurityFinding': reviewSecurityFindingMock,
    });

    renderRoute();

    await user.click(screen.getByText('Audit integrity monitoring'));
    await user.type(screen.getByPlaceholderText('Add reviewer-only notes'), 'triage in progress');
    await user.click(
      screen.getByRole('combobox', { name: /disposition for audit integrity monitoring/i }),
    );
    await user.click(await screen.findByText('Investigating'));
    await user.click(screen.getAllByRole('button', { name: /save changes/i }).at(-1)!);

    await waitFor(() => {
      expect(reviewSecurityFindingMock).toHaveBeenCalledWith({
        disposition: 'investigating',
        findingKey: 'audit_integrity_failures',
        internalNotes: 'triage in progress',
      });
    });
  });

  it('opens finding follow-up reviews directly from the findings route', async () => {
    const user = userEvent.setup();
    const openSecurityFindingFollowUpMock = vi.fn().mockResolvedValue(
      buildReviewRunSummary({
        id: 'triggered-review-1',
        kind: 'triggered',
        title: 'Audit integrity monitoring follow-up',
        triggerType: 'security_finding_follow_up',
      }),
    );

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'findings',
    });

    mockSecurityQueries({
      auditReadiness: buildAuditReadiness(),
      controls: [buildControl()],
      evidenceReports: [buildEvidenceReport()],
      findings: [buildSecurityFinding()],
    });
    mockSecurityActions({});
    mockSecurityMutations({
      'securityWorkspace:openSecurityFindingFollowUp': openSecurityFindingFollowUpMock,
    });

    renderRoute();

    await user.click(screen.getByText('Audit integrity monitoring'));
    await user.type(
      screen.getByPlaceholderText('Add reviewer-only notes'),
      'escalate to remediation',
    );
    await user.click(screen.getByRole('button', { name: /open follow-up/i }));

    await waitFor(() => {
      expect(openSecurityFindingFollowUpMock).toHaveBeenCalledWith({
        findingKey: 'audit_integrity_failures',
        note: 'escalate to remediation',
      });
    });

    expect(navigateMock).toHaveBeenCalledWith({
      search: {
        selectedReviewRun: 'triggered-review-1',
      },
      to: '/app/admin/security/reviews',
    });
  });

  it('lets admins record partial evidence sufficiency from the control workspace', async () => {
    const user = userEvent.setup();
    const addEvidenceNoteMock = vi.fn().mockResolvedValue(undefined);

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'controls',
      selectedControl: 'ac-1',
    });
    mockSecurityQueries({
      auditReadiness: buildAuditReadiness(),
      controls: [buildControl()],
      evidenceReports: [],
    });
    mockSecurityActions({});
    mockSecurityMutations({
      'securityWorkspace:addSecurityControlEvidenceNote': addEvidenceNoteMock,
    });

    renderRoute();

    await user.click(screen.getByRole('button', { name: /collect access review evidence/i }));
    await user.click(screen.getByRole('button', { name: /add evidence/i }));
    await user.click(screen.getByRole('button', { name: 'Note' }));
    await user.type(screen.getByPlaceholderText('Note title'), 'Quarterly review summary');
    await user.type(
      screen.getByPlaceholderText('Paste reviewer note or summary'),
      'Pending manager sign-off.',
    );

    await user.click(screen.getByRole('combobox', { name: /source/i }));
    await user.click(await screen.findByText('Internal review'));
    await user.click(screen.getByRole('combobox', { name: /sufficiency/i }));
    await user.click(await screen.findByRole('option', { name: 'Partial' }));
    await user.click(screen.getByRole('button', { name: /attach note/i }));

    await waitFor(() => {
      expect(addEvidenceNoteMock).toHaveBeenCalledWith({
        description: 'Pending manager sign-off.',
        evidenceDate: expect.any(Number),
        internalControlId: 'ac-1',
        itemId: 'item-access-review',
        reviewDueIntervalMonths: 12,
        source: 'internal_review',
        sufficiency: 'partial',
        title: 'Quarterly review summary',
      });
    });
  });

  it('loads annual review actions in the reviews tab', async () => {
    const user = userEvent.setup();
    const refreshReviewRunAutomationMock = vi.fn().mockResolvedValue(buildReviewRunDetail());
    const finalizeReviewRunMock = vi.fn().mockResolvedValue(buildReviewRunDetail());
    const createTriggeredReviewRunMock = vi.fn().mockResolvedValue(
      buildReviewRunSummary({
        id: 'triggered-review-1',
        kind: 'triggered',
        title: 'Manual follow-up',
      }),
    );
    const attestReviewTaskMock = vi.fn().mockResolvedValue(undefined);

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'reviews',
    });
    mockSecurityQueries({
      currentAnnualRun: buildReviewRunSummary(),
      reviewDetail: buildReviewRunDetail(),
      triggeredReviewRuns: [],
    });
    mockSecurityActions({
      'securityReviews:refreshReviewRunAutomation': refreshReviewRunAutomationMock,
      'securityReviews:finalizeReviewRun': finalizeReviewRunMock,
    });
    mockSecurityMutations({
      'securityReviews:createTriggeredReviewRun': createTriggeredReviewRunMock,
      'securityReviews:attestReviewTask': attestReviewTaskMock,
    });

    renderRoute();

    await waitFor(() => {
      expect(refreshReviewRunAutomationMock).toHaveBeenCalledWith({
        reviewRunId: 'review-run-1',
      });
    });

    expect(screen.getByText('Current Annual Review')).toBeInTheDocument();
    expect(screen.getByText('Annual Security Review 2026')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Details' })[0]!);

    await user.type(screen.getAllByPlaceholderText('Task note')[0]!, 'reviewed this procedure');
    await user.click(screen.getByRole('button', { name: /review and attest/i }));

    await waitFor(() => {
      expect(attestReviewTaskMock).toHaveBeenCalledWith({
        documentLabel: undefined,
        documentUrl: undefined,
        documentVersion: undefined,
        note: 'reviewed this procedure',
        reviewTaskId: 'review-task-1',
      });
    });

    await user.click(screen.getByRole('button', { name: /au-6 · provider review procedure/i }));

    expect(navigateMock).toHaveBeenCalledWith({
      search: expect.objectContaining({
        selectedControl: 'CTRL-AU-006',
      }),
      to: '/app/admin/security/controls',
    });

    await user.type(screen.getByPlaceholderText('Triggered review title'), 'Manual follow-up');
    await user.click(screen.getByRole('button', { name: /create run/i }));

    await waitFor(() => {
      expect(createTriggeredReviewRunMock).toHaveBeenCalledWith({
        title: 'Manual follow-up',
        triggerType: 'manual_follow_up',
      });
    });
  });

  it('bootstraps the annual review exactly once when the reviews tab has no current run', async () => {
    const ensureCurrentAnnualReviewRunMock = vi.fn().mockResolvedValue(buildReviewRunSummary());
    const refreshReviewRunAutomationMock = vi.fn().mockResolvedValue(buildReviewRunDetail());

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'reviews',
    });
    mockSecurityQueries({
      currentAnnualRun: null,
      reviewDetail: null,
      triggeredReviewRuns: [],
    });
    mockSecurityActions({
      'securityReviews:refreshReviewRunAutomation': refreshReviewRunAutomationMock,
    });
    mockSecurityMutations({
      'securityReviews:ensureCurrentAnnualReviewRun': ensureCurrentAnnualReviewRunMock,
    });

    renderRoute();

    await waitFor(() => {
      expect(ensureCurrentAnnualReviewRunMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(refreshReviewRunAutomationMock).toHaveBeenCalledWith({
        reviewRunId: 'review-run-1',
      });
    });
  });

  it('shows persisted vendor review overlays and saves follow-up decisions', async () => {
    const user = userEvent.setup();
    const reviewSecurityVendorMock = vi.fn().mockResolvedValue(buildVendorWorkspace());

    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'vendors',
    });
    mockSecurityQueries({
      auditReadiness: buildAuditReadiness(),
      controls: [buildControl()],
      vendorWorkspaces: [buildVendorWorkspace()],
    });
    mockSecurityActions({});
    mockSecurityMutations({
      'securityReports:reviewSecurityVendor': reviewSecurityVendorMock,
    });

    renderRoute();

    await user.click(screen.getByText('Sentry'));
    const ownerField = screen.getByPlaceholderText('Assign a vendor owner');
    await user.clear(ownerField);
    await user.type(ownerField, 'Infra team');
    const vendorSummaryField = screen.getByPlaceholderText(
      'Summarize the vendor posture and review context',
    );
    await user.clear(vendorSummaryField);
    await user.type(vendorSummaryField, 'Need updated DPA.');
    await user.click(screen.getAllByRole('button', { name: /save changes/i }).at(-1)!);

    await waitFor(() => {
      expect(reviewSecurityVendorMock).toHaveBeenCalledWith({
        owner: 'Infra team',
        summary: 'Need updated DPA.',
        vendorKey: 'sentry',
      });
    });
  });

  it('keeps vendor editing out of the reports route', () => {
    useSearchMock.mockReturnValue({
      ...defaultSearch,
      tab: 'reports',
    });
    mockSecurityQueries({
      vendorWorkspaces: [buildVendorWorkspace()],
    });

    renderRoute();

    expect(screen.queryByPlaceholderText('Vendor summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/owner/i)).not.toBeInTheDocument();
  });
});
