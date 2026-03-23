import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { SECURITY_POLICY_DOCUMENTS } from '../../../src/lib/shared/compliance/security-policy-documents';
import { SECURITY_POLICY_CATALOG } from '../../../src/lib/shared/compliance/security-policies';
import { getAnnualReviewRunKey, getCurrentAnnualReviewYear, getSecurityScopeFields } from './core';
import { addMonths, resolveSeedSiteAdminActor } from './operations_core';
import { listSecurityControlWorkspaceExportRecords } from './control_workspace_core';

type SecuritySupport = 'missing' | 'partial' | 'complete';
type SecurityPolicyLinkedAnnualReviewTask = {
  id: Id<'reviewTasks'>;
  status: Doc<'reviewTasks'>['status'];
  title: string;
};
type SecurityPolicyMappedControlRecord = {
  familyId: string;
  familyTitle: string;
  implementationSummary: string;
  internalControlId: string;
  isPrimary: boolean;
  nist80053Id: string;
  platformChecklist: Array<{
    itemId: string;
    label: string;
    required: boolean;
    support: SecuritySupport;
  }>;
  responsibility: 'customer' | 'platform' | 'shared-responsibility' | null;
  support: SecuritySupport;
  title: string;
};
type SecurityPolicySummaryRecord = {
  contentHash: string;
  lastReviewedAt: number | null;
  linkedAnnualReviewTask: SecurityPolicyLinkedAnnualReviewTask | null;
  mappedControlCount: number;
  mappedControlCountsBySupport: Record<SecuritySupport, number>;
  nextReviewAt: number | null;
  owner: string;
  policyId: string;
  scopeId: string;
  scopeType: 'provider_global';
  sourcePath: string;
  summary: string;
  support: SecuritySupport;
  title: string;
};
type SecurityPolicyDetailRecord = {
  contentHash: string;
  lastReviewedAt: number | null;
  linkedAnnualReviewTask: SecurityPolicyLinkedAnnualReviewTask | null;
  mappedControls: SecurityPolicyMappedControlRecord[];
  nextReviewAt: number | null;
  owner: string;
  policyId: string;
  scopeId: string;
  scopeType: 'provider_global';
  sourcePath: string;
  sourceMarkdown: string | null;
  summary: string;
  support: SecuritySupport;
  title: string;
};
type SecurityPolicyReviewContextRecord = {
  policy: Pick<SecurityPolicySummaryRecord, 'policyId' | 'sourcePath' | 'support' | 'title'>;
  policyControls: SecurityPolicyMappedControlRecord[];
};

type PolicyCatalogEntry = {
  contentHash: string;
  mappings: Array<{
    internalControlId: string;
    isPrimary: boolean;
  }>;
  owner: string;
  policyId: string;
  sourcePath: string;
  summary: string;
  title: string;
};

// Policy source of truth contract:
// - repo markdown + seeded catalog own prose-backed fields such as title, summary, sourcePath,
//   contentHash and seeded mappings
// - Convex owns policy review metadata such as lastReviewedAt / nextReviewAt
// - repo sync overwrites repo-owned fields and preserves DB-owned review metadata

function resolvePolicySupport(controls: Array<{ support: SecuritySupport }>): SecuritySupport {
  if (controls.length === 0) {
    return 'missing';
  }
  if (controls.every((control) => control.support === 'complete')) {
    return 'complete';
  }
  if (controls.every((control) => control.support === 'missing')) {
    return 'missing';
  }
  return 'partial';
}

function getSeededPolicyReviewDates() {
  const seededReviewedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);
  return {
    lastReviewedAt: seededReviewedAt,
    nextReviewAt: addMonths(seededReviewedAt, 12),
  };
}

function buildPolicyRepoManagedPatch(policy: PolicyCatalogEntry, now: number) {
  return {
    ...getSecurityScopeFields(),
    contentHash: policy.contentHash,
    owner: policy.owner,
    policyId: policy.policyId,
    sourcePath: policy.sourcePath,
    summary: policy.summary,
    title: policy.title,
    updatedAt: now,
  };
}

function buildPolicyReviewStatePatch(existing: Doc<'securityPolicies'> | undefined) {
  const seedDates = getSeededPolicyReviewDates();
  return {
    lastReviewedAt: existing?.lastReviewedAt ?? seedDates.lastReviewedAt,
    nextReviewAt: existing?.nextReviewAt ?? seedDates.nextReviewAt,
  };
}

function buildSecurityPolicyMappedControls(args: {
  controlRecords: Array<{
    familyId: string;
    familyTitle: string;
    implementationSummary: string;
    internalControlId: string;
    nist80053Id: string;
    platformChecklist: Array<{
      itemId: string;
      label: string;
      required: boolean;
      support: SecuritySupport;
    }>;
    responsibility: 'customer' | 'platform' | 'shared-responsibility' | null;
    support: SecuritySupport;
    title: string;
  }>;
  mappings: Array<Doc<'securityPolicyControlMappings'>>;
}): SecurityPolicyMappedControlRecord[] {
  const controlsById = new Map(
    args.controlRecords.map((control) => [control.internalControlId, control] as const),
  );
  return args.mappings
    .map((mapping) => {
      const control = controlsById.get(mapping.internalControlId);
      return control
        ? {
            familyId: control.familyId,
            familyTitle: control.familyTitle,
            implementationSummary: control.implementationSummary,
            internalControlId: control.internalControlId,
            isPrimary: mapping.isPrimary,
            nist80053Id: control.nist80053Id,
            platformChecklist: control.platformChecklist.map((item) => ({
              itemId: item.itemId,
              label: item.label,
              required: item.required,
              support: item.support,
            })),
            responsibility: control.responsibility,
            support: control.support,
            title: control.title,
          }
        : null;
    })
    .filter((control): control is SecurityPolicyMappedControlRecord => control !== null)
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return (
        left.nist80053Id.localeCompare(right.nist80053Id) || left.title.localeCompare(right.title)
      );
    });
}

function buildSecurityPolicySummaryRecord(args: {
  linkedAnnualReviewTask: SecurityPolicyLinkedAnnualReviewTask | null;
  mappedControls: SecurityPolicyMappedControlRecord[];
  owner: string;
  policy: Doc<'securityPolicies'>;
}): SecurityPolicySummaryRecord {
  return {
    contentHash: args.policy.contentHash,
    lastReviewedAt: args.policy.lastReviewedAt ?? null,
    linkedAnnualReviewTask: args.linkedAnnualReviewTask,
    mappedControlCount: args.mappedControls.length,
    mappedControlCountsBySupport: args.mappedControls.reduce(
      (counts, control) => {
        counts[control.support] += 1;
        return counts;
      },
      {
        complete: 0,
        missing: 0,
        partial: 0,
      },
    ),
    nextReviewAt: args.policy.nextReviewAt ?? null,
    owner: args.owner,
    policyId: args.policy.policyId,
    sourcePath: args.policy.sourcePath,
    summary: args.policy.summary,
    support: resolvePolicySupport(args.mappedControls),
    title: args.policy.title,
    ...getSecurityScopeFields(),
  };
}

function buildSecurityPolicyDetailRecord(args: {
  linkedAnnualReviewTask: SecurityPolicyLinkedAnnualReviewTask | null;
  mappedControls: SecurityPolicyMappedControlRecord[];
  owner: string;
  policy: Doc<'securityPolicies'>;
  support: SecuritySupport;
}): SecurityPolicyDetailRecord {
  return {
    contentHash: args.policy.contentHash,
    lastReviewedAt: args.policy.lastReviewedAt ?? null,
    linkedAnnualReviewTask: args.linkedAnnualReviewTask,
    mappedControls: args.mappedControls,
    nextReviewAt: args.policy.nextReviewAt ?? null,
    owner: args.owner,
    policyId: args.policy.policyId,
    sourcePath: args.policy.sourcePath,
    sourceMarkdown: SECURITY_POLICY_DOCUMENTS[args.policy.sourcePath] ?? null,
    summary: args.policy.summary,
    support: args.support,
    title: args.policy.title,
    ...getSecurityScopeFields(),
  };
}

async function syncSecurityPoliciesFromCatalog(
  ctx: MutationCtx,
  args: {
    actorUserId: string;
    catalog: PolicyCatalogEntry[];
  },
) {
  const [existingPolicies, existingMappings] = await Promise.all([
    ctx.db.query('securityPolicies').collect(),
    ctx.db.query('securityPolicyControlMappings').collect(),
  ]);
  const existingPolicyById = new Map(
    existingPolicies.map((policy) => [policy.policyId, policy] as const),
  );
  const existingMappingByKey = new Map<string, (typeof existingMappings)[number]>(
    existingMappings.map(
      (mapping) => [`${mapping.policyId}:${mapping.internalControlId}`, mapping] as const,
    ),
  );
  const now = Date.now();
  const incomingPolicyIds = new Set(args.catalog.map((policy) => policy.policyId));
  const incomingMappingKeys = new Set(
    args.catalog.flatMap((policy) =>
      policy.mappings.map((mapping) => `${policy.policyId}:${mapping.internalControlId}`),
    ),
  );

  for (const policy of args.catalog) {
    const existing = existingPolicyById.get(policy.policyId);
    const patch = {
      ...buildPolicyRepoManagedPatch(policy, now),
      ...buildPolicyReviewStatePatch(existing),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityPolicies', {
        ...patch,
        createdAt: now,
      });
    }

    for (const mapping of policy.mappings) {
      const key = `${policy.policyId}:${mapping.internalControlId}`;
      const existingMapping = existingMappingByKey.get(key);
      const mappingPatch = {
        ...getSecurityScopeFields(),
        internalControlId: mapping.internalControlId,
        isPrimary: mapping.isPrimary,
        policyId: policy.policyId,
        updatedAt: now,
      };
      if (existingMapping) {
        await ctx.db.patch(existingMapping._id, mappingPatch);
      } else {
        await ctx.db.insert('securityPolicyControlMappings', {
          ...mappingPatch,
          createdAt: now,
        });
      }
    }
  }

  await Promise.all([
    ...existingPolicies
      .filter((policy) => !incomingPolicyIds.has(policy.policyId))
      .map((policy) => ctx.db.delete(policy._id)),
    ...existingMappings
      .filter(
        (mapping) => !incomingMappingKeys.has(`${mapping.policyId}:${mapping.internalControlId}`),
      )
      .map((mapping) => ctx.db.delete(mapping._id)),
  ]);

  return {
    policyCount: args.catalog.length,
    mappingCount: args.catalog.reduce((total, policy) => total + policy.mappings.length, 0),
    syncedAt: now,
    syncedByUserId: args.actorUserId,
  };
}

function buildPolicyLinkedAnnualReviewTask(
  reviewTask: Doc<'reviewTasks'> | null,
): SecurityPolicyLinkedAnnualReviewTask | null {
  if (!reviewTask) {
    return null;
  }
  return {
    id: reviewTask._id,
    status: reviewTask.status,
    title: reviewTask.title,
  };
}

async function listSecurityPolicySummaryRecords(
  ctx: QueryCtx,
): Promise<SecurityPolicySummaryRecord[]> {
  const currentAnnualRun = await ctx.db
    .query('reviewRuns')
    .withIndex('by_run_key', (q) =>
      q.eq('runKey', getAnnualReviewRunKey(getCurrentAnnualReviewYear())),
    )
    .unique();
  const [seededActor, policies, mappings, controlSummaries, reviewTasks] = await Promise.all([
    resolveSeedSiteAdminActor(ctx),
    ctx.db.query('securityPolicies').collect(),
    ctx.db.query('securityPolicyControlMappings').collect(),
    listSecurityControlWorkspaceExportRecords(ctx),
    currentAnnualRun
      ? ctx.db
          .query('reviewTasks')
          .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', currentAnnualRun._id))
          .collect()
      : Promise.resolve([] as Array<Doc<'reviewTasks'>>),
  ]);
  const mappingsByPolicyId = mappings.reduce<Map<string, Array<(typeof mappings)[number]>>>(
    (accumulator, mapping) => {
      const current = accumulator.get(mapping.policyId) ?? [];
      current.push(mapping);
      accumulator.set(mapping.policyId, current);
      return accumulator;
    },
    new Map(),
  );
  const reviewTaskByPolicyId = new Map(
    reviewTasks
      .filter((task) => typeof task.policyId === 'string' && task.policyId.length > 0)
      .map((task) => [task.policyId as string, task] as const),
  );

  return [...policies]
    .sort((left, right) => left.title.localeCompare(right.title))
    .map((policy) => {
      const policyMappings = (mappingsByPolicyId.get(policy.policyId) ?? []).sort((left, right) =>
        left.internalControlId.localeCompare(right.internalControlId),
      );
      const mappedControls = buildSecurityPolicyMappedControls({
        controlRecords: controlSummaries,
        mappings: policyMappings,
      });
      return buildSecurityPolicySummaryRecord({
        linkedAnnualReviewTask: buildPolicyLinkedAnnualReviewTask(
          reviewTaskByPolicyId.get(policy.policyId) ?? null,
        ),
        mappedControls,
        owner: seededActor.displayName,
        policy,
      });
    });
}

async function getSecurityPolicyDetailRecord(
  ctx: QueryCtx,
  policyId: string,
): Promise<SecurityPolicyDetailRecord | null> {
  const [summary] = (await listSecurityPolicySummaryRecords(ctx)).filter(
    (policy) => policy.policyId === policyId,
  );
  if (!summary) {
    return null;
  }
  const [seededActor, policy, mappings, controlSummaries, currentAnnualRun] = await Promise.all([
    resolveSeedSiteAdminActor(ctx),
    ctx.db
      .query('securityPolicies')
      .withIndex('by_policy_id', (q) => q.eq('policyId', policyId))
      .unique(),
    ctx.db
      .query('securityPolicyControlMappings')
      .withIndex('by_policy_id', (q) => q.eq('policyId', policyId))
      .collect(),
    listSecurityControlWorkspaceExportRecords(ctx),
    ctx.db
      .query('reviewRuns')
      .withIndex('by_run_key', (q) =>
        q.eq('runKey', getAnnualReviewRunKey(getCurrentAnnualReviewYear())),
      )
      .unique(),
  ]);
  if (!policy) {
    return null;
  }
  const mappedControls = buildSecurityPolicyMappedControls({
    controlRecords: controlSummaries,
    mappings,
  });

  let linkedAnnualReviewTask: SecurityPolicyLinkedAnnualReviewTask | null = null;

  if (currentAnnualRun) {
    const reviewTask = await ctx.db
      .query('reviewTasks')
      .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', currentAnnualRun._id))
      .collect()
      .then((tasks) => tasks.find((task) => task.policyId === policyId) ?? null);
    linkedAnnualReviewTask = buildPolicyLinkedAnnualReviewTask(reviewTask);
  }

  return buildSecurityPolicyDetailRecord({
    linkedAnnualReviewTask,
    mappedControls,
    owner: seededActor.displayName,
    policy,
    support: summary.support,
  });
}

async function listSecurityPolicyReviewContextRecords(
  ctx: QueryCtx,
): Promise<SecurityPolicyReviewContextRecord[]> {
  const [policySummaries, mappings, controlSummaries] = await Promise.all([
    listSecurityPolicySummaryRecords(ctx),
    ctx.db.query('securityPolicyControlMappings').collect(),
    listSecurityControlWorkspaceExportRecords(ctx),
  ]);
  const mappingsByPolicyId = mappings.reduce<
    Map<string, Array<Doc<'securityPolicyControlMappings'>>>
  >((accumulator, mapping) => {
    const current = accumulator.get(mapping.policyId) ?? [];
    current.push(mapping);
    accumulator.set(mapping.policyId, current);
    return accumulator;
  }, new Map());
  return policySummaries.map((policySummary) => ({
    policy: {
      policyId: policySummary.policyId,
      sourcePath: policySummary.sourcePath,
      support: policySummary.support,
      title: policySummary.title,
    },
    policyControls: buildSecurityPolicyMappedControls({
      controlRecords: controlSummaries,
      mappings: mappingsByPolicyId.get(policySummary.policyId) ?? [],
    }),
  }));
}

async function listSecurityPolicyExportRecords(ctx: QueryCtx) {
  return await listSecurityPolicySummaryRecords(ctx);
}

export {
  getSeededPolicyReviewDates,
  getSecurityPolicyDetailRecord,
  listSecurityPolicyReviewContextRecords,
  listSecurityPolicyExportRecords,
  listSecurityPolicySummaryRecords,
  resolvePolicySupport,
  SECURITY_POLICY_CATALOG,
  syncSecurityPoliciesFromCatalog,
};
export type {
  SecurityPolicyDetailRecord,
  SecurityPolicyMappedControlRecord,
  SecurityPolicyReviewContextRecord,
  SecurityPolicySummaryRecord,
  SecuritySupport,
};
