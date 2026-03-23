import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { anyApi } from 'convex/server';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';

vi.mock('./auth/access', () => ({
  getVerifiedCurrentSiteAdminUserFromActionOrThrow: vi.fn(),
  getVerifiedCurrentSiteAdminUserOrThrow: vi.fn(),
  getVerifiedCurrentUserOrThrow: vi.fn(),
}));

vi.mock('./lib/betterAuth', () => ({
  fetchAllBetterAuthPasskeys: vi.fn(),
  fetchAllBetterAuthUsers: vi.fn(),
}));

vi.mock('./storagePlatform', () => ({
  createUploadTargetWithMode: vi.fn(),
}));

let archiveSecurityControlEvidenceHandler: typeof import('./lib/security/workspace').archiveSecurityControlEvidenceHandler;
let buildExportManifestFn: typeof import('./lib/security/core').buildExportManifest;
let deleteSecurityRelationships: typeof import('./lib/security/core').deleteSecurityRelationships;
let exportEvidenceReportHandler: typeof import('./lib/security/reports').exportEvidenceReportHandler;
let generateEvidenceReportHandler: typeof import('./lib/security/reports').generateEvidenceReportHandler;
let getAuditReadinessSnapshotHandler: typeof import('./lib/security/posture').getAuditReadinessSnapshotHandler;
let _getSecurityPostureSummaryHandler: typeof import('./lib/security/posture').getSecurityPostureSummaryHandler;
let buildSecurityWorkspaceControlSummary: typeof import('./lib/security/operations_core').buildSecurityWorkspaceControlSummary;
let listSecurityFindingsHandler: typeof import('./lib/security/workspace').listSecurityFindingsHandler;
let _listSecurityControlEvidenceActivityHandler: typeof import('./lib/security/workspace').listSecurityControlEvidenceActivityHandler;
let securityWorkspaceModuleRef: typeof import('./securityWorkspace');
let securityPostureModuleRef: typeof import('./securityPosture');
let securityReportsModuleRef: typeof import('./securityReports');
let securityReviewsModuleRef: typeof import('./securityReviews');
let securityOpsModuleRef: typeof import('./securityOps');
let renewSecurityControlEvidenceHandler: typeof import('./lib/security/workspace').renewSecurityControlEvidenceHandler;
let recordBackupVerificationHandler: typeof import('./lib/security/operations_core').recordBackupVerificationHandler;
let reviewSecurityFindingHandler: typeof import('./lib/security/workspace').reviewSecurityFindingHandler;
let summarizeIntegrityCheckFn: typeof import('./lib/security/core').summarizeIntegrityCheck;
let getVerifiedCurrentSiteAdminUserFromActionOrThrowMock: ReturnType<typeof vi.fn>;
let getVerifiedCurrentSiteAdminUserOrThrowMock: ReturnType<typeof vi.fn>;

type DocId = string;

type SecurityEvidenceDoc = {
  _id: DocId;
  internalControlId: string;
  itemId: string;
  evidenceType:
    | 'file'
    | 'link'
    | 'note'
    | 'system_snapshot'
    | 'review_attestation'
    | 'review_document'
    | 'automated_review_result'
    | 'follow_up_resolution'
    | 'exception_record';
  title: string;
  description?: string;
  url?: string;
  storageId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  evidenceDate?: number;
  reviewDueIntervalMonths?: 3 | 6 | 12;
  source?:
    | 'manual_upload'
    | 'internal_review'
    | 'automated_system_check'
    | 'external_report'
    | 'vendor_attestation'
    | 'review_attestation'
    | 'review_document'
    | 'automated_review_result'
    | 'follow_up_resolution'
    | 'review_exception';
  sufficiency: 'missing' | 'partial' | 'sufficient';
  uploadedByUserId: string;
  reviewStatus?: 'pending' | 'reviewed';
  validUntil?: number;
  lifecycleStatus?: 'active' | 'archived' | 'superseded';
  renewedFromEvidenceId?: string;
  replacedByEvidenceId?: string;
  archivedAt?: number;
  archivedByUserId?: string;
  reviewedAt?: number;
  reviewedByUserId?: string;
  createdAt: number;
  updatedAt: number;
};

type ChecklistItemDoc = {
  _id: DocId;
  internalControlId: string;
  itemId: string;
  hiddenSeedEvidenceIds?: string[];
  archivedSeedEvidence?: Array<{
    evidenceId: string;
    lifecycleStatus: 'archived' | 'superseded';
    archivedAt: number;
    archivedByUserId: string;
    replacedByEvidenceId?: string;
  }>;
  createdAt: number;
  updatedAt: number;
};

type EvidenceActivityDoc = {
  _id: DocId;
  auditEventId: string;
  actorUserId: string;
  createdAt: number;
  eventType:
    | 'security_control_evidence_created'
    | 'security_control_evidence_reviewed'
    | 'security_control_evidence_archived'
    | 'security_control_evidence_renewed';
  evidenceId: string;
  evidenceTitle: string;
  internalControlId: string;
  itemId: string;
  lifecycleStatus: 'active' | 'archived' | 'superseded' | null;
  renewedFromEvidenceId: string | null;
  replacedByEvidenceId: string | null;
  reviewStatus: 'pending' | 'reviewed' | null;
};

type TableMap = {
  securityControlChecklistItems: Map<DocId, ChecklistItemDoc>;
  securityControlEvidence: Map<DocId, SecurityEvidenceDoc>;
  securityControlEvidenceActivity: Map<DocId, EvidenceActivityDoc>;
  securityFindings: Map<DocId, Record<string, unknown>>;
  securityMetrics: Map<DocId, Record<string, unknown>>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createSecurityDb(seed?: {
  checklistItems?: ChecklistItemDoc[];
  evidence?: SecurityEvidenceDoc[];
  evidenceActivity?: EvidenceActivityDoc[];
}) {
  const tables: TableMap = {
    securityControlChecklistItems: new Map(
      (seed?.checklistItems ?? []).map((doc) => [doc._id, clone(doc)]),
    ),
    securityControlEvidence: new Map((seed?.evidence ?? []).map((doc) => [doc._id, clone(doc)])),
    securityControlEvidenceActivity: new Map(
      (seed?.evidenceActivity ?? []).map((doc) => [doc._id, clone(doc)]),
    ),
    securityFindings: new Map(),
    securityMetrics: new Map(),
  };
  let insertCounter = 0;

  const db = {
    async get(id: string) {
      return clone(tables.securityControlEvidence.get(id) ?? null);
    },
    async insert(table: keyof TableMap, value: Record<string, unknown>) {
      insertCounter += 1;
      const id = `${table}-${insertCounter}`;
      const next = { _id: id, ...clone(value) };
      tables[table].set(id, next as never);
      return id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      for (const table of Object.values(tables)) {
        const existing = table.get(id);
        if (!existing) {
          continue;
        }
        table.set(id, { ...existing, ...clone(value) } as never);
        return;
      }
      throw new Error(`Missing document for patch: ${id}`);
    },
    query(table: string) {
      const tableEntries = table in tables ? [...tables[table as keyof TableMap].values()] : [];
      return {
        async collect() {
          return clone(tableEntries);
        },
        withIndex: (
          _indexName: string,
          buildRange?: (q: {
            eq: (
              field: string,
              value: unknown,
            ) => { eq: (field: string, value: unknown) => unknown };
          }) => unknown,
        ) => {
          const filters: Array<[string, unknown]> = [];
          const q = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return q;
            },
          };
          buildRange?.(q);
          const matching = tableEntries.filter((doc) =>
            filters.every(
              ([field, expected]) => (doc as Record<string, unknown>)[field] === expected,
            ),
          );
          return {
            async first() {
              return clone(matching[0] ?? null);
            },
            async unique() {
              return clone(matching[0] ?? null);
            },
            order() {
              return {
                async first() {
                  return clone(matching[0] ?? null);
                },
                async collect() {
                  return clone(matching);
                },
              };
            },
            async collect() {
              return clone(matching);
            },
          };
        },
      };
    },
  };

  return { db, tables };
}

function createMutationCtx(seed?: {
  checklistItems?: ChecklistItemDoc[];
  evidence?: SecurityEvidenceDoc[];
  evidenceActivity?: EvidenceActivityDoc[];
}) {
  const { db, tables } = createSecurityDb(seed);
  const runMutation = vi.fn(async () => null);

  return {
    db,
    runMutation,
    tables,
  };
}

function findFirstSeedEvidence() {
  for (const control of ACTIVE_CONTROL_REGISTER.controls) {
    for (const item of control.platformChecklistItems) {
      if (item.seed.evidence.length > 0) {
        return {
          controlId: control.internalControlId,
          itemId: item.itemId,
          evidenceId: `${control.internalControlId}:${item.itemId}:seed:0`,
          evidence: item.seed.evidence[0],
        };
      }
    }
  }
  throw new Error('Expected at least one seeded evidence entry in the active control register.');
}

beforeAll(async () => {
  const accessModule = await import('./auth/access');
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock = vi.mocked(
    accessModule.getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  );
  getVerifiedCurrentSiteAdminUserOrThrowMock = vi.mocked(
    accessModule.getVerifiedCurrentSiteAdminUserOrThrow,
  );
  const [
    workspaceModule,
    postureModule,
    reportsModule,
    reviewsModule,
    opsModule,
    workspaceHelperModule,
    postureHelperModule,
    reportsHelperModule,
    opsHelperModule,
    coreModule,
  ] = await Promise.all([
    import('./securityWorkspace'),
    import('./securityPosture'),
    import('./securityReports'),
    import('./securityReviews'),
    import('./securityOps'),
    import('./lib/security/workspace'),
    import('./lib/security/posture'),
    import('./lib/security/reports'),
    import('./lib/security/operations_core'),
    import('./lib/security/core'),
  ]);
  securityWorkspaceModuleRef = workspaceModule;
  securityPostureModuleRef = postureModule;
  securityReportsModuleRef = reportsModule;
  securityReviewsModuleRef = reviewsModule;
  securityOpsModuleRef = opsModule;
  archiveSecurityControlEvidenceHandler =
    workspaceHelperModule.archiveSecurityControlEvidenceHandler;
  buildExportManifestFn = coreModule.buildExportManifest;
  deleteSecurityRelationships = coreModule.deleteSecurityRelationships;
  exportEvidenceReportHandler = reportsHelperModule.exportEvidenceReportHandler;
  generateEvidenceReportHandler = reportsHelperModule.generateEvidenceReportHandler;
  getAuditReadinessSnapshotHandler = postureHelperModule.getAuditReadinessSnapshotHandler;
  _getSecurityPostureSummaryHandler = postureHelperModule.getSecurityPostureSummaryHandler;
  buildSecurityWorkspaceControlSummary = opsHelperModule.buildSecurityWorkspaceControlSummary;
  listSecurityFindingsHandler = workspaceHelperModule.listSecurityFindingsHandler;
  _listSecurityControlEvidenceActivityHandler =
    workspaceHelperModule.listSecurityControlEvidenceActivityHandler;
  renewSecurityControlEvidenceHandler = workspaceHelperModule.renewSecurityControlEvidenceHandler;
  recordBackupVerificationHandler = opsHelperModule.recordBackupVerificationHandler;
  reviewSecurityFindingHandler = workspaceHelperModule.reviewSecurityFindingHandler;
  summarizeIntegrityCheckFn = coreModule.summarizeIntegrityCheck;
});

beforeEach(() => {
  vi.clearAllMocks();
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock.mockResolvedValue({
    activeOrganizationId: 'org-1',
    authUser: {
      email: 'admin@example.com',
    },
    authUserId: 'admin-user',
  } as never);
  getVerifiedCurrentSiteAdminUserOrThrowMock.mockResolvedValue({
    activeOrganizationId: 'org-1',
    authUserId: 'admin-user',
  } as never);
});

describe('audit evidence helpers', () => {
  it('re-exports domain functions through explicit top-level namespaces', () => {
    expect(securityWorkspaceModuleRef.listControlWorkspaceSnapshotInternal).toBeDefined();
    expect(securityPostureModuleRef.getSecurityWorkspaceOverview).toBeDefined();
    expect(securityReportsModuleRef.generateEvidenceReport).toBeDefined();
    expect(securityReviewsModuleRef.refreshReviewRunAutomation).toBeDefined();
    expect(securityOpsModuleRef.recordDocumentScanEventInternal).toBeDefined();
  });

  it('ignores missing relationship rows during cleanup', async () => {
    const deleteFn = vi.fn(async () => {
      throw new Error('Delete on nonexistent document ID relationship-1');
    });

    const deleted = await deleteSecurityRelationships(
      {
        db: {
          delete: deleteFn,
          query: () => ({
            withIndex: () => ({
              collect: async () => [
                {
                  _id: 'relationship-1',
                  fromId: 'task-1',
                  fromType: 'review_task',
                  relationshipType: 'supports',
                  toId: 'source-1',
                  toType: 'evidence_report',
                },
              ],
            }),
          }),
        },
      } as never,
      {
        fromId: 'task-1',
        fromType: 'review_task',
        relationshipType: 'supports',
        toId: 'source-1',
        toType: 'evidence_report',
      },
    );

    expect(deleted).toBe(0);
    expect(deleteFn).toHaveBeenCalledWith('relationship-1');
  });

  it('builds deterministic export manifests for identical inputs', () => {
    const integritySummary = summarizeIntegrityCheckFn({
      checkedAt: Date.parse('2026-03-18T00:00:00.000Z'),
      failures: [],
      limit: 250,
      verified: true,
    });

    const left = buildExportManifestFn({
      actorUserId: 'admin-user',
      contentHash: 'content-hash',
      exactFilters: {
        eventType: 'authorization_denied',
        failuresOnly: true,
      },
      exportHash: 'payload-hash',
      exportId: 'export-1',
      exportedAt: Date.parse('2026-03-18T00:05:00.000Z'),
      integritySummary,
      organizationScope: 'org-1',
      reviewStatusAtExport: 'reviewed',
      rowCount: 12,
      sourceReportId: 'report-1',
    });
    const right = buildExportManifestFn({
      actorUserId: 'admin-user',
      contentHash: 'content-hash',
      exactFilters: {
        eventType: 'authorization_denied',
        failuresOnly: true,
      },
      exportHash: 'payload-hash',
      exportId: 'export-1',
      exportedAt: Date.parse('2026-03-18T00:05:00.000Z'),
      integritySummary,
      organizationScope: 'org-1',
      reviewStatusAtExport: 'reviewed',
      rowCount: 12,
      sourceReportId: 'report-1',
    });

    expect(left).toEqual(right);
    expect(left.schemaVersion).toContain('audit-evidence');
  });

  it('records structured backup drill evidence and matching audit events', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T14:00:00.000Z'));
    const inserted: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        insert: vi.fn(async (_table: string, value: Record<string, unknown>) => {
          inserted.push(structuredClone(value));
          return 'backup-report-1';
        }),
      },
      runMutation: vi.fn(async () => null),
    };

    const recordId = await recordBackupVerificationHandler(ctx as never, {
      artifactContentJson: '{"restored":5}',
      artifactHash: 'artifact-hash',
      checkedAt: Date.parse('2026-03-18T13:55:00.000Z'),
      drillId: 'drill-1',
      drillType: 'restore_verification',
      evidenceSummary: 'Restored five records into a test environment.',
      initiatedByKind: 'user',
      initiatedByUserId: 'admin-user',
      restoredItemCount: 5,
      status: 'failure',
      sourceDataset: 'auditLogs',
      summary: 'Restore verification failed on checksum mismatch.',
      targetEnvironment: 'test',
      verificationMethod: 'checksum-compare',
      failureReason: 'Checksum mismatch',
    });

    expect(recordId).toBe('backup-report-1');
    expect(inserted[0]).toMatchObject({
      artifactHash: 'artifact-hash',
      drillId: 'drill-1',
      drillType: 'restore_verification',
      failureReason: 'Checksum mismatch',
      initiatedByKind: 'user',
      initiatedByUserId: 'admin-user',
      restoredItemCount: 5,
      status: 'failure',
      targetEnvironment: 'test',
      verificationMethod: 'checksum-compare',
    });
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'backup_restore_drill_failed',
        resourceId: 'drill-1',
      }),
    );
    vi.useRealTimers();
  });

  it('surfaces metadata gaps and stale drill state in the readiness snapshot', async () => {
    const backupReports = [
      {
        artifactHash: 'artifact-hash',
        checkedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        drillId: 'drill-1',
        drillType: 'operator_recorded',
        failureReason: null,
        initiatedByKind: 'user',
        initiatedByUserId: 'admin-user',
        restoredItemCount: 3,
        sourceDataset: 'chatAttachments',
        status: 'success',
        targetEnvironment: 'test',
        verificationMethod: 'manual-restore',
      },
    ];
    const retentionJobs = [
      {
        createdAt: Date.parse('2026-03-18T01:00:00.000Z'),
        details: 'ok',
        jobKind: 'audit_export_cleanup',
        processedCount: 4,
        status: 'success',
      },
    ];
    const auditLogs = [
      {
        createdAt: Date.parse('2026-03-18T02:00:00.000Z'),
        eventType: 'organization_policy_updated',
        id: 'gap-1',
        outcome: 'success',
        resourceId: null,
        resourceType: 'organization_policy',
        severity: 'info',
        sourceSurface: null,
      },
      {
        createdAt: Date.parse('2026-03-18T03:00:00.000Z'),
        eventType: 'authorization_denied',
        id: 'denial-1',
        metadata: '{"permission":"viewAudit","reason":"forbidden"}',
        organizationId: 'org-1',
        outcome: 'failure',
        resourceId: 'org-1',
        resourceType: 'organization_permission',
        severity: 'warning',
        sourceSurface: 'auth.authorization',
      },
    ];
    const exportArtifacts = [
      {
        artifactType: 'audit_csv',
        exportedAt: Date.parse('2026-03-18T04:00:00.000Z'),
        manifestHash: 'manifest-1',
        sourceReportId: null,
      },
    ];
    const queryMap = {
      backupVerificationReports: backupReports,
      retentionJobs,
      auditLogs,
      exportArtifacts,
    } as const;
    const ctx = {
      db: {
        query: (table: keyof typeof queryMap) => ({
          withIndex: () => ({
            order: () => ({
              first: async () => structuredClone(queryMap[table][0] ?? null),
              take: async (count: number) => structuredClone(queryMap[table].slice(0, count)),
            }),
          }),
        }),
      },
    };

    const snapshot = await getAuditReadinessSnapshotHandler(ctx as never);

    expect(snapshot.metadataGaps).toHaveLength(1);
    expect(snapshot.metadataGaps[0]).toMatchObject({
      eventType: 'organization_policy_updated',
      id: 'gap-1',
    });
    expect(snapshot.recentDeniedActions).toHaveLength(1);
    expect(snapshot.recentExports[0]).toMatchObject({
      artifactType: 'audit_csv',
      manifestHash: 'manifest-1',
    });
    expect(snapshot.latestBackupDrill).toMatchObject({
      drillId: 'drill-1',
      status: 'success',
    });
  });

  it('reads security posture from the precomputed metrics snapshot', async () => {
    const betterAuthModule = await import('./lib/betterAuth');
    vi.mocked(betterAuthModule.fetchAllBetterAuthUsers).mockResolvedValue([
      { _id: 'user-1', twoFactorEnabled: true },
      { _id: 'user-2', twoFactorEnabled: false },
    ] as never);
    vi.mocked(betterAuthModule.fetchAllBetterAuthPasskeys).mockResolvedValue([
      { userId: 'user-2' },
    ] as never);

    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            buildRange?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const filters: Array<[string, unknown]> = [];
            const q = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return q;
              },
            };
            buildRange?.(q);

            if (table === 'securityMetrics') {
              return {
                first: async () => ({
                  key: 'global',
                  totalDocumentScans: 12,
                  quarantinedDocumentScans: 3,
                  rejectedDocumentScans: 2,
                  lastDocumentScanAt: 100,
                  updatedAt: 100,
                }),
              };
            }
            if (table === 'retentionJobs') {
              return {
                order: () => ({ first: async () => ({ createdAt: 90, status: 'success' }) }),
              };
            }
            if (table === 'backupVerificationReports') {
              return {
                order: () => ({ first: async () => ({ checkedAt: 80, status: 'failure' }) }),
              };
            }
            if (table === 'auditLogs') {
              if (
                filters.some(
                  ([field, value]) =>
                    field === 'eventType' && value === 'audit_integrity_check_failed',
                )
              ) {
                return { collect: async () => [{ id: 'fail-1' }, { id: 'fail-2' }] };
              }
              return { order: () => ({ first: async () => ({ createdAt: 95 }) }) };
            }

            throw new Error(`Unexpected query table: ${table}`);
          },
        }),
      },
    };

    const result = await _getSecurityPostureSummaryHandler(ctx as never);

    expect(result.scanner).toEqual({
      lastScanAt: 100,
      quarantinedCount: 3,
      rejectedCount: 2,
      totalScans: 12,
    });
    expect(result.auth.mfaEnabledUsers).toBe(2);
    expect(result.audit.integrityFailures).toBe(2);
  });

  it('counts current seeded evidence in the workspace control summary', async () => {
    vi.useFakeTimers();
    const generatedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);
    vi.setSystemTime(new Date(generatedAt + 7 * 24 * 60 * 60 * 1000));
    const { db } = createSecurityDb();

    const summary = await buildSecurityWorkspaceControlSummary({ db } as never);

    expect(
      summary.controlSummary.bySupport.complete + summary.controlSummary.bySupport.partial,
    ).toBeGreaterThan(0);
    expect(summary.missingSupportControls).toBeLessThan(summary.controlSummary.totalControls);
    vi.useRealTimers();
  });

  it('treats expired seeded evidence as missing support in the workspace summary', async () => {
    vi.useFakeTimers();
    const generatedAt = new Date(ACTIVE_CONTROL_REGISTER.generatedAt);
    generatedAt.setMonth(generatedAt.getMonth() + 13);
    vi.setSystemTime(generatedAt);
    const { db } = createSecurityDb();

    const summary = await buildSecurityWorkspaceControlSummary({ db } as never);

    expect(summary.controlSummary.bySupport.complete).toBe(0);
    expect(summary.controlSummary.bySupport.partial).toBe(0);
    expect(summary.missingSupportControls).toBe(summary.controlSummary.totalControls);
    vi.useRealTimers();
  });

  it('restores support through review-origin evidence after seeded evidence expires', async () => {
    vi.useFakeTimers();
    const seeded = findFirstSeedEvidence();
    const generatedAt = new Date(ACTIVE_CONTROL_REGISTER.generatedAt);
    generatedAt.setMonth(generatedAt.getMonth() + 13);
    const now = generatedAt.getTime();
    vi.setSystemTime(generatedAt);
    const { db } = createSecurityDb({
      evidence: [
        {
          _id: 'review-artifact-1',
          internalControlId: seeded.controlId,
          itemId: seeded.itemId,
          evidenceType: 'review_attestation',
          title: 'Annual attestation refresh',
          sufficiency: 'sufficient',
          source: 'review_attestation',
          uploadedByUserId: 'admin-user',
          reviewStatus: 'reviewed',
          reviewedAt: now,
          validUntil: now + 365 * 24 * 60 * 60 * 1000,
          lifecycleStatus: 'active',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const summary = await buildSecurityWorkspaceControlSummary({ db } as never);

    expect(
      summary.controlSummary.bySupport.partial + summary.controlSummary.bySupport.complete,
    ).toBeGreaterThan(0);
    expect(summary.missingSupportControls).toBeLessThan(summary.controlSummary.totalControls);
    vi.useRealTimers();
  });

  it('rolls a control to partial support when checklist items are mixed', async () => {
    vi.useFakeTimers();
    const seeded = findFirstSeedEvidence();
    const generatedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);
    vi.setSystemTime(new Date(generatedAt + 7 * 24 * 60 * 60 * 1000));
    const control = ACTIVE_CONTROL_REGISTER.controls.find(
      (entry) => entry.internalControlId === seeded.controlId,
    );
    expect(control).toBeTruthy();
    expect(control?.platformChecklistItems.length).toBeGreaterThan(1);
    const missingItem = control?.platformChecklistItems.find(
      (item) => item.itemId !== seeded.itemId,
    );
    expect(missingItem).toBeTruthy();

    const { db } = createSecurityDb({
      checklistItems: [
        {
          _id: 'checklist-hide-seed',
          internalControlId: seeded.controlId,
          itemId: missingItem!.itemId,
          hiddenSeedEvidenceIds: missingItem!.seed.evidence.map(
            (_, index) => `${seeded.controlId}:${missingItem!.itemId}:seed:${index}`,
          ),
          archivedSeedEvidence: [],
          createdAt: generatedAt,
          updatedAt: generatedAt,
        },
      ],
    });

    const summary = await buildSecurityWorkspaceControlSummary({ db } as never);

    expect(summary.controlSummary.bySupport.partial).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('keeps control support independent from findings, vendor state, and review overlays', async () => {
    vi.useFakeTimers();
    const generatedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);
    vi.setSystemTime(new Date(generatedAt + 7 * 24 * 60 * 60 * 1000));
    const { db } = createSecurityDb();
    const guardedCtx = {
      db: {
        query(table: string) {
          if (table !== 'securityControlChecklistItems' && table !== 'securityControlEvidence') {
            throw new Error(`Unexpected overlay query in control support summary: ${table}`);
          }
          return db.query(table);
        },
      },
    };

    const summary = await buildSecurityWorkspaceControlSummary(guardedCtx as never);

    expect(summary.controlSummary.totalControls).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('lists retained security findings with stored disposition context', async () => {
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            buildRange?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const filters: Array<[string, unknown]> = [];
            const q = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return q;
              },
            };
            buildRange?.(q);

            if (table === 'securityMetrics') {
              return {
                first: async () => ({
                  key: 'global',
                  totalDocumentScans: 8,
                  quarantinedDocumentScans: 2,
                  rejectedDocumentScans: 0,
                  lastDocumentScanAt: 100,
                  updatedAt: 100,
                }),
              };
            }

            if (table === 'auditLogs') {
              if (
                filters.some(
                  ([field, value]) =>
                    field === 'eventType' && value === 'audit_integrity_check_failed',
                )
              ) {
                return {
                  collect: async () => [{ _id: 'audit-failure-1' }],
                  order: () => ({
                    first: async () => ({
                      _id: 'audit-failure-1',
                      createdAt: 95,
                    }),
                  }),
                };
              }
              return { order: () => ({ first: async () => ({ createdAt: 90 }) }) };
            }

            if (table === 'securityControlEvidence') {
              return {
                collect: async () => [
                  {
                    _id: 'release-evidence-1',
                    createdAt: 80,
                    evidenceDate: 81,
                    lifecycleStatus: 'active',
                    source: 'automated_system_check',
                    sufficiency: 'partial',
                    title: 'production release provenance',
                  },
                ],
              };
            }

            if (table === 'securityFindings') {
              return {
                unique: async () => {
                  const findingKey = filters.find(([field]) => field === 'findingKey')?.[1];
                  if (findingKey === 'audit_integrity_failures') {
                    return {
                      findingKey: 'audit_integrity_failures',
                      disposition: 'investigating',
                      firstObservedAt: 90,
                      internalReviewNotes: 'triaging integrity break',
                      lastObservedAt: 95,
                      reviewedAt: 120,
                      reviewedByUserId: 'admin-user',
                    };
                  }
                  return null;
                },
              };
            }

            if (table === 'userProfiles') {
              return {
                first: async () => ({ name: 'Admin User', email: 'admin@example.com' }),
              };
            }

            throw new Error(`Unexpected query table: ${table}`);
          },
        }),
      },
    };

    const result = await listSecurityFindingsHandler(ctx as never);

    expect(result[0]).toMatchObject({
      disposition: 'investigating',
      findingKey: 'audit_integrity_failures',
      internalNotes: 'triaging integrity break',
      reviewedByDisplay: 'Admin User',
      severity: 'critical',
      status: 'open',
    });
    expect(
      result.some(
        (finding: (typeof result)[number]) => finding.findingKey === 'release_security_validation',
      ),
    ).toBe(true);
  });

  it('reads projected evidence activity rows before raw-audit fallback', async () => {
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (
            _index: string,
            buildRange?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const q = {
              eq(_field: string, _value: unknown) {
                return q;
              },
            };
            buildRange?.(q);

            if (table === 'securityControlEvidenceActivity') {
              return {
                order: () => ({
                  collect: async () => [
                    {
                      actorUserId: 'admin-user',
                      auditEventId: 'audit-1',
                      createdAt: 123,
                      eventType: 'security_control_evidence_reviewed',
                      evidenceId: 'evidence-1',
                      evidenceTitle: 'Firewall export',
                      internalControlId: 'ac-1',
                      itemId: 'item-1',
                      lifecycleStatus: 'active',
                      renewedFromEvidenceId: null,
                      replacedByEvidenceId: null,
                      reviewStatus: 'reviewed',
                    },
                  ],
                }),
              };
            }

            if (table === 'userProfiles') {
              return {
                first: async () => ({ name: 'Admin User', email: 'admin@example.com' }),
              };
            }

            throw new Error(`Unexpected query table: ${table}`);
          },
        }),
      },
    };

    const result = await _listSecurityControlEvidenceActivityHandler(ctx as never, {
      internalControlId: 'ac-1',
      itemId: 'item-1',
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        actorDisplay: 'Admin User',
        evidenceId: 'evidence-1',
        evidenceTitle: 'Firewall export',
        reviewStatus: 'reviewed',
      }),
    ]);
  });

  it('stores provider disposition for a current security finding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));
    const inserted: Array<Record<string, unknown>> = [];
    const patched: Array<Record<string, unknown>> = [];
    const ctx = {
      db: {
        insert: vi.fn(async (_table: string, value: Record<string, unknown>) => {
          inserted.push(value);
          return 'finding-1';
        }),
        patch: vi.fn(async (_id: string, value: Record<string, unknown>) => {
          patched.push(value);
        }),
        query: (table: string) => ({
          withIndex: (
            _index: string,
            buildRange?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
          ) => {
            const filters: Array<[string, unknown]> = [];
            const q = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return q;
              },
            };
            buildRange?.(q);

            if (table === 'securityMetrics') {
              return {
                first: async () => ({
                  key: 'global',
                  totalDocumentScans: 8,
                  quarantinedDocumentScans: 0,
                  rejectedDocumentScans: 1,
                  lastDocumentScanAt: 100,
                  updatedAt: 100,
                }),
              };
            }

            if (table === 'auditLogs') {
              if (
                filters.some(
                  ([field, value]) =>
                    field === 'eventType' && value === 'audit_integrity_check_failed',
                )
              ) {
                return {
                  collect: async () => [],
                  order: () => ({ first: async () => null }),
                };
              }
              return { order: () => ({ first: async () => ({ createdAt: 90 }) }) };
            }

            if (table === 'securityControlEvidence') {
              return {
                collect: async () => [],
              };
            }

            if (table === 'securityFindings') {
              return {
                unique: async () => null,
              };
            }

            if (table === 'userProfiles') {
              return {
                first: async () => ({ name: 'Admin User', email: 'admin@example.com' }),
              };
            }

            throw new Error(`Unexpected query table: ${table}`);
          },
        }),
      },
    };

    const result = await reviewSecurityFindingHandler(ctx as never, {
      disposition: 'resolved',
      findingKey: 'document_scan_rejections',
      internalNotes: ' mitigated in current workflow ',
    });

    const reviewedInsert = inserted.find(
      (entry) =>
        entry.findingKey === 'document_scan_rejections' && entry.reviewedByUserId === 'admin-user',
    );
    expect(reviewedInsert).toMatchObject({
      disposition: 'resolved',
      findingKey: 'document_scan_rejections',
      internalReviewNotes: 'mitigated in current workflow',
      reviewedByUserId: 'admin-user',
    });
    expect(patched).toHaveLength(0);
    expect(result).toMatchObject({
      disposition: 'resolved',
      findingKey: 'document_scan_rejections',
      internalNotes: 'mitigated in current workflow',
      reviewedByDisplay: 'Admin User',
    });
    vi.useRealTimers();
  });

  it('generates audit readiness reports with stale drill detection and persisted report metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T15:00:00.000Z'));
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        audit: { integrityFailures: 1, lastEventAt: 10 },
        auth: {
          emailVerificationRequired: true,
          mfaCoveragePercent: 90,
          mfaEnabledUsers: 9,
          passkeyEnabledUsers: 3,
          totalUsers: 10,
        },
        backups: { lastCheckedAt: 20, lastStatus: 'success' },
        retention: { lastJobAt: 30, lastJobStatus: 'success' },
        scanner: {
          lastScanAt: 40,
          quarantinedCount: 0,
          rejectedCount: 0,
          totalScans: 4,
        },
        sessions: {
          freshWindowMinutes: 15,
          sessionExpiryHours: 24,
          temporaryLinkTtlMinutes: 15,
        },
        telemetry: { sentryApproved: false, sentryEnabled: false },
        vendors: [],
      })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        latestBackupDrill: {
          artifactHash: 'artifact-1',
          checkedAt: Date.parse('2026-01-01T00:00:00.000Z'),
          drillId: 'drill-1',
          drillType: 'restore_verification',
          failureReason: null,
          initiatedByKind: 'user',
          initiatedByUserId: 'admin-user',
          restoredItemCount: 5,
          sourceDataset: 'auditLogs',
          status: 'success',
          targetEnvironment: 'test',
          verificationMethod: 'checksum-compare',
        },
        latestRetentionJob: {
          createdAt: Date.parse('2026-03-18T12:00:00.000Z'),
          details: 'ok',
          jobKind: 'audit_export_cleanup',
          processedCount: 2,
          status: 'success',
        },
        metadataGaps: [
          {
            createdAt: 1,
            eventType: 'organization_policy_updated',
            id: 'gap-1',
            resourceId: null,
          },
        ],
        recentDeniedActions: [
          {
            createdAt: 2,
            eventType: 'authorization_denied',
            id: 'denial-1',
            metadata: '{}',
            organizationId: 'org-1',
          },
        ],
        recentExports: [
          {
            artifactType: 'audit_csv',
            exportedAt: 3,
            manifestHash: 'manifest-1',
            sourceReportId: null,
          },
        ],
      })
      .mockResolvedValueOnce({ verifiedDomainsOnly: true });
    const runAction = vi.fn(async () => ({
      checkedAt: Date.parse('2026-03-18T14:55:00.000Z'),
      failures: [{ id: 'failure-1' }],
      limit: 250,
      verified: false,
    }));
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('report-1')
      .mockResolvedValueOnce(null);

    const result = await generateEvidenceReportHandler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      { reportKind: 'audit_readiness' },
    );

    expect(result).toMatchObject({
      id: 'report-1',
      reportKind: 'audit_readiness',
      reviewStatus: 'pending',
    });
    const parsed = JSON.parse(result.report) as Record<string, unknown>;
    expect(parsed.summary).toMatchObject({
      backupDrillStatus: 'success',
      deniedActionCount: 1,
      exportCount: 1,
      integrityFailureCount: 1,
      metadataGapCount: 1,
    });
    expect(parsed.backupDrill).toMatchObject({
      isStale: true,
      latest: expect.objectContaining({
        drillId: 'drill-1',
      }),
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      generatedByUserId: 'admin-user',
      organizationId: 'org-1',
      reportKind: 'audit_readiness',
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
      eventType: 'evidence_report_generated',
      resourceId: 'report-1',
      resourceLabel: 'audit_readiness',
    });
    expect(
      runQuery.mock.calls.some(
        (call) => call[0] === anyApi.securityWorkspace.listSecurityControlWorkspaces,
      ),
    ).toBe(false);
    vi.useRealTimers();
  });

  it('exports evidence reports with manifest and artifact metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T16:00:00.000Z'));
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000123',
    );
    const reportRecord = {
      _id: 'report-1',
      createdAt: Date.parse('2026-03-18T15:30:00.000Z'),
      organizationId: 'org-1',
      reportKind: 'audit_readiness',
      contentJson: JSON.stringify({ summary: { integrityFailureCount: 1 } }),
      contentHash: 'content-hash',
      reviewStatus: 'reviewed',
      reviewedAt: Date.parse('2026-03-18T15:45:00.000Z'),
    };
    const runQuery = vi.fn(async () => reportRecord);
    const runAction = vi.fn(async () => ({
      checkedAt: Date.parse('2026-03-18T15:59:00.000Z'),
      failures: [{ id: 'failure-1' }],
      limit: 250,
      verified: false,
    }));
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce('artifact-1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await exportEvidenceReportHandler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      { id: 'report-1' as never },
    );

    expect(result).toMatchObject({
      id: 'report-1',
      reportKind: 'audit_readiness',
      reviewStatus: 'reviewed',
    });
    const exportArtifactArgs = runMutation.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(exportArtifactArgs).toMatchObject({
      artifactType: 'evidence_report_export',
      exportedByUserId: 'admin-user',
      organizationId: 'org-1',
      schemaVersion: expect.stringContaining('audit-evidence'),
      sourceReportId: 'report-1',
    });
    const manifest = JSON.parse(exportArtifactArgs.manifestJson as string) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      actorUserId: 'admin-user',
      contentHash: 'content-hash',
      exportId: '00000000-0000-4000-8000-000000000123',
      organizationScope: 'org-1',
      reviewStatusAtExport: 'reviewed',
      rowCount: 1,
      sourceReportId: 'report-1',
    });
    expect(manifest.exactFilters).toMatchObject({
      reportId: 'report-1',
      reportKind: 'audit_readiness',
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      id: 'report-1',
      latestExportArtifactId: 'artifact-1',
    });
    expect(runMutation.mock.calls[2]?.[1]).toMatchObject({
      eventType: 'evidence_report_exported',
      resourceId: 'report-1',
      resourceLabel: 'audit_readiness',
    });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});

describe('security evidence mutations', () => {
  it('archives active evidence and records its archived lifecycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T10:00:00.000Z'));
    const now = Date.now();
    const ctx = createMutationCtx({
      evidence: [
        {
          _id: 'evidence-live',
          internalControlId: 'ac-live',
          itemId: 'item-live',
          evidenceType: 'link',
          title: 'Quarterly access review',
          url: 'https://example.com/review',
          sufficiency: 'sufficient',
          uploadedByUserId: 'user-1',
          reviewStatus: 'reviewed',
          lifecycleStatus: 'active',
          createdAt: now - 1000,
          updatedAt: now - 1000,
        },
      ],
    });

    await archiveSecurityControlEvidenceHandler(ctx as never, {
      evidenceId: 'evidence-live',
      internalControlId: 'ac-live',
      itemId: 'item-live',
    });

    expect(ctx.tables.securityControlEvidence.get('evidence-live')).toMatchObject({
      lifecycleStatus: 'archived',
      archivedAt: now,
      archivedByUserId: 'admin-user',
      updatedAt: now,
    });
    expect([...ctx.tables.securityControlEvidenceActivity.values()][0]).toMatchObject({
      actorUserId: 'admin-user',
      eventType: 'security_control_evidence_archived',
      evidenceId: 'evidence-live',
      lifecycleStatus: 'archived',
      reviewStatus: 'reviewed',
    });
    vi.useRealTimers();
  });

  it('renews active evidence by creating a pending copy and superseding the original', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T11:00:00.000Z'));
    const now = Date.now();
    const ctx = createMutationCtx({
      evidence: [
        {
          _id: 'evidence-live',
          internalControlId: 'ac-live',
          itemId: 'item-live',
          evidenceType: 'file',
          title: 'Firewall config export',
          description: 'Approved export',
          storageId: 'storage-1',
          fileName: 'firewall.csv',
          mimeType: 'text/csv',
          sizeBytes: 512,
          evidenceDate: now - 86_400_000,
          reviewDueIntervalMonths: 6,
          source: 'automated_system_check',
          sufficiency: 'sufficient',
          uploadedByUserId: 'user-1',
          reviewStatus: 'reviewed',
          lifecycleStatus: 'active',
          createdAt: now - 1000,
          updatedAt: now - 1000,
        },
      ],
    });

    const newEvidenceId = await renewSecurityControlEvidenceHandler(ctx as never, {
      evidenceId: 'evidence-live',
      internalControlId: 'ac-live',
      itemId: 'item-live',
    });

    expect(newEvidenceId).toBe('securityControlEvidence-1');
    expect(ctx.tables.securityControlEvidence.get('evidence-live')).toMatchObject({
      lifecycleStatus: 'superseded',
      archivedAt: now,
      archivedByUserId: 'admin-user',
      replacedByEvidenceId: newEvidenceId,
      updatedAt: now,
    });
    expect(ctx.tables.securityControlEvidence.get(newEvidenceId)).toMatchObject({
      internalControlId: 'ac-live',
      itemId: 'item-live',
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      renewedFromEvidenceId: 'evidence-live',
      uploadedByUserId: 'admin-user',
    });
    const activityEntries = [...ctx.tables.securityControlEvidenceActivity.values()];
    expect(activityEntries).toHaveLength(2);
    expect(activityEntries[0]).toMatchObject({
      eventType: 'security_control_evidence_created',
      evidenceId: newEvidenceId,
      renewedFromEvidenceId: 'evidence-live',
    });
    expect(activityEntries[1]).toMatchObject({
      eventType: 'security_control_evidence_renewed',
      evidenceId: newEvidenceId,
      replacedByEvidenceId: newEvidenceId,
      renewedFromEvidenceId: 'evidence-live',
    });
    vi.useRealTimers();
  });

  it('archives seeded evidence by hiding it and storing archived seed metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));
    const now = Date.now();
    const seeded = findFirstSeedEvidence();
    const ctx = createMutationCtx();

    await archiveSecurityControlEvidenceHandler(ctx as never, {
      evidenceId: seeded.evidenceId,
      internalControlId: seeded.controlId,
      itemId: seeded.itemId,
    });

    const checklistDoc = [...ctx.tables.securityControlChecklistItems.values()][0];
    expect(checklistDoc).toMatchObject({
      internalControlId: seeded.controlId,
      itemId: seeded.itemId,
      hiddenSeedEvidenceIds: [seeded.evidenceId],
      archivedSeedEvidence: [
        {
          evidenceId: seeded.evidenceId,
          lifecycleStatus: 'archived',
          archivedAt: now,
          archivedByUserId: 'admin-user',
        },
      ],
      updatedAt: now,
    });
    expect([...ctx.tables.securityControlEvidenceActivity.values()][0]).toMatchObject({
      eventType: 'security_control_evidence_archived',
      evidenceId: seeded.evidenceId,
      evidenceTitle: seeded.evidence.title,
      reviewStatus: 'reviewed',
    });
    vi.useRealTimers();
  });

  it('renews seeded evidence into live evidence and supersedes the seed metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T13:00:00.000Z'));
    const now = Date.now();
    const seeded = findFirstSeedEvidence();
    const ctx = createMutationCtx({
      checklistItems: [
        {
          _id: 'checklist-existing',
          internalControlId: seeded.controlId,
          itemId: seeded.itemId,
          hiddenSeedEvidenceIds: [],
          archivedSeedEvidence: [],
          createdAt: now - 1000,
          updatedAt: now - 1000,
        },
      ],
    });

    const newEvidenceId = await renewSecurityControlEvidenceHandler(ctx as never, {
      evidenceId: seeded.evidenceId,
      internalControlId: seeded.controlId,
      itemId: seeded.itemId,
    });

    expect(newEvidenceId).toBe('securityControlEvidence-1');
    expect(ctx.tables.securityControlEvidence.get(newEvidenceId)).toMatchObject({
      internalControlId: seeded.controlId,
      itemId: seeded.itemId,
      evidenceType: seeded.evidence.evidenceType,
      title: seeded.evidence.title,
      reviewStatus: 'pending',
      lifecycleStatus: 'active',
      renewedFromEvidenceId: seeded.evidenceId,
      uploadedByUserId: 'admin-user',
      createdAt: now,
      updatedAt: now,
    });
    expect(ctx.tables.securityControlChecklistItems.get('checklist-existing')).toMatchObject({
      hiddenSeedEvidenceIds: [seeded.evidenceId],
      archivedSeedEvidence: [
        {
          evidenceId: seeded.evidenceId,
          lifecycleStatus: 'superseded',
          archivedAt: now,
          archivedByUserId: 'admin-user',
          replacedByEvidenceId: newEvidenceId,
        },
      ],
      updatedAt: now,
    });
    const activityEntries = [...ctx.tables.securityControlEvidenceActivity.values()];
    expect(activityEntries).toHaveLength(2);
    expect(activityEntries[0]).toMatchObject({
      eventType: 'security_control_evidence_created',
      evidenceId: newEvidenceId,
      renewedFromEvidenceId: seeded.evidenceId,
    });
    expect(activityEntries[1]).toMatchObject({
      eventType: 'security_control_evidence_renewed',
      evidenceId: newEvidenceId,
      replacedByEvidenceId: newEvidenceId,
      renewedFromEvidenceId: seeded.evidenceId,
    });
    vi.useRealTimers();
  });
});
