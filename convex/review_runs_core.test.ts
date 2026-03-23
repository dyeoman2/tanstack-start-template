import { describe, expect, it, vi } from 'vitest';
import { applyReviewTaskState } from './lib/security/review_runs_core';

type DocId = string;

type ReviewTableMap = {
  reviewRuns: Map<DocId, Record<string, unknown>>;
  reviewTasks: Map<DocId, Record<string, unknown>>;
  reviewTaskResults: Map<DocId, Record<string, unknown>>;
  reviewTaskEvidenceLinks: Map<DocId, Record<string, unknown>>;
  reviewAttestations: Map<DocId, Record<string, unknown>>;
  securityControlEvidence: Map<DocId, Record<string, unknown>>;
  securityControlEvidenceActivity: Map<DocId, Record<string, unknown>>;
  securityFindings: Map<DocId, Record<string, unknown>>;
  securityMetrics: Map<DocId, Record<string, unknown>>;
  securityRelationships: Map<DocId, Record<string, unknown>>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createReviewMutationCtx(
  seed?: Partial<Record<keyof ReviewTableMap, Record<string, unknown>[]>>,
) {
  const tables: ReviewTableMap = {
    reviewRuns: new Map((seed?.reviewRuns ?? []).map((doc) => [doc._id as string, clone(doc)])),
    reviewTasks: new Map((seed?.reviewTasks ?? []).map((doc) => [doc._id as string, clone(doc)])),
    reviewTaskResults: new Map(
      (seed?.reviewTaskResults ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    reviewTaskEvidenceLinks: new Map(
      (seed?.reviewTaskEvidenceLinks ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    reviewAttestations: new Map(
      (seed?.reviewAttestations ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityControlEvidence: new Map(
      (seed?.securityControlEvidence ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityControlEvidenceActivity: new Map(
      (seed?.securityControlEvidenceActivity ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityFindings: new Map(
      (seed?.securityFindings ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityMetrics: new Map(
      (seed?.securityMetrics ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityRelationships: new Map(
      (seed?.securityRelationships ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
  };
  let insertCounter = 0;

  const listRows = (table: string) => {
    const rows = table in tables ? [...tables[table as keyof ReviewTableMap].values()] : [];
    return rows.map((row) => clone(row));
  };

  const db = {
    async get(id: string) {
      for (const table of Object.values(tables)) {
        const row = table.get(id);
        if (row) {
          return clone(row);
        }
      }
      return null;
    },
    async insert(table: keyof ReviewTableMap, value: Record<string, unknown>) {
      insertCounter += 1;
      const id = `${table}-${insertCounter}`;
      tables[table].set(id, { _id: id, ...clone(value) });
      return id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      for (const table of Object.values(tables)) {
        const row = table.get(id);
        if (!row) {
          continue;
        }
        table.set(id, { ...row, ...clone(value) });
        return;
      }
      throw new Error(`Missing document for patch: ${id}`);
    },
    query(table: string) {
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
          const matching = listRows(table).filter((doc) =>
            filters.every(([field, expected]) => doc[field] === expected),
          );
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
            order() {
              return {
                async collect() {
                  return clone(matching);
                },
                async first() {
                  return clone(matching[0] ?? null);
                },
                async take(count: number) {
                  return clone(matching.slice(0, count));
                },
              };
            },
          };
        },
        async collect() {
          return listRows(table);
        },
      };
    },
  };

  return {
    ctx: {
      db,
      runMutation: vi.fn(async () => null),
    },
    tables,
  };
}

function buildBaseSeed(overrides?: {
  attestation?: Record<string, unknown>;
  reviewTaskEvidenceLinks?: Record<string, unknown>[];
  securityControlEvidence?: Record<string, unknown>[];
}) {
  return {
    reviewRuns: [
      {
        _id: 'review-run-1',
        kind: 'annual',
        status: 'ready',
        title: 'Annual Security Review 2026',
        runKey: 'annual:2026',
      },
    ],
    reviewTasks: [
      {
        _id: 'review-task-1',
        allowException: true,
        controlLinks: [
          {
            internalControlId: 'CTRL-AC-002',
            itemId: 'collect-access-review-evidence',
          },
        ],
        latestAttestationId: overrides?.attestation?._id,
        latestEvidenceLinkedAt: null,
        latestNote: null,
        latestResultId: null,
        reviewRunId: 'review-run-1',
        satisfiedAt: null,
        satisfiedThroughAt: null,
        status: 'ready',
        taskType: 'attestation',
        templateKey: 'access-review',
        title: 'Access review attested',
        updatedAt: Date.parse('2026-03-23T00:00:00.000Z'),
      },
    ],
    reviewAttestations: overrides?.attestation ? [overrides.attestation] : [],
    reviewTaskEvidenceLinks: overrides?.reviewTaskEvidenceLinks ?? [],
    securityControlEvidence: overrides?.securityControlEvidence ?? [],
  };
}

describe('review outcome evidence materialization', () => {
  it('creates a typed evidence artifact for attestation outcomes', async () => {
    const { ctx, tables } = createReviewMutationCtx(
      buildBaseSeed({
        attestation: {
          _id: 'attestation-1',
          documentLabel: 'Annual access review packet',
          documentUrl: 'https://example.com/reports/access-review.pdf',
          statementText: 'Reviewed and approved.',
        },
        reviewTaskEvidenceLinks: [
          {
            _id: 'task-link-1',
            reviewRunId: 'review-run-1',
            reviewTaskId: 'review-task-1',
            role: 'primary',
            sourceId: 'report-1',
            sourceLabel: 'Annual review packet',
            sourceType: 'evidence_report',
          },
        ],
      }),
    );

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      latestAttestationId: 'attestation-1' as never,
      mode: 'attestation',
      note: 'Completed during annual review.',
      resultType: 'attested',
      reviewTaskId: 'review-task-1' as never,
      satisfiedAt: Date.parse('2026-03-23T10:00:00.000Z'),
      satisfiedThroughAt: Date.parse('2027-03-23T10:00:00.000Z'),
      status: 'completed',
    });

    const evidenceRows = [...tables.securityControlEvidence.values()];
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      evidenceType: 'review_attestation',
      internalControlId: 'CTRL-AC-002',
      itemId: 'collect-access-review-evidence',
      reviewOriginReviewAttestationId: 'attestation-1',
      reviewOriginReviewRunId: 'review-run-1',
      reviewOriginReviewTaskId: 'review-task-1',
      reviewOriginSourceId: 'report-1',
      reviewOriginSourceLabel: 'Annual review packet',
      reviewOriginSourceType: 'evidence_report',
      reviewStatus: 'reviewed',
      source: 'review_attestation',
      sufficiency: 'sufficient',
    });
    expect([...tables.securityControlEvidenceActivity.values()]).toHaveLength(1);
  });

  it('supersedes prior review-origin evidence when the same task is rerun', async () => {
    const { ctx, tables } = createReviewMutationCtx(buildBaseSeed());

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      mode: 'automated_check',
      resultType: 'automated_check',
      reviewTaskId: 'review-task-1' as never,
      satisfiedAt: Date.parse('2026-03-23T09:00:00.000Z'),
      satisfiedThroughAt: Date.parse('2026-06-23T09:00:00.000Z'),
      status: 'completed',
    });

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      mode: 'automated_check',
      resultType: 'automated_check',
      reviewTaskId: 'review-task-1' as never,
      satisfiedAt: Date.parse('2026-03-24T09:00:00.000Z'),
      satisfiedThroughAt: Date.parse('2026-06-24T09:00:00.000Z'),
      status: 'completed',
    });

    const evidenceRows = [...tables.securityControlEvidence.values()];
    expect(evidenceRows).toHaveLength(2);
    const supersededEvidence = evidenceRows.find((entry) => entry.lifecycleStatus === 'superseded');
    const activeEvidence = evidenceRows.find((entry) => entry.lifecycleStatus === 'active');
    expect(supersededEvidence).toMatchObject({
      lifecycleStatus: 'superseded',
      replacedByEvidenceId: activeEvidence?._id,
    });
    expect(activeEvidence).toMatchObject({
      evidenceType: 'automated_review_result',
      lifecycleStatus: 'active',
      reviewOriginReviewTaskId: 'review-task-1',
    });
  });

  it('archives existing review-origin evidence when the task becomes blocked', async () => {
    const { ctx, tables } = createReviewMutationCtx(buildBaseSeed());

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      mode: 'automated_check',
      resultType: 'automated_check',
      reviewTaskId: 'review-task-1' as never,
      satisfiedAt: Date.parse('2026-03-23T09:00:00.000Z'),
      satisfiedThroughAt: Date.parse('2026-06-23T09:00:00.000Z'),
      status: 'completed',
    });

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      mode: 'automated_check',
      note: 'Report fell out of compliance.',
      resultType: 'automated_check',
      reviewTaskId: 'review-task-1' as never,
      satisfiedAt: null,
      satisfiedThroughAt: null,
      status: 'blocked',
    });

    const evidenceRows = [...tables.securityControlEvidence.values()];
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      lifecycleStatus: 'superseded',
      reviewOriginReviewTaskId: 'review-task-1',
    });
  });
});
