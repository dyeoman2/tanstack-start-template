import { describe, expect, it } from 'vitest';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';
import { SECURITY_POLICY_CATALOG } from '../src/lib/shared/compliance/security-policies';
import {
  resolvePolicySupport,
  syncSecurityPoliciesFromCatalog,
} from './lib/security/policies_core';
import { buildPolicyReviewDatePatch } from './securityReviews';

type DocId = string;

type PolicyTableMap = {
  securityPolicies: Map<DocId, Record<string, unknown>>;
  securityPolicyControlMappings: Map<DocId, Record<string, unknown>>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createPolicyMutationCtx(
  seed?: Partial<Record<keyof PolicyTableMap, Record<string, unknown>[]>>,
) {
  const tables: PolicyTableMap = {
    securityPolicies: new Map(
      (seed?.securityPolicies ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
    securityPolicyControlMappings: new Map(
      (seed?.securityPolicyControlMappings ?? []).map((doc) => [doc._id as string, clone(doc)]),
    ),
  };
  let insertCounter = 0;

  const listRows = (table: keyof PolicyTableMap) => [...tables[table].values()].map(clone);

  const db = {
    async insert(table: keyof PolicyTableMap, value: Record<string, unknown>) {
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
    query(table: keyof PolicyTableMap) {
      return {
        async collect() {
          return listRows(table);
        },
      };
    },
  };

  return { ctx: { db }, tables };
}

describe('policy core contracts', () => {
  it('maps every active control to at least one policy and exactly one primary policy in the seed', () => {
    const activeControlIds = new Set(
      ACTIVE_CONTROL_REGISTER.controls.map((control) => control.internalControlId),
    );
    const mappingCounts = new Map<string, { total: number; primary: number }>();

    for (const policy of SECURITY_POLICY_CATALOG) {
      for (const mapping of policy.mappings) {
        const current = mappingCounts.get(mapping.internalControlId) ?? {
          primary: 0,
          total: 0,
        };
        current.total += 1;
        current.primary += mapping.isPrimary ? 1 : 0;
        mappingCounts.set(mapping.internalControlId, current);
      }
    }

    for (const controlId of activeControlIds) {
      const counts = mappingCounts.get(controlId);
      expect(counts?.total ?? 0).toBeGreaterThan(0);
      expect(counts?.primary ?? 0).toBe(1);
    }
  });

  it('repo sync overwrites seeded metadata but preserves DB-owned policy review dates', async () => {
    const catalogEntry = SECURITY_POLICY_CATALOG.find(
      (policy) => policy.policyId === 'access-control',
    );
    expect(catalogEntry).toBeTruthy();
    const { ctx, tables } = createPolicyMutationCtx({
      securityPolicies: [
        {
          _id: 'policy-existing-1',
          contentHash: 'old-hash',
          createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
          lastReviewedAt: Date.parse('2026-02-01T00:00:00.000Z'),
          nextReviewAt: Date.parse('2026-10-01T00:00:00.000Z'),
          owner: 'Old owner',
          policyId: 'access-control',
          scopeId: 'provider',
          scopeType: 'provider_global',
          sourcePath: 'docs/security-policies/old-access-policy.md',
          summary: 'Old summary',
          title: 'Old Access Policy',
          updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        },
      ],
      securityPolicyControlMappings: [
        {
          _id: 'mapping-existing-1',
          createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
          internalControlId: 'CTRL-OLD-001',
          isPrimary: true,
          policyId: 'access-control',
          scopeId: 'provider',
          scopeType: 'provider_global',
          updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await syncSecurityPoliciesFromCatalog(ctx as never, {
      actorUserId: 'admin-user',
      catalog: [
        {
          contentHash: 'repo-hash-1',
          mappings: catalogEntry!.mappings,
          owner: catalogEntry!.owner,
          policyId: catalogEntry!.policyId,
          sourcePath: catalogEntry!.sourcePath,
          summary: catalogEntry!.summary,
          title: catalogEntry!.title,
        },
      ],
    });

    expect(result.policyCount).toBe(1);
    const syncedPolicy = [...tables.securityPolicies.values()].find(
      (policy) => policy.policyId === 'access-control',
    );
    expect(syncedPolicy).toMatchObject({
      contentHash: 'repo-hash-1',
      owner: catalogEntry!.owner,
      sourcePath: catalogEntry!.sourcePath,
      summary: catalogEntry!.summary,
      title: catalogEntry!.title,
    });
    expect(syncedPolicy?.lastReviewedAt).toBe(Date.parse('2026-02-01T00:00:00.000Z'));
    expect(syncedPolicy?.nextReviewAt).toBe(Date.parse('2026-10-01T00:00:00.000Z'));
    const mappingIds = [...tables.securityPolicyControlMappings.values()].map(
      (mapping) => mapping.internalControlId,
    );
    expect(mappingIds).toEqual(catalogEntry!.mappings.map((mapping) => mapping.internalControlId));
  });

  it('derives policy support only from mapped control support values', () => {
    const completeControls: Array<{ support: 'complete' } & Record<string, unknown>> = [
      {
        support: 'complete',
        findingSeverity: 'critical',
        reviewStatus: 'blocked',
        vendorStatus: 'overdue',
      },
      {
        support: 'complete',
        findingSeverity: 'none',
        reviewStatus: 'ready',
        vendorStatus: 'current',
      },
    ];
    const mixedControls: Array<{ support: 'missing' | 'partial' } & Record<string, unknown>> = [
      { support: 'missing', findingSeverity: 'none' },
      { support: 'partial', vendorStatus: 'overdue' },
    ];

    expect(resolvePolicySupport(completeControls)).toBe('complete');

    expect(resolvePolicySupport(mixedControls)).toBe('partial');
  });

  it('builds review-date updates for policy attestations without touching support state', () => {
    expect(
      buildPolicyReviewDatePatch({
        reviewedAt: Date.parse('2026-03-23T08:00:00.000Z'),
        validUntil: Date.parse('2027-03-23T08:00:00.000Z'),
      }),
    ).toEqual({
      lastReviewedAt: Date.parse('2026-03-23T08:00:00.000Z'),
      nextReviewAt: Date.parse('2027-03-23T08:00:00.000Z'),
      updatedAt: Date.parse('2026-03-23T08:00:00.000Z'),
    });
  });
});
