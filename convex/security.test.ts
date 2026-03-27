import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { anyApi } from 'convex/server';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';

vi.mock('./auth/access', async () => {
  const actual = await vi.importActual<typeof import('./auth/access')>('./auth/access');
  return {
    ...actual,
    getVerifiedCurrentSiteAdminUserFromActionOrThrow: vi.fn(),
    getVerifiedCurrentSiteAdminUserOrThrow: vi.fn(),
    getVerifiedCurrentUserFromActionOrThrow: vi.fn(),
    getVerifiedCurrentUserOrThrow: vi.fn(),
  };
});

vi.mock('./lib/betterAuth', () => ({
  fetchAllBetterAuthPasskeys: vi.fn(),
  fetchAllBetterAuthUsers: vi.fn(),
}));

vi.mock('./storagePlatform', () => ({
  createUploadTargetWithMode: vi.fn(),
}));

let archiveSecurityControlEvidenceHandler: typeof import('./lib/security/workspace').archiveSecurityControlEvidenceHandler;
let buildExportManifestFn: typeof import('./lib/security/core').buildExportManifest;
let buildEvidenceReportDetailFn: typeof import('./lib/security/review_runs_read_models').buildEvidenceReportDetail;
let deleteSecurityRelationships: typeof import('./lib/security/core').deleteSecurityRelationships;
let exportEvidenceReportHandler: typeof import('./lib/security/reports').exportEvidenceReportHandler;
let generateEvidenceReportHandler: typeof import('./lib/security/reports').generateEvidenceReportHandler;
let getAuditReadinessSnapshotHandler: typeof import('./lib/security/posture').getAuditReadinessSnapshotHandler;
let getLatestEvidenceReportExportsByReportIdFn: typeof import('./lib/security/core').getLatestEvidenceReportExportsByReportId;
let _getSecurityPostureSummaryHandler: typeof import('./lib/security/posture').getSecurityPostureSummaryHandler;
let buildSecurityWorkspaceControlSummary: typeof import('./lib/security/operations_core').buildSecurityWorkspaceControlSummary;
let getSecurityControlWorkspaceRecord: typeof import('./lib/security/control_workspace_core').getSecurityControlWorkspaceRecord;
let listSecurityFindingsHandler: typeof import('./lib/security/workspace').listSecurityFindingsHandler;
let _listSecurityControlEvidenceActivityHandler: typeof import('./lib/security/workspace').listSecurityControlEvidenceActivityHandler;
let securityWorkspaceModuleRef: typeof import('./securityWorkspace');
let securityPostureModuleRef: typeof import('./securityPosture');
let securityReportsModuleRef: typeof import('./securityReports');
let securityReviewsModuleRef: typeof import('./securityReviews');
let securityOpsModuleRef: typeof import('./securityOps');
let auditModuleRef: typeof import('./audit');
let renewSecurityControlEvidenceHandler: typeof import('./lib/security/workspace').renewSecurityControlEvidenceHandler;
let recordBackupVerificationHandler: typeof import('./lib/security/operations_core').recordBackupVerificationHandler;
let reviewSecurityFindingHandler: typeof import('./lib/security/workspace').reviewSecurityFindingHandler;
let summarizeIntegrityCheckFn: typeof import('./lib/security/core').summarizeIntegrityCheck;
let getVerifiedCurrentSiteAdminUserFromActionOrThrowMock: ReturnType<typeof vi.fn>;
let getVerifiedCurrentSiteAdminUserOrThrowMock: ReturnType<typeof vi.fn>;
let getVerifiedCurrentUserFromActionOrThrowMock: ReturnType<typeof vi.fn>;

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
  auditLedgerArchiveVerifications: Map<DocId, Record<string, unknown>>;
  auditLedgerEvents: Map<DocId, Record<string, unknown>>;
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
  auditLedgerArchiveVerifications?: Array<Record<string, unknown>>;
  auditLedgerEvents?: Array<Record<string, unknown>>;
  checklistItems?: ChecklistItemDoc[];
  evidence?: SecurityEvidenceDoc[];
  evidenceActivity?: EvidenceActivityDoc[];
}) {
  const tables: TableMap = {
    auditLedgerArchiveVerifications: new Map(
      (seed?.auditLedgerArchiveVerifications ?? []).map((doc, index) => [
        String(doc._id ?? `auditLedgerArchiveVerifications-${index + 1}`),
        clone(doc),
      ]),
    ),
    auditLedgerEvents: new Map(
      (seed?.auditLedgerEvents ?? []).map((doc, index) => [
        String(doc._id ?? `auditLedgerEvents-${index + 1}`),
        clone(doc),
      ]),
    ),
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
                async take(limit: number) {
                  return clone(matching.slice(0, limit));
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

function createSecurityQueryCtx(seed?: {
  evidenceReports?: Array<Record<string, unknown>>;
  exportArtifacts?: Array<Record<string, unknown>>;
  reviewRuns?: Array<Record<string, unknown>>;
  reviewTaskEvidenceLinks?: Array<Record<string, unknown>>;
  reviewTasks?: Array<Record<string, unknown>>;
  userProfiles?: Array<Record<string, unknown>>;
}) {
  const tables = {
    evidenceReports: seed?.evidenceReports ?? [],
    exportArtifacts: seed?.exportArtifacts ?? [],
    reviewRuns: seed?.reviewRuns ?? [],
    reviewTaskEvidenceLinks: seed?.reviewTaskEvidenceLinks ?? [],
    reviewTasks: seed?.reviewTasks ?? [],
    userProfiles: seed?.userProfiles ?? [],
  } as const;

  return {
    db: {
      async get(id: string) {
        for (const table of Object.values(tables)) {
          const match = table.find((doc) => doc._id === id);
          if (match) {
            return clone(match);
          }
        }
        return null;
      },
      query(table: keyof typeof tables) {
        const tableEntries = tables[table];
        return {
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
            const sortByCreatedAt = (direction: 'asc' | 'desc') =>
              [...matching].sort((left, right) => {
                const leftCreatedAt =
                  typeof left.createdAt === 'number' ? left.createdAt : left._creationTime;
                const rightCreatedAt =
                  typeof right.createdAt === 'number' ? right.createdAt : right._creationTime;
                const diff = Number(leftCreatedAt ?? 0) - Number(rightCreatedAt ?? 0);
                return direction === 'desc' ? -diff : diff;
              });

            return {
              async collect() {
                return clone(matching);
              },
              async first() {
                return clone(matching[0] ?? null);
              },
              async unique() {
                return clone(matching[0] ?? null);
              },
              order(direction: 'asc' | 'desc') {
                return {
                  async collect() {
                    return clone(sortByCreatedAt(direction));
                  },
                  async first() {
                    return clone(sortByCreatedAt(direction)[0] ?? null);
                  },
                  async take(limit: number) {
                    return clone(sortByCreatedAt(direction).slice(0, limit));
                  },
                };
              },
            };
          },
        };
      },
    },
  };
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
  getVerifiedCurrentUserFromActionOrThrowMock = vi.mocked(
    accessModule.getVerifiedCurrentUserFromActionOrThrow,
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
    controlWorkspaceCoreModule,
    reviewRunsReadModelsModule,
    auditModule,
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
    import('./lib/security/control_workspace_core'),
    import('./lib/security/review_runs_read_models'),
    import('./audit'),
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
  getLatestEvidenceReportExportsByReportIdFn = coreModule.getLatestEvidenceReportExportsByReportId;
  _getSecurityPostureSummaryHandler = postureHelperModule.getSecurityPostureSummaryHandler;
  buildSecurityWorkspaceControlSummary = opsHelperModule.buildSecurityWorkspaceControlSummary;
  getSecurityControlWorkspaceRecord = controlWorkspaceCoreModule.getSecurityControlWorkspaceRecord;
  listSecurityFindingsHandler = workspaceHelperModule.listSecurityFindingsHandler;
  _listSecurityControlEvidenceActivityHandler =
    workspaceHelperModule.listSecurityControlEvidenceActivityHandler;
  renewSecurityControlEvidenceHandler = workspaceHelperModule.renewSecurityControlEvidenceHandler;
  recordBackupVerificationHandler = opsHelperModule.recordBackupVerificationHandler;
  reviewSecurityFindingHandler = workspaceHelperModule.reviewSecurityFindingHandler;
  summarizeIntegrityCheckFn = coreModule.summarizeIntegrityCheck;
  buildEvidenceReportDetailFn = reviewRunsReadModelsModule.buildEvidenceReportDetail;
  auditModuleRef = auditModule;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FILE_STORAGE_BACKEND = 'convex';
  delete process.env.AWS_REGION;
  delete process.env.AWS_AUDIT_ARCHIVE_BUCKET;
  delete process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN;
  delete process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN;
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock.mockResolvedValue({
    activeOrganizationId: 'org-1',
    authUser: {
      email: 'admin@example.com',
    },
    authSession: {
      id: 'session-1',
      impersonatedBy: null,
    },
    authUserId: 'admin-user',
  } as never);
  getVerifiedCurrentSiteAdminUserOrThrowMock.mockResolvedValue({
    activeOrganizationId: 'org-1',
    authSession: {
      id: 'session-1',
      impersonatedBy: null,
    },
    authUser: {
      email: 'admin@example.com',
    },
    authUserId: 'admin-user',
  } as never);
  getVerifiedCurrentUserFromActionOrThrowMock.mockResolvedValue({
    activeOrganizationId: 'org-1',
    authSession: {
      id: 'session-1',
      impersonatedBy: null,
    },
    authUser: {
      email: 'admin@example.com',
    },
    authUserId: 'admin-user',
    isSiteAdmin: true,
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

  it('requires a document label and URL for annual document-upload review tasks', async () => {
    const attestReviewTaskHandler = (securityReviewsModuleRef.attestReviewTask as any)._handler as (
      ctx: unknown,
      args: {
        documentLabel?: string;
        documentUrl?: string;
        documentVersion?: string;
        note?: string;
        reviewTaskId: string;
      },
    ) => Promise<null>;

    await expect(
      attestReviewTaskHandler(
        {
          db: {
            async get(id: string) {
              if (id !== 'review-task-1') {
                return null;
              }
              return {
                _id: 'review-task-1',
                controlLinks: [
                  {
                    internalControlId: 'CTRL-CA-002',
                    itemId: 'provider-assessment-plan-documented',
                  },
                ],
                freshnessWindowDays: 365,
                reviewRunId: 'review-run-1',
                taskType: 'document_upload',
                templateKey: 'annual:document:assessment-plan',
              };
            },
            query() {
              return {
                withIndex() {
                  return {
                    async collect() {
                      return [];
                    },
                    async unique() {
                      return null;
                    },
                  };
                },
              };
            },
          },
          runMutation: vi.fn(async () => null),
          runQuery: vi.fn(async () => null),
        } as never,
        {
          note: 'missing linked document',
          reviewTaskId: 'review-task-1',
        },
      ),
    ).rejects.toThrow(/require both a document label and URL/i);
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
      failure: null,
      ok: true,
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
      legalHoldActive: false,
      legalHoldId: null,
      legalHoldReason: null,
      organizationScope: 'org-1',
      retentionScopeVersion: 'temporary_artifacts_only_v1',
      reviewStatusAtExport: 'reviewed',
      rowCount: 12,
      sourceDataClassification: 'audit_evidence',
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
      legalHoldActive: false,
      legalHoldId: null,
      legalHoldReason: null,
      organizationScope: 'org-1',
      retentionScopeVersion: 'temporary_artifacts_only_v1',
      reviewStatusAtExport: 'reviewed',
      rowCount: 12,
      sourceDataClassification: 'audit_evidence',
      sourceReportId: 'report-1',
    });

    expect(left).toEqual(right);
    expect(left.schemaVersion).toContain('audit-evidence');
  });

  it('derives the latest evidence report export summary from export artifacts', async () => {
    const latestExports = await getLatestEvidenceReportExportsByReportIdFn(
      createSecurityQueryCtx({
        exportArtifacts: [
          {
            _id: 'artifact-ignore',
            artifactType: 'directory_csv',
            createdAt: 300,
            exportedAt: 300,
            exportedByUserId: 'admin-user',
            manifestHash: 'manifest-ignore',
            manifestJson: '{}',
            payloadHash: 'payload-ignore',
            schemaVersion: 'audit-evidence-v1',
            sourceReportId: 'report-1',
          },
          {
            _id: 'artifact-old',
            artifactType: 'evidence_report_export',
            createdAt: 200,
            exportedAt: 200,
            exportedByUserId: 'admin-user',
            manifestHash: 'manifest-old',
            manifestJson:
              '{"integritySummary":{"checkedAt":"2026-03-18T00:00:00.000Z","failureCount":1,"verified":false}}',
            payloadHash: 'payload-old',
            schemaVersion: 'audit-evidence-v1',
            sourceReportId: 'report-1',
          },
          {
            _id: 'artifact-new',
            artifactType: 'evidence_report_export',
            createdAt: 250,
            exportedAt: 250,
            exportedByUserId: 'admin-user',
            manifestHash: 'manifest-new',
            manifestJson:
              '{"integritySummary":{"checkedAt":"2026-03-19T00:00:00.000Z","failureCount":0,"verified":true}}',
            payloadHash: 'payload-new',
            schemaVersion: 'audit-evidence-v2',
            sourceReportId: 'report-1',
          },
        ],
      }) as never,
      ['report-1' as never, 'report-2' as never],
    );

    expect(latestExports.get('report-1' as never)).toMatchObject({
      exportHash: 'payload-new',
      exportedAt: 250,
      exportedByUserId: 'admin-user',
      id: 'artifact-new',
      manifestHash: 'manifest-new',
    });
    expect(latestExports.get('report-2' as never)).toBeUndefined();
  });

  it('builds report detail from export artifacts and tolerates malformed manifests', async () => {
    const result = await buildEvidenceReportDetailFn(
      createSecurityQueryCtx({
        evidenceReports: [
          {
            _id: 'report-1',
            _creationTime: 1,
            contentHash: 'content-hash-1',
            contentJson: '{"status":"ok"}',
            createdAt: 100,
            generatedByUserId: 'admin-user',
            organizationId: 'org-1',
            reportKind: 'audit_readiness',
            reviewStatus: 'reviewed',
            reviewedAt: null,
            reviewedByUserId: null,
            scopeId: 'provider',
            scopeType: 'provider_global',
          },
        ],
        exportArtifacts: [
          {
            _id: 'artifact-bad',
            artifactType: 'evidence_report_export',
            createdAt: 150,
            exportedAt: 150,
            exportedByUserId: 'admin-user',
            manifestHash: 'manifest-bad',
            manifestJson: '{',
            payloadHash: 'payload-bad',
            schemaVersion: 'audit-evidence-v2',
            sourceReportId: 'report-1',
          },
        ],
      }) as never,
      'report-1' as never,
    );

    expect(result).toMatchObject({
      contentHash: 'content-hash-1',
      id: 'report-1',
      latestExport: {
        exportHash: 'payload-bad',
        exportedAt: 150,
        exportedByUserId: 'admin-user',
        id: 'artifact-bad',
        integritySummary: null,
        manifestHash: 'manifest-bad',
        manifestJson: '{',
        schemaVersion: 'audit-evidence-v2',
      },
      linkedTasks: [],
      organizationId: 'org-1',
    });
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
      sourceDataset: 'auditLedgerEvents',
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

  it('surfaces metadata gaps and ledger health in the readiness snapshot', async () => {
    const previousEnv = {
      AWS_AUDIT_ARCHIVE_BUCKET: process.env.AWS_AUDIT_ARCHIVE_BUCKET,
      AWS_AUDIT_ARCHIVE_KMS_KEY_ARN: process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN,
      AWS_AUDIT_ARCHIVE_ROLE_ARN: process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN,
      AWS_REGION: process.env.AWS_REGION,
      FILE_STORAGE_BACKEND: process.env.FILE_STORAGE_BACKEND,
    };
    process.env.FILE_STORAGE_BACKEND = 's3-primary';
    process.env.AWS_REGION = 'us-west-1';
    process.env.AWS_AUDIT_ARCHIVE_BUCKET = 'audit-archive-bucket';
    process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN = 'arn:aws:kms:us-west-1:123456789012:key/audit';
    process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN = 'arn:aws:iam::123456789012:role/audit-archive';
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
        jobKind: 'attachment_purge',
        processedCount: 4,
        status: 'success',
      },
    ];
    const auditLedgerEvents = [
      {
        recordedAt: Date.parse('2026-03-18T02:00:00.000Z'),
        eventType: 'organization_policy_updated',
        id: 'gap-1',
        outcome: 'success',
        resourceId: null,
        resourceType: 'organization_policy',
        severity: 'info',
        sourceSurface: null,
      },
      {
        recordedAt: Date.parse('2026-03-18T03:00:00.000Z'),
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
    const auditLedgerState: Array<Record<string, unknown>> = [
      {
        chainId: 'primary',
        headSequence: 18,
        headEventHash: 'head-hash-1',
        updatedAt: Date.parse('2026-03-18T04:30:00.000Z'),
      },
    ];
    const auditLedgerCheckpoints: Array<Record<string, unknown>> = [
      {
        _id: 'checkpoint-ok-1',
        chainId: 'primary',
        startSequence: 1,
        endSequence: 16,
        headHash: 'head-hash-0',
        status: 'ok',
        checkedAt: Date.parse('2026-03-18T04:10:00.000Z'),
        verifiedEventCount: 16,
      },
      {
        _id: 'checkpoint-failed-1',
        chainId: 'primary',
        startSequence: 17,
        endSequence: 17,
        headHash: 'head-hash-bad',
        status: 'failed',
        checkedAt: Date.parse('2026-03-18T04:20:00.000Z'),
        verifiedEventCount: 0,
        failure: {
          actualEventHash: 'bad-hash',
          actualPreviousEventHash: 'head-hash-0',
          eventId: 'evt-17',
          expectedPreviousEventHash: 'head-hash-0',
          expectedSequence: 17,
          recomputedEventHash: 'recomputed-hash',
        },
      },
    ];
    const auditLedgerSeals: Array<Record<string, unknown>> = [
      {
        _id: 'seal-1',
        chainId: 'primary',
        startSequence: 1,
        endSequence: 16,
        eventCount: 16,
        headHash: 'head-hash-0',
        sealedAt: Date.parse('2026-03-18T04:10:00.000Z'),
      },
    ];
    const auditLedgerImmutableExports: Array<Record<string, unknown>> = [
      {
        _id: 'immutable-export-1',
        chainId: 'primary',
        startSequence: 1,
        endSequence: 16,
        headHash: 'head-hash-0',
        eventCount: 16,
        sealedAt: Date.parse('2026-03-18T04:10:00.000Z'),
        exportedAt: Date.parse('2026-03-18T04:12:00.000Z'),
        bucket: 'audit-archive-bucket',
        objectKey: 'audit-ledger/primary/000000000001-000000000016-head-hash-0.jsonl.gz',
        manifestObjectKey:
          'audit-ledger/primary/000000000001-000000000016-head-hash-0.manifest.json',
        payloadSha256: 'payload-sha',
        manifestSha256: 'manifest-sha',
      },
    ];
    const auditLedgerArchiveVerifications: Array<Record<string, unknown>> = [
      {
        _id: 'archive-verification-1',
        chainId: 'primary',
        checkedAt: Date.parse('2026-03-18T04:14:00.000Z'),
        required: true,
        configured: true,
        exporterEnabled: true,
        latestSealEndSequence: 16,
        latestExportEndSequence: 16,
        lagCount: 0,
        driftDetected: false,
        lastVerificationStatus: 'verified',
        lastVerifiedSealEndSequence: 16,
        latestManifestObjectKey:
          'audit-ledger/primary/000000000001-000000000016-head-hash-0.manifest.json',
        latestPayloadObjectKey:
          'audit-ledger/primary/000000000001-000000000016-head-hash-0.jsonl.gz',
        payloadSha256: 'payload-sha',
        manifestSha256: 'manifest-sha',
        failureReason: null,
      },
    ];
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

            let rows: Array<Record<string, unknown>>;
            if (table === 'backupVerificationReports') {
              rows = backupReports;
            } else if (table === 'retentionJobs') {
              rows = retentionJobs;
            } else if (table === 'auditLedgerEvents') {
              rows = auditLedgerEvents;
            } else if (table === 'exportArtifacts') {
              rows = exportArtifacts;
            } else if (table === 'auditLedgerState') {
              rows = auditLedgerState.filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            } else if (table === 'auditLedgerCheckpoints') {
              rows = auditLedgerCheckpoints.filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            } else if (table === 'auditLedgerSeals') {
              rows = auditLedgerSeals.filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            } else if (table === 'auditLedgerImmutableExports') {
              rows = auditLedgerImmutableExports.filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            } else if (table === 'auditLedgerArchiveVerifications') {
              rows = auditLedgerArchiveVerifications.filter((row) =>
                filters.every(([field, value]) => row[field] === value),
              );
            } else {
              throw new Error(`Unexpected query table: ${table}`);
            }

            return {
              async collect() {
                return structuredClone(rows);
              },
              order(direction: 'asc' | 'desc' = 'asc') {
                const ordered = direction === 'desc' ? [...rows].reverse() : [...rows];
                return {
                  first: async () => structuredClone(ordered[0] ?? null),
                  take: async (count: number) => structuredClone(ordered.slice(0, count)),
                };
              },
              first: async () => structuredClone(rows[0] ?? null),
            };
          },
        }),
      },
    };

    const snapshot = await getAuditReadinessSnapshotHandler(ctx as never);

    expect(snapshot.currentHead).toMatchObject({
      headHash: 'head-hash-1',
      headSequence: 18,
    });
    expect(snapshot.latestCheckpoint).toMatchObject({
      checkedAt: Date.parse('2026-03-18T04:20:00.000Z'),
      status: 'failed',
    });
    expect(snapshot.latestVerifiedCheckpoint).toMatchObject({
      checkedAt: Date.parse('2026-03-18T04:10:00.000Z'),
      endSequence: 16,
    });
    expect(snapshot.lastIntegrityFailure).toMatchObject({
      eventId: 'evt-17',
      expectedSequence: 17,
    });
    expect(snapshot.lastSealAt).toBe(Date.parse('2026-03-18T04:10:00.000Z'));
    expect(snapshot.latestImmutableExport).toMatchObject({
      endSequence: 16,
      exportedAt: Date.parse('2026-03-18T04:12:00.000Z'),
    });
    expect(snapshot.archiveStatus).toMatchObject({
      driftDetected: false,
      lastVerificationStatus: 'verified',
      latestSealEndSequence: 16,
    });
    expect(snapshot.immutableExportHealthy).toBe(true);
    expect(snapshot.immutableExportLagCount).toBe(0);
    expect(snapshot.sealCount).toBe(1);
    expect(snapshot.unverifiedTailCount).toBe(2);
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
    if (previousEnv.FILE_STORAGE_BACKEND === undefined) {
      delete process.env.FILE_STORAGE_BACKEND;
    } else {
      process.env.FILE_STORAGE_BACKEND = previousEnv.FILE_STORAGE_BACKEND;
    }
    if (previousEnv.AWS_REGION === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = previousEnv.AWS_REGION;
    }
    if (previousEnv.AWS_AUDIT_ARCHIVE_BUCKET === undefined) {
      delete process.env.AWS_AUDIT_ARCHIVE_BUCKET;
    } else {
      process.env.AWS_AUDIT_ARCHIVE_BUCKET = previousEnv.AWS_AUDIT_ARCHIVE_BUCKET;
    }
    if (previousEnv.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN === undefined) {
      delete process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN;
    } else {
      process.env.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN = previousEnv.AWS_AUDIT_ARCHIVE_KMS_KEY_ARN;
    }
    if (previousEnv.AWS_AUDIT_ARCHIVE_ROLE_ARN === undefined) {
      delete process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN;
    } else {
      process.env.AWS_AUDIT_ARCHIVE_ROLE_ARN = previousEnv.AWS_AUDIT_ARCHIVE_ROLE_ARN;
    }
  });

  it('creates an ok checkpoint and seal for a verified incremental segment', async () => {
    const eventHashPayload = JSON.stringify({
      chainId: 'primary',
      id: 'event-3',
      sequence: 3,
      eventType: 'pdf_parse_requested',
      recordedAt: 3,
      userId: null,
      actorUserId: 'user-1',
      targetUserId: null,
      organizationId: null,
      identifier: null,
      sessionId: null,
      requestId: null,
      outcome: null,
      severity: null,
      resourceType: null,
      resourceId: null,
      resourceLabel: null,
      sourceSurface: null,
      metadata: null,
      ipAddress: null,
      userAgent: null,
      previousEventHash: 'hash-2',
    });
    const eventHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(eventHashPayload),
    );
    const eventHash = Array.from(new Uint8Array(eventHashBuffer), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');

    let queryStep = 0;
    const runQuery = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      queryStep += 1;

      if (queryStep === 1) {
        return {
          chainId: 'primary',
          chainVersion: 1,
          headSequence: 3,
          headEventHash: eventHash,
          startedAt: 1,
          updatedAt: 3,
        };
      }

      if (queryStep === 2) {
        return {
          _id: 'checkpoint-ok-1',
          chainId: 'primary',
          startSequence: 1,
          endSequence: 2,
          headHash: 'hash-2',
          status: 'ok',
          checkedAt: 2,
          verifiedEventCount: 2,
        };
      }

      if (queryStep === 3) {
        return {
          _id: 'checkpoint-ok-1',
          chainId: 'primary',
          startSequence: 1,
          endSequence: 2,
          headHash: 'hash-2',
          status: 'ok',
          checkedAt: 2,
          verifiedEventCount: 2,
        };
      }

      if (queryStep === 4) {
        expect(args).toMatchObject({
          endSequence: 3,
          startSequence: 3,
        });
        return {
          continueCursor: '',
          isDone: true,
          page: [
            {
              actorUserId: 'user-1',
              chainId: 'primary',
              eventHash,
              eventType: 'pdf_parse_requested',
              id: 'event-3',
              previousEventHash: 'hash-2',
              recordedAt: 3,
              sequence: 3,
            },
          ],
        };
      }

      throw new Error(`Unexpected runQuery call at step ${queryStep}`);
    });
    const runMutation = vi.fn(async () => null);

    const verifyIntegrityHandler = (auditModuleRef.verifyAuditLedgerIntegrityInternal as any)
      ._handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<{ ok: boolean; verifiedEventCount: number }>;

    const result = await verifyIntegrityHandler(
      {
        runMutation,
        runQuery,
      } as never,
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.verifiedEventCount).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chainId: 'primary',
        endSequence: 3,
        headHash: eventHash,
        startSequence: 3,
        status: 'ok',
        verifiedEventCount: 1,
        verifiedHeadHash: eventHash,
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chainId: 'primary',
        endSequence: 3,
        eventCount: 1,
        headHash: eventHash,
        startSequence: 3,
      }),
    );
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
            if (table === 'auditLedgerCheckpoints') {
              return {
                collect: async () => [{ _id: 'checkpoint-1' }, { _id: 'checkpoint-2' }],
              };
            }
            if (table === 'auditLedgerImmutableExports') {
              return {
                order: () => ({ first: async () => ({ exportedAt: 91 }) }),
              };
            }
            if (table === 'auditLedgerEvents') {
              return {
                order: () => ({ first: async () => ({ recordedAt: 95 }) }),
              };
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
    expect(result.audit.lastImmutableExportAt).toBe(91);
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

  it('marks CA-2 complete when reviewed assessment-plan evidence is active', async () => {
    vi.useFakeTimers();
    const generatedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);
    const now = generatedAt + 7 * 24 * 60 * 60 * 1000;
    vi.setSystemTime(new Date(now));
    const { db } = createSecurityDb({
      evidence: [
        {
          _id: 'ca2-review-document-1',
          internalControlId: 'CTRL-CA-002',
          itemId: 'provider-assessment-plan-documented',
          evidenceType: 'review_document',
          title: 'Provider control assessment plan',
          url: 'https://example.com/policies/assessment-plan.pdf',
          sufficiency: 'sufficient',
          source: 'review_document',
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

    const record = await getSecurityControlWorkspaceRecord({ db } as never, 'CTRL-CA-002');

    expect(record?.support).toBe('complete');
    expect(
      record?.platformChecklist.find(
        (item) => item.itemId === 'provider-assessment-plan-documented',
      )?.support,
    ).toBe('complete');
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

            if (table === 'auditLedgerCheckpoints') {
              const statusFilter = filters.find(([field]) => field === 'status')?.[1];
              return {
                collect: async () =>
                  statusFilter === 'failed'
                    ? [{ _id: 'audit-failure-1' }]
                    : [{ _id: 'audit-ok-1' }],
                order: () => ({
                  first: async () =>
                    statusFilter === 'failed'
                      ? {
                          _id: 'audit-failure-1',
                          checkedAt: 95,
                          endSequence: 4,
                        }
                      : {
                          _id: 'audit-ok-1',
                          checkedAt: 94,
                          endSequence: 5,
                        },
                }),
              };
            }

            if (table === 'auditLedgerState') {
              return {
                first: async () => ({
                  chainId: 'primary',
                  headSequence: 5,
                  updatedAt: 95,
                }),
              };
            }

            if (table === 'auditLedgerSeals') {
              return {
                order: () => ({
                  first: async () => ({
                    _id: 'seal-1',
                    chainId: 'primary',
                    endSequence: 5,
                    headHash: 'head-hash-1',
                    sealedAt: 94,
                  }),
                }),
              };
            }

            if (table === 'auditLedgerImmutableExports') {
              return {
                order: () => ({
                  first: async () => ({
                    _id: 'immutable-export-1',
                    chainId: 'primary',
                    endSequence: 5,
                    headHash: 'head-hash-1',
                    exportedAt: 95,
                    manifestObjectKey: 'manifest-1',
                    objectKey: 'payload-1',
                  }),
                }),
              };
            }

            if (table === 'auditLedgerArchiveVerifications') {
              const statusFilter = filters.find(
                ([field]) => field === 'lastVerificationStatus',
              )?.[1];
              return {
                order: () => ({
                  first: async () =>
                    statusFilter === 'verified'
                      ? {
                          _id: 'archive-verification-ok-1',
                          checkedAt: 95,
                          lastVerifiedSealEndSequence: 5,
                        }
                      : {
                          _id: 'archive-verification-1',
                          checkedAt: 95,
                          driftDetected: false,
                          exporterEnabled: true,
                          failureReason: null,
                          lagCount: 0,
                          lastVerificationStatus: 'verified',
                          latestExportEndSequence: 5,
                          latestSealEndSequence: 5,
                          required: true,
                        },
                }),
              };
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

            if (table === 'auditLedgerEvents') {
              return {
                order: () => ({
                  take: async () => [
                    {
                      id: 'audit-gap-1',
                      eventType: 'evidence_report_exported',
                      recordedAt: 96,
                      requestId: null,
                      ipAddress: '203.0.113.10',
                      userAgent: 'Vitest',
                    },
                  ],
                }),
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

            if (table === 'securityRelationships') {
              return {
                collect: async () => [],
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
    expect(
      result.some(
        (finding: (typeof result)[number]) => finding.findingKey === 'audit_request_context_gaps',
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

            if (table === 'securityRelationships') {
              return {
                collect: async () => [],
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

            if (table === 'auditLedgerCheckpoints') {
              return {
                collect: async () => [],
                order: () => ({ first: async () => null }),
              };
            }

            if (table === 'auditLedgerState') {
              return {
                first: async () => ({
                  chainId: 'primary',
                  headSequence: 0,
                  updatedAt: 95,
                }),
              };
            }

            if (table === 'auditLedgerSeals') {
              return {
                order: () => ({ first: async () => null }),
              };
            }

            if (table === 'auditLedgerImmutableExports') {
              return {
                order: () => ({ first: async () => null }),
              };
            }

            if (table === 'auditLedgerArchiveVerifications') {
              return {
                order: () => ({ first: async () => null }),
              };
            }

            if (table === 'auditLedgerEvents') {
              return {
                order: () => ({
                  take: async () => [],
                }),
              };
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

            if (table === 'securityRelationships') {
              return {
                collect: async () => [],
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
          sourceDataset: 'auditLedgerEvents',
          status: 'success',
          targetEnvironment: 'test',
          verificationMethod: 'checksum-compare',
        },
        latestRetentionJob: {
          createdAt: Date.parse('2026-03-18T12:00:00.000Z'),
          details: 'ok',
          jobKind: 'attachment_purge',
          processedCount: 2,
          status: 'success',
        },
        archiveStatus: {
          configured: true,
          driftDetected: false,
          exporterEnabled: true,
          failureReason: null,
          lagCount: 0,
          lastVerifiedAt: Date.parse('2026-03-18T14:54:00.000Z'),
          lastVerifiedSealEndSequence: 18,
          lastVerificationStatus: 'verified',
          latestManifestObjectKey: 'manifest-1',
          latestPayloadObjectKey: 'payload-1',
          latestSealEndSequence: 18,
          required: true,
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
      failure: { eventId: 'failure-1' },
      ok: false,
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
      {
        reportKind: 'audit_readiness',
        requestContext: {
          requestId: 'req-123',
          ipAddress: '203.0.113.9',
          userAgent: 'Vitest',
        },
      },
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
      ipAddress: '203.0.113.9',
      requestId: 'req-123',
      resourceId: 'report-1',
      resourceLabel: 'audit_readiness',
      userAgent: 'Vitest',
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
    const runQuery = vi.fn(async (_ref: unknown, args?: Record<string, unknown>) => {
      if (args?.requirement === 'organization_admin') {
        return {
          consumedAt: null,
          expiresAt: Date.parse('2026-03-18T16:10:00.000Z'),
          method: 'totp',
          requirement: 'organization_admin',
          sessionId: 'session-1',
          verifiedAt: Date.parse('2026-03-18T15:58:00.000Z'),
        };
      }

      if (args?.resourceType === 'evidence_report_export') {
        return {
          allowed: true,
          legalHoldActive: true,
          legalHoldId: 'hold-1',
          legalHoldReason: 'Preserve records',
          normalizedLegalHoldReason: 'active_legal_hold',
          operation: 'export',
          resourceId: 'report-1',
          resourceType: 'evidence_report_export',
          retentionScopeVersion: 'full_phi_record_set_v2',
        };
      }

      return reportRecord;
    });
    const runAction = vi.fn(async () => ({
      checkedAt: Date.parse('2026-03-18T15:59:00.000Z'),
      failures: [{ id: 'failure-1' }],
      limit: 250,
      verified: false,
    }));
    const runMutation = vi.fn().mockResolvedValueOnce('artifact-1').mockResolvedValueOnce(null);

    const result = await exportEvidenceReportHandler(
      {
        runAction,
        runMutation,
        runQuery,
      } as never,
      {
        id: 'report-1' as never,
        requestContext: {
          requestId: 'req-123',
          ipAddress: '203.0.113.9',
          userAgent: 'Vitest',
        },
      },
    );

    expect(result).toMatchObject({
      id: 'report-1',
      latestExport: {
        exportHash: expect.any(String),
        exportedAt: Date.parse('2026-03-18T16:00:00.000Z'),
        exportedByUserId: 'admin-user',
        id: 'artifact-1',
        manifestHash: expect.any(String),
      },
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
    expect(exportArtifactArgs).not.toHaveProperty('payloadJson');
    const manifest = JSON.parse(exportArtifactArgs.manifestJson as string) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      actorUserId: 'admin-user',
      contentHash: 'content-hash',
      exportId: '00000000-0000-4000-8000-000000000123',
      legalHoldActive: true,
      legalHoldId: 'hold-1',
      legalHoldReason: 'active_legal_hold',
      organizationScope: 'org-1',
      retentionScopeVersion: 'full_phi_record_set_v2',
      reviewStatusAtExport: 'reviewed',
      rowCount: 1,
      sourceDataClassification: 'phi_record_set',
      sourceReportId: 'report-1',
    });
    expect(manifest.exactFilters).toMatchObject({
      reportId: 'report-1',
      reportKind: 'audit_readiness',
    });
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      eventType: 'evidence_report_exported',
      ipAddress: '203.0.113.9',
      metadata: expect.stringContaining('"legalHoldActive": true'),
      requestId: 'req-123',
      resourceId: 'report-1',
      resourceLabel: 'audit_readiness',
      userAgent: 'Vitest',
    });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('requires a fresh privileged session before reviewing an evidence report', async () => {
    const handler = (
      securityReportsModuleRef.reviewEvidenceReport as unknown as {
        _handler: Function;
      }
    )._handler as (
      ctx: {
        db: {
          get: ReturnType<typeof vi.fn>;
        };
        runQuery: ReturnType<typeof vi.fn>;
      },
      args: {
        customerSummary?: string;
        id: string;
        internalNotes?: string;
        reviewStatus: 'reviewed' | 'needs_follow_up';
      },
    ) => Promise<unknown>;

    const dbGet = vi.fn();
    const runQuery = vi.fn().mockResolvedValue(null);

    await expect(
      handler(
        {
          db: {
            get: dbGet,
          },
          runQuery,
        },
        {
          id: 'report-1',
          reviewStatus: 'reviewed',
        },
      ),
    ).rejects.toThrow('Step-up authentication is required to review evidence reports.');
    expect(dbGet).not.toHaveBeenCalled();
  });

  it('records an audited event when the global audit ledger export runs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T18:00:00.000Z'));
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000999',
    );

    const handler = (
      auditModuleRef.exportAuditLedgerJsonl as unknown as {
        _handler: Function;
      }
    )._handler as (
      ctx: {
        runMutation: ReturnType<typeof vi.fn>;
        runQuery: ReturnType<typeof vi.fn>;
      },
      args: {
        organizationId?: string;
        outcome?: 'success' | 'failure';
        resourceType?: string;
        severity?: 'info' | 'warning' | 'critical';
        sourceSurface?: string;
      },
    ) => Promise<{
      filename: string;
      jsonl: string;
      manifest: {
        chainId: string;
        chainVersion: number;
        exportedAt: number;
        firstSequence: number | null;
        headHash: string | null;
        lastSequence: number | null;
        rowCount: number;
      };
    }>;

    const runQuery = vi.fn(async (_ref: unknown, args?: Record<string, unknown>) => {
      if (args?.requirement === 'audit_export') {
        return {
          consumedAt: null,
          expiresAt: Date.parse('2026-03-18T18:10:00.000Z'),
          method: 'totp',
          requirement: 'audit_export',
          sessionId: 'session-1',
          verifiedAt: Date.parse('2026-03-18T17:58:00.000Z'),
        };
      }

      if (args?.limit === 100) {
        return {
          continueCursor: null,
          events: [
            {
              eventType: 'audit_ledger_viewed',
              sequence: 7,
            },
          ],
          isDone: true,
          limit: 100,
        };
      }

      return {
        chainVersion: 1,
        headEventHash: 'head-hash',
      };
    });
    const runMutation = vi.fn().mockResolvedValue(null);

    const result = await handler(
      {
        runMutation,
        runQuery,
      },
      {
        organizationId: 'org-1',
        outcome: 'success',
      },
    );

    expect(result).toMatchObject({
      filename: 'security-audit-events-2026-03-18.jsonl',
      manifest: {
        chainId: 'primary',
        exportedAt: Date.parse('2026-03-18T18:00:00.000Z'),
        firstSequence: 7,
        headHash: 'head-hash',
        lastSequence: 7,
        rowCount: 1,
      },
    });
    expect(runMutation).toHaveBeenCalledWith(anyApi.audit.appendAuditLedgerEventInternal, {
      actorUserId: 'admin-user',
      eventType: 'audit_log_exported',
      metadata: expect.stringContaining('"scope":"org-1"'),
      organizationId: 'org-1',
      outcome: 'success',
      provenance: expect.objectContaining({
        actorUserId: 'admin-user',
        emitter: 'audit.ledger_export',
        kind: 'site_admin',
      }),
      resourceId: 'org-1',
      resourceLabel: 'security-audit-events',
      resourceType: 'audit_export',
      severity: 'info',
      sessionId: 'session-1',
      sourceSurface: 'admin.audit_ledger_export',
      userId: 'admin-user',
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
