import { describe, expect, it, vi } from 'vitest';
import { SECURITY_POLICY_CATALOG } from '../src/lib/shared/compliance/security-policies';
import {
  applyReviewTaskState,
  buildReviewRunDetail,
  syncAnnualPolicyReviewTasks,
  upsertAnnualReviewTasks,
} from './lib/security/review_runs_core';

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
  securityPolicies: Map<DocId, Record<string, unknown>>;
  securityPolicyControlMappings: Map<DocId, Record<string, unknown>>;
  securityVendorControlMappings: Map<DocId, Record<string, unknown>>;
  securityVendors: Map<DocId, Record<string, unknown>>;
  securityControlChecklistItems: Map<DocId, Record<string, unknown>>;
  userProfiles: Map<DocId, Record<string, unknown>>;
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
    securityPolicies: new Map(
      (seed?.securityPolicies ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityPolicyControlMappings: new Map(
      (seed?.securityPolicyControlMappings ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityVendorControlMappings: new Map(
      (seed?.securityVendorControlMappings ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityVendors: new Map(
      (seed?.securityVendors ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityControlChecklistItems: new Map(
      (seed?.securityControlChecklistItems ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    userProfiles: new Map((seed?.userProfiles ?? []).map((doc) => [doc._id as string, clone(doc)])),
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
    async delete(id: string) {
      for (const table of Object.values(tables)) {
        if (table.delete(id)) {
          return;
        }
      }
      throw new Error(`Missing document for delete: ${id}`);
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

function buildPolicySeedRows() {
  const now = Date.parse('2026-03-23T00:00:00.000Z');
  return SECURITY_POLICY_CATALOG.map((policy, index) => ({
    _id: `policy-${index + 1}`,
    policyId: policy.policyId,
    title: policy.title,
    summary: policy.summary,
    owner: policy.owner,
    sourcePath: policy.sourcePath,
    contentHash: `hash-${policy.policyId}`,
    lastReviewedAt: now,
    nextReviewAt: now + 365 * 24 * 60 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    scopeId: 'provider',
    scopeType: 'provider_global',
  }));
}

function buildPolicyMappingSeedRows() {
  const now = Date.parse('2026-03-23T00:00:00.000Z');
  return SECURITY_POLICY_CATALOG.flatMap((policy) =>
    policy.mappings.map((mapping, index) => ({
      _id: `${policy.policyId}-mapping-${index + 1}`,
      createdAt: now,
      internalControlId: mapping.internalControlId,
      isPrimary: mapping.isPrimary,
      policyId: policy.policyId,
      scopeId: 'provider',
      scopeType: 'provider_global',
      updatedAt: now,
    })),
  );
}

function buildBaseSeed(overrides?: {
  attestation?: Record<string, unknown>;
  reviewTaskEvidenceLinks?: Record<string, unknown>[];
  securityControlEvidence?: Record<string, unknown>[];
}): {
  reviewAttestations: Record<string, unknown>[];
  reviewRuns: Record<string, unknown>[];
  reviewTaskEvidenceLinks: Record<string, unknown>[];
  reviewTasks: Record<string, unknown>[];
  securityControlEvidence: Record<string, unknown>[];
} {
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

  it('creates a typed evidence artifact for document-upload outcomes', async () => {
    const seed = buildBaseSeed({
      attestation: {
        _id: 'attestation-1',
        documentLabel: 'Provider control assessment plan',
        documentUrl: 'https://example.com/policies/assessment-plan.pdf',
        documentVersion: '2026.03',
        statementText: 'Linked current assessment plan.',
      },
      reviewTaskEvidenceLinks: [
        {
          _id: 'task-link-1',
          reviewRunId: 'review-run-1',
          reviewTaskId: 'review-task-1',
          role: 'primary',
          sourceId: 'https://example.com/policies/assessment-plan.pdf',
          sourceLabel: 'Provider control assessment plan',
          sourceType: 'external_document',
        },
      ],
    });
    seed.reviewTasks = [
      {
        ...seed.reviewTasks[0],
        controlLinks: [
          {
            internalControlId: 'CTRL-CA-002',
            itemId: 'provider-assessment-plan-documented',
          },
        ],
        taskType: 'document_upload',
        templateKey: 'annual:document:assessment-plan',
        title: 'Control assessment plan linked',
      },
    ];
    const { ctx, tables } = createReviewMutationCtx(seed);

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      latestAttestationId: 'attestation-1' as never,
      mode: 'document_upload',
      note: 'Linked current approved document.',
      resultType: 'document_linked',
      reviewTaskId: 'review-task-1' as never,
      satisfiedAt: Date.parse('2026-03-23T10:00:00.000Z'),
      satisfiedThroughAt: Date.parse('2027-03-23T10:00:00.000Z'),
      status: 'completed',
    });

    const evidenceRows = [...tables.securityControlEvidence.values()];
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]).toMatchObject({
      evidenceType: 'review_document',
      internalControlId: 'CTRL-CA-002',
      itemId: 'provider-assessment-plan-documented',
      reviewOriginReviewAttestationId: 'attestation-1',
      reviewOriginReviewRunId: 'review-run-1',
      reviewOriginReviewTaskId: 'review-task-1',
      reviewOriginSourceId: 'https://example.com/policies/assessment-plan.pdf',
      reviewOriginSourceLabel: 'Provider control assessment plan',
      reviewOriginSourceType: 'external_document',
      reviewStatus: 'reviewed',
      source: 'review_document',
      sufficiency: 'sufficient',
      title: 'Provider control assessment plan',
      url: 'https://example.com/policies/assessment-plan.pdf',
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

  it('does not create checklist or control evidence for policy attestation tasks', async () => {
    const seed = buildBaseSeed();
    seed.reviewTasks = [
      {
        ...seed.reviewTasks[0],
        _id: 'review-task-policy-1',
        controlLinks: [],
        policyId: 'access-control',
        templateKey: 'annual:attest:policy:access-control',
        title: 'Access Control Policy reviewed',
      },
    ];
    const { ctx, tables } = createReviewMutationCtx(seed);

    await applyReviewTaskState(ctx as never, {
      actorUserId: 'admin-user',
      mode: 'attestation',
      resultType: 'attested',
      reviewTaskId: 'review-task-policy-1' as never,
      satisfiedAt: Date.parse('2026-03-23T09:00:00.000Z'),
      satisfiedThroughAt: Date.parse('2027-03-23T09:00:00.000Z'),
      status: 'completed',
    });

    expect([...tables.securityControlEvidence.values()]).toHaveLength(0);
    expect([...tables.securityControlEvidenceActivity.values()]).toHaveLength(0);
  });
});

describe('policy review orchestration contracts', () => {
  it('creates annual document-upload tasks for procedure-backed controls', async () => {
    const { ctx, tables } = createReviewMutationCtx({
      reviewRuns: [
        {
          _id: 'review-run-1',
          createdAt: Date.parse('2026-03-23T00:00:00.000Z'),
          kind: 'annual',
          runKey: 'annual:2026',
          scopeId: 'provider',
          scopeType: 'provider_global',
          snapshotHash: 'snapshot-hash',
          snapshotJson: '{}',
          status: 'ready',
          title: 'Annual Security Review 2026',
          updatedAt: Date.parse('2026-03-23T00:00:00.000Z'),
          year: 2026,
        },
      ],
      securityPolicies: buildPolicySeedRows(),
    });

    await upsertAnnualReviewTasks(ctx as never, 'review-run-1' as never);

    const taskByTemplateKey = new Map(
      [...tables.reviewTasks.values()].map((task) => [String(task.templateKey), task] as const),
    );

    expect(taskByTemplateKey.get('annual:document:assessment-plan')).toMatchObject({
      controlLinks: [
        {
          internalControlId: 'CTRL-CA-002',
          itemId: 'provider-assessment-plan-documented',
        },
      ],
      required: true,
      taskType: 'document_upload',
      title: 'Control assessment plan linked',
    });
    expect(taskByTemplateKey.get('annual:document:baseline-review-procedure')).toMatchObject({
      taskType: 'document_upload',
      title: 'Baseline review procedure linked',
    });
    expect(
      taskByTemplateKey.get('annual:document:change-approval-and-rollback-procedure'),
    ).toMatchObject({
      taskType: 'document_upload',
      title: 'Change approval and rollback procedure linked',
    });
    expect(
      taskByTemplateKey.get('annual:document:component-inventory-review-procedure'),
    ).toMatchObject({
      taskType: 'document_upload',
      title: 'Component inventory review procedure linked',
    });
    expect(taskByTemplateKey.get('annual:document:security-planning-artifact')).toMatchObject({
      taskType: 'document_upload',
      title: 'Security planning artifact linked',
    });
    expect(taskByTemplateKey.get('annual:document:unsupported-component-procedure')).toMatchObject({
      taskType: 'document_upload',
      title: 'Unsupported-component procedure linked',
    });
    expect(taskByTemplateKey.get('annual:document:cryptography-standards')).toMatchObject({
      taskType: 'document_upload',
      title: 'Cryptography standards artifact linked',
    });
  });

  it('creates deterministic attestation tasks for policies and removes stale policy tasks', async () => {
    const staleTemplateKey = 'annual:attest:policy:retired-policy';
    const { ctx, tables } = createReviewMutationCtx({
      reviewTasks: [
        {
          _id: 'policy-task-existing',
          allowException: false,
          controlLinks: [],
          description: 'Old policy description',
          freshnessWindowDays: 90,
          latestAttestationId: null,
          latestEvidenceLinkedAt: null,
          latestNote: null,
          latestResultId: null,
          policyId: 'access-control',
          required: true,
          reviewRunId: 'review-run-1',
          satisfiedAt: null,
          satisfiedThroughAt: null,
          status: 'ready',
          taskType: 'attestation',
          templateKey: 'annual:attest:policy:access-control',
          title: 'Old access title',
          updatedAt: Date.parse('2026-03-22T00:00:00.000Z'),
        },
        {
          _id: 'policy-task-stale',
          allowException: false,
          controlLinks: [],
          description: 'Retired policy',
          freshnessWindowDays: 365,
          latestAttestationId: null,
          latestEvidenceLinkedAt: null,
          latestNote: null,
          latestResultId: null,
          policyId: 'retired-policy',
          required: true,
          reviewRunId: 'review-run-1',
          satisfiedAt: null,
          satisfiedThroughAt: null,
          status: 'ready',
          taskType: 'attestation',
          templateKey: staleTemplateKey,
          title: 'Retired policy reviewed',
          updatedAt: Date.parse('2026-03-22T00:00:00.000Z'),
        },
      ],
      securityPolicies: buildPolicySeedRows(),
    });

    const existingTasks = [...tables.reviewTasks.values()];
    const existingByTemplateKey = new Map(
      existingTasks.map((task) => [String(task.templateKey), task] as const),
    );

    await syncAnnualPolicyReviewTasks(ctx as never, {
      existingByTemplateKey: existingByTemplateKey as never,
      existingTasks: existingTasks as never,
      reviewRunId: 'review-run-1' as never,
    });

    const accessTask = [...tables.reviewTasks.values()].find(
      (task) => task.templateKey === 'annual:attest:policy:access-control',
    );
    expect(accessTask).toMatchObject({
      controlLinks: [],
      policyId: 'access-control',
      required: true,
      taskType: 'attestation',
      templateKey: 'annual:attest:policy:access-control',
    });
    expect(accessTask?.title).toBe('Access Control Policy reviewed');
    expect(accessTask?.description).toContain('Access Control Policy');
    expect(
      [...tables.reviewTasks.values()].some((task) => task.templateKey === staleTemplateKey),
    ).toBe(false);
  });

  it('builds review detail with policy context for policy tasks and none for non-policy tasks', async () => {
    const annualRunId = 'review-run-1';
    const policyRow = buildPolicySeedRows().find((policy) => policy.policyId === 'access-control');
    expect(policyRow).toBeTruthy();
    const policyMappings = buildPolicyMappingSeedRows().filter(
      (mapping) => mapping.policyId === 'access-control',
    );
    const policyTaskId = 'review-task-policy-1';
    const nonPolicyTaskId = 'review-task-control-1';
    const primaryMappedControl = policyMappings[0]?.internalControlId;
    expect(primaryMappedControl).toBeTruthy();

    const { ctx } = createReviewMutationCtx({
      reviewRuns: [
        {
          _id: annualRunId,
          createdAt: Date.parse('2026-03-23T00:00:00.000Z'),
          kind: 'annual',
          runKey: 'annual:2026',
          scopeId: 'provider',
          scopeType: 'provider_global',
          snapshotHash: 'snapshot-hash',
          snapshotJson: '{}',
          status: 'ready',
          title: 'Annual Security Review 2026',
          updatedAt: Date.parse('2026-03-23T00:00:00.000Z'),
          year: 2026,
        },
      ],
      reviewTasks: [
        {
          _id: nonPolicyTaskId,
          allowException: true,
          controlLinks: [
            {
              internalControlId: primaryMappedControl,
              itemId: 'provider-review-procedure',
            },
          ],
          description: 'Review supporting control evidence.',
          freshnessWindowDays: 365,
          latestAttestationId: null,
          latestEvidenceLinkedAt: null,
          latestNote: null,
          latestResultId: null,
          required: true,
          reviewRunId: annualRunId,
          satisfiedAt: null,
          satisfiedThroughAt: null,
          status: 'ready',
          taskType: 'attestation',
          templateKey: 'annual:attest:control-check',
          title: 'Control reviewed',
          updatedAt: Date.parse('2026-03-23T00:00:00.000Z'),
        },
        {
          _id: policyTaskId,
          allowException: false,
          controlLinks: [],
          description: 'Review policy markdown.',
          freshnessWindowDays: 365,
          latestAttestationId: null,
          latestEvidenceLinkedAt: null,
          latestNote: null,
          latestResultId: null,
          policyId: 'access-control',
          required: true,
          reviewRunId: annualRunId,
          satisfiedAt: null,
          satisfiedThroughAt: null,
          status: 'ready',
          taskType: 'attestation',
          templateKey: 'annual:attest:policy:access-control',
          title: 'Access Control Policy reviewed',
          updatedAt: Date.parse('2026-03-23T00:00:00.000Z'),
        },
      ],
      securityPolicies: policyRow ? [policyRow] : [],
      securityPolicyControlMappings: policyMappings,
    });

    const detail = await buildReviewRunDetail(ctx as never, annualRunId as never);

    expect(detail).not.toBeNull();
    const policyTask = detail?.tasks.find((task) => task.id === policyTaskId);
    expect(policyTask?.policy).toMatchObject({
      policyId: 'access-control',
      sourcePath: policyRow?.sourcePath,
      title: 'Access Control Policy',
    });
    expect(policyTask?.policyControls.length).toBeGreaterThan(0);
    expect(policyTask?.policyControls[0]?.internalControlId).toBe(primaryMappedControl);

    const nonPolicyTask = detail?.tasks.find((task) => task.id === nonPolicyTaskId);
    expect(nonPolicyTask?.policy).toBeNull();
    expect(nonPolicyTask?.policyControls).toEqual([]);
  });
});
