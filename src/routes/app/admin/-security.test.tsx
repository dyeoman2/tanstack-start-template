import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSecurityRoute } from './security';

const { useSearchMock, navigateMock, useQueryMock, useActionMock, useMutationMock, showToastMock } =
  vi.hoisted(() => ({
    useSearchMock: vi.fn(),
    navigateMock: vi.fn(),
    useQueryMock: vi.fn(),
    useActionMock: vi.fn(),
    useMutationMock: vi.fn(),
    showToastMock: vi.fn(),
  }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: useSearchMock,
  }),
  useNavigate: () => navigateMock,
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: (...args: unknown[]) => useActionMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock('~/components/data-table', () => ({
  createSortableHeader: (label: string) => label,
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

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

type SearchState = {
  tab: 'overview' | 'controls' | 'evidence' | 'vendors';
  page: number;
  pageSize: 10 | 20 | 50;
  sortBy: 'control' | 'evidence' | 'responsibility' | 'family';
  sortOrder: 'asc' | 'desc';
  search: string;
  responsibility: 'all' | 'platform' | 'shared-responsibility' | 'customer';
  evidenceReadiness: 'all' | 'ready' | 'partial' | 'missing';
  family: string;
  selectedControl?: string;
};

const defaultSearch: SearchState = {
  tab: 'evidence',
  page: 1,
  pageSize: 10,
  sortBy: 'control',
  sortOrder: 'asc',
  search: '',
  responsibility: 'all',
  evidenceReadiness: 'all',
  family: 'all',
  selectedControl: undefined,
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
      sourceDataset: 'auditLogs',
      status: 'success',
      targetEnvironment: 'test',
      verificationMethod: 'checksum-compare',
    },
    latestRetentionJob: {
      createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
      details: 'ok',
      jobKind: 'audit_export_cleanup',
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
    reviewDueAt: Date.parse('2026-06-01T00:00:00.000Z'),
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
    evidenceReadiness: 'partial',
    hasExpiringSoonEvidence: false,
    lastReviewedAt: null,
    platformChecklist: [
      {
        completedAt: null,
        description: 'Collect access review evidence.',
        evidence: [],
        evidenceSufficiency: 'missing',
        hasExpiringSoonEvidence: false,
        itemId: 'item-access-review',
        label: 'Collect access review evidence',
        lastReviewedAt: null,
        notes: null,
        owner: null,
        required: true,
        status: 'not_started',
        suggestedEvidenceTypes: ['link', 'file'],
        verificationMethod: 'Review uploaded report',
      },
    ],
    ...overrides,
  };
}

function buildEvidenceReport(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'report-1',
    reportKind: 'security_posture',
    createdAt: Date.parse('2026-03-18T08:00:00.000Z'),
    reviewStatus: 'pending',
    contentHash: 'hash-123',
    exportHash: null,
    exportManifestHash: null,
    reviewNotes: null,
    ...overrides,
  };
}

function buildSecurityFinding(overrides?: Partial<Record<string, unknown>>) {
  return {
    description: 'Audit integrity failures require provider follow-up.',
    disposition: 'pending_review',
    findingKey: 'audit_integrity_failures',
    findingType: 'audit_integrity_failures',
    firstObservedAt: Date.parse('2026-03-18T08:00:00.000Z'),
    lastObservedAt: Date.parse('2026-03-18T08:00:00.000Z'),
    reviewNotes: null,
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

function renderRoute() {
  return render(<AdminSecurityRoute />);
}

function mockSecurityQueries(args: {
  auditReadiness?: unknown;
  controls?: unknown[];
  evidenceReports?: unknown[];
  findings?: unknown[];
  summary?: unknown;
}) {
  let queryCallIndex = 0;

  useQueryMock.mockImplementation((_query: unknown, queryArgs?: unknown) => {
    if (queryArgs === 'skip') {
      return undefined;
    }

    const slot = queryCallIndex % 5;
    queryCallIndex += 1;

    switch (slot) {
      case 0:
        return args.summary ?? buildSummary();
      case 1:
        return args.controls ?? [buildControl()];
      case 2:
        return args.evidenceReports ?? [];
      case 3:
        return args.findings ?? [buildSecurityFinding()];
      case 4:
        return args.auditReadiness ?? buildAuditReadiness();
      default:
        return undefined;
    }
  });
}

function mockSecurityActions(slots: Array<(...args: never[]) => unknown>) {
  let actionCallIndex = 0;

  useActionMock.mockImplementation(() => {
    const action = slots[actionCallIndex % slots.length];
    actionCallIndex += 1;
    return action;
  });
}

function mockSecurityMutations(slots: Array<(...args: never[]) => unknown>) {
  let mutationCallIndex = 0;

  useMutationMock.mockImplementation(() => {
    const mutation = slots[mutationCallIndex % slots.length];
    mutationCallIndex += 1;
    return mutation;
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
    mockSecurityActions([
      generateEvidenceReportMock,
      exportEvidenceReportMock,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ]);
    mockSecurityMutations([
      reviewEvidenceReportMock,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ]);

    renderRoute();

    await user.click(screen.getByRole('button', { name: /generate evidence report/i }));

    await waitFor(() => {
      expect(generateEvidenceReportMock).toHaveBeenCalledWith({
        reportKind: 'security_posture',
      });
    });
    expect(screen.getByText('{"status":"ok"}')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Reviewer notes'));
    await user.type(screen.getByPlaceholderText('Reviewer notes'), '  needs deeper review  ');
    await user.click(screen.getByRole('button', { name: /needs follow-up/i }));

    await waitFor(() => {
      expect(reviewEvidenceReportMock).toHaveBeenCalledWith({
        id: 'report-1',
        reviewNotes: 'needs deeper review',
        reviewStatus: 'needs_follow_up',
      });
    });

    await user.click(screen.getByRole('button', { name: /export bundle/i }));

    await waitFor(() => {
      expect(exportEvidenceReportMock).toHaveBeenCalledWith({ id: 'report-1' });
    });
    expect(screen.getByText('{"status":"exported"}')).toBeInTheDocument();
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
              evidenceSufficiency: 'partial',
              hasExpiringSoonEvidence: false,
              itemId: 'item-access-review',
              label: 'Collect access review evidence',
              lastReviewedAt: null,
              notes: null,
              owner: null,
              required: true,
              status: 'in_progress',
              suggestedEvidenceTypes: ['link', 'file'],
              verificationMethod: 'Review uploaded report',
            },
          ],
        }),
      ],
      evidenceReports: [],
    });
    mockSecurityActions([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]);
    mockSecurityMutations([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]);

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
              evidenceSufficiency: 'partial',
              hasExpiringSoonEvidence: false,
              itemId: 'item-access-review',
              label: 'Collect access review evidence',
              lastReviewedAt: null,
              notes: null,
              owner: null,
              required: true,
              status: 'in_progress',
              suggestedEvidenceTypes: ['link', 'file'],
              verificationMethod: 'Review uploaded report',
            },
          ],
        }),
      ],
      evidenceReports: [],
    });
    mockSecurityActions([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]);
    mockSecurityMutations([
      vi.fn(),
      vi.fn(),
      reviewControlEvidenceMock,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ]);

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

  it('surfaces audit readiness signals and manifest hashes in the evidence tab', () => {
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
          exportHash: 'export-hash-1',
          exportManifestHash: 'manifest-hash-1',
          reportKind: 'audit_readiness',
        }),
      ],
    });
    mockSecurityActions([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]);
    mockSecurityMutations([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]);

    renderRoute();

    expect(screen.getByText('Audit Readiness Signals')).toBeInTheDocument();
    expect(screen.getByText('Recent Export Artifacts')).toBeInTheDocument();
    expect(screen.getAllByText(/manifest-hash-1/).length).toBeGreaterThan(0);
    expect(screen.getByText('Metadata gaps')).toBeInTheDocument();
    expect(screen.getByText('Authorization denials')).toBeInTheDocument();
    expect(screen.getByText(/Manifest hash: manifest-hash-1/)).toBeInTheDocument();
  });

  it('retains provider disposition and notes for security findings', async () => {
    const user = userEvent.setup();
    const reviewSecurityFindingMock = vi.fn().mockResolvedValue(undefined);

    mockSecurityQueries({
      controls: [buildControl()],
      evidenceReports: [buildEvidenceReport()],
      findings: [buildSecurityFinding()],
      auditReadiness: buildAuditReadiness(),
    });
    mockSecurityActions([vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]);
    mockSecurityMutations([
      vi.fn(),
      reviewSecurityFindingMock,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ]);

    renderRoute();

    await user.type(screen.getByPlaceholderText('Finding review notes'), 'triage in progress');
    await user.click(
      screen.getByRole('combobox', { name: /disposition for audit integrity monitoring/i }),
    );
    await user.click(await screen.findByText('Investigating'));
    await user.click(screen.getByRole('button', { name: /save finding review/i }));

    await waitFor(() => {
      expect(reviewSecurityFindingMock).toHaveBeenCalledWith({
        disposition: 'investigating',
        findingKey: 'audit_integrity_failures',
        reviewNotes: 'triage in progress',
      });
    });
  });
});
