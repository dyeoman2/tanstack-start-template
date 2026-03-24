import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { ANNUAL_REVIEW_TASK_BLUEPRINTS } from './securityReviewConfig';
import { hashContent, stringifyStable } from './core';
import {
  buildAnnualVendorReviewTaskTemplateKey,
  syncSecurityVendorControlMappings,
  syncSecurityVendorRecords,
} from './vendors_core';

export type ReviewRunDoc = Doc<'reviewRuns'>;
export type ReviewTaskDoc = Doc<'reviewTasks'>;

function buildPolicyReviewTaskTemplateKey(policyId: string) {
  return `annual:attest:policy:${policyId}`;
}

export async function buildReviewRunSnapshot() {
  const snapshotJson = stringifyStable({
    generatedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
    schemaVersion: ACTIVE_CONTROL_REGISTER.schemaVersion,
    controls: ACTIVE_CONTROL_REGISTER.controls,
  });

  return {
    snapshotHash: await hashContent(snapshotJson),
    snapshotJson,
  };
}

export function buildReviewRunTaskCounts(tasks: ReviewTaskDoc[]) {
  return tasks.reduce(
    (counts, task) => {
      counts.total += 1;
      counts[task.status] += 1;
      return counts;
    },
    {
      blocked: 0,
      completed: 0,
      exception: 0,
      ready: 0,
      total: 0,
    },
  );
}

export function deriveReviewRunStatus(tasks: ReviewTaskDoc[], finalizedAt?: number) {
  if (typeof finalizedAt === 'number') {
    return 'completed' as const;
  }
  if (tasks.some((task) => task.status === 'blocked' || task.status === 'exception')) {
    return 'needs_attention' as const;
  }
  return 'ready' as const;
}

export async function listReviewTasksByRunId(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
  reviewRunId: Id<'reviewRuns'>,
) {
  return await ctx.db
    .query('reviewTasks')
    .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', reviewRunId))
    .collect();
}

function buildAnnualPolicyReviewTaskPatch(policy: Doc<'securityPolicies'>, now: number) {
  return {
    allowException: false,
    controlLinks: [] as ReviewTaskDoc['controlLinks'],
    description: `Review the ${policy.title} markdown source and attest that it remains current for the annual security review.`,
    freshnessWindowDays: 365,
    policyId: policy.policyId,
    required: true,
    taskType: 'attestation' as const,
    title: `${policy.title} reviewed`,
    updatedAt: now,
  };
}

function buildAnnualVendorReviewTaskPatch(
  vendor: Doc<'securityVendors'>,
  now: number,
): Omit<
  ReviewTaskDoc,
  | '_creationTime'
  | '_id'
  | 'createdAt'
  | 'latestAttestationId'
  | 'latestEvidenceLinkedAt'
  | 'latestNote'
  | 'latestResultId'
  | 'reviewRunId'
  | 'satisfiedAt'
  | 'satisfiedThroughAt'
  | 'status'
  | 'templateKey'
> {
  return {
    allowException: false,
    controlLinks: [] as ReviewTaskDoc['controlLinks'],
    description: `Review ${vendor.title} and attest that the vendor assessment remains current for the annual security review.`,
    freshnessWindowDays: 365,
    policyId: undefined,
    required: true,
    taskType: 'attestation',
    title: `${vendor.title} vendor review`,
    updatedAt: now,
    vendorKey: vendor.vendorKey,
  };
}

function buildAnnualFindingsReviewTaskPatch(now: number) {
  return {
    allowException: false,
    controlLinks: [
      {
        internalControlId: 'CTRL-RA-005',
        itemId: 'security-findings-can-be-reviewed-and-prioritized',
      },
      { internalControlId: 'CTRL-CA-005', itemId: 'follow-up-findings-can-be-surfaced' },
    ] as ReviewTaskDoc['controlLinks'],
    description:
      'Review open security findings, confirm critical items are resolved or dispositioned, and document any lower-severity carry-forward decisions.',
    freshnessWindowDays: 365,
    policyId: undefined,
    required: true,
    taskType: 'attestation' as const,
    title: 'Security findings reviewed',
    updatedAt: now,
    vendorKey: undefined,
  };
}

export async function syncAnnualPolicyReviewTasks(
  ctx: MutationCtx,
  args: {
    existingByTemplateKey: Map<string, ReviewTaskDoc>;
    existingTasks: ReviewTaskDoc[];
    reviewRunId: Id<'reviewRuns'>;
  },
) {
  const policies = await ctx.db.query('securityPolicies').collect();
  const now = Date.now();
  const validPolicyTemplateKeys = new Set(
    policies.map((policy) => buildPolicyReviewTaskTemplateKey(policy.policyId)),
  );

  await Promise.all(
    policies.map(async (policy) => {
      const templateKey = buildPolicyReviewTaskTemplateKey(policy.policyId);
      const existing = args.existingByTemplateKey.get(templateKey);
      const patch = buildAnnualPolicyReviewTaskPatch(policy, now);

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return;
      }

      await ctx.db.insert('reviewTasks', {
        ...patch,
        latestAttestationId: undefined,
        latestEvidenceLinkedAt: undefined,
        latestNote: undefined,
        latestResultId: undefined,
        reviewRunId: args.reviewRunId,
        satisfiedAt: undefined,
        satisfiedThroughAt: undefined,
        status: 'ready',
        templateKey,
        createdAt: now,
      });
    }),
  );

  await Promise.all(
    args.existingTasks
      .filter(
        (task) =>
          task.templateKey.startsWith('annual:attest:policy:') &&
          !validPolicyTemplateKeys.has(task.templateKey),
      )
      .map((task) => ctx.db.delete(task._id)),
  );
}

async function syncAnnualVendorReviewTasks(
  ctx: MutationCtx,
  args: {
    existingByTemplateKey: Map<string, ReviewTaskDoc>;
    existingTasks: ReviewTaskDoc[];
    reviewRunId: Id<'reviewRuns'>;
  },
) {
  await syncSecurityVendorRecords(ctx);
  await syncSecurityVendorControlMappings(ctx);
  const vendors = await ctx.db.query('securityVendors').collect();
  const now = Date.now();
  const validVendorTemplateKeys = new Set(
    vendors.map((vendor) => buildAnnualVendorReviewTaskTemplateKey(vendor.vendorKey)),
  );

  await Promise.all(
    vendors.map(async (vendor) => {
      const templateKey = buildAnnualVendorReviewTaskTemplateKey(vendor.vendorKey);
      const existing = args.existingByTemplateKey.get(templateKey);
      const patch = buildAnnualVendorReviewTaskPatch(vendor, now);
      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return;
      }
      await ctx.db.insert('reviewTasks', {
        ...patch,
        latestAttestationId: undefined,
        latestEvidenceLinkedAt: undefined,
        latestNote: undefined,
        latestResultId: undefined,
        reviewRunId: args.reviewRunId,
        satisfiedAt: undefined,
        satisfiedThroughAt: undefined,
        status: 'ready',
        templateKey,
        createdAt: now,
      });
    }),
  );

  await Promise.all(
    args.existingTasks
      .filter(
        (task) =>
          task.templateKey.startsWith('annual:attest:vendor:') &&
          !validVendorTemplateKeys.has(task.templateKey),
      )
      .map((task) => ctx.db.delete(task._id)),
  );
}

async function syncAnnualFindingsReviewTask(
  ctx: MutationCtx,
  args: {
    existingByTemplateKey: Map<string, ReviewTaskDoc>;
    reviewRunId: Id<'reviewRuns'>;
  },
) {
  const templateKey = 'annual:attest:findings-review';
  const existing = args.existingByTemplateKey.get(templateKey);
  const now = Date.now();
  const patch = buildAnnualFindingsReviewTaskPatch(now);

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }

  await ctx.db.insert('reviewTasks', {
    ...patch,
    latestAttestationId: undefined,
    latestEvidenceLinkedAt: undefined,
    latestNote: undefined,
    latestResultId: undefined,
    reviewRunId: args.reviewRunId,
    satisfiedAt: undefined,
    satisfiedThroughAt: undefined,
    status: 'ready',
    templateKey,
    createdAt: now,
  });
}

export async function upsertAnnualReviewTasks(ctx: MutationCtx, reviewRunId: Id<'reviewRuns'>) {
  const existingTasks = await listReviewTasksByRunId(ctx, reviewRunId);
  const existingByTemplateKey = new Map(
    existingTasks.map((task) => [task.templateKey, task] as const),
  );
  const now = Date.now();

  await Promise.all(
    ANNUAL_REVIEW_TASK_BLUEPRINTS.map(async (blueprint) => {
      const existing = existingByTemplateKey.get(blueprint.templateKey);
      const patch = {
        allowException: blueprint.allowException,
        controlLinks: blueprint.controlLinks,
        description: blueprint.description,
        freshnessWindowDays: blueprint.freshnessWindowDays ?? undefined,
        policyId: undefined,
        vendorKey: undefined,
        required: blueprint.required,
        taskType: blueprint.taskType,
        title: blueprint.title,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        return;
      }

      await ctx.db.insert('reviewTasks', {
        ...patch,
        latestAttestationId: undefined,
        latestEvidenceLinkedAt: undefined,
        latestNote: undefined,
        latestResultId: undefined,
        reviewRunId,
        satisfiedAt: undefined,
        satisfiedThroughAt: undefined,
        status: 'ready',
        templateKey: blueprint.templateKey,
        createdAt: now,
      });
    }),
  );

  await syncAnnualPolicyReviewTasks(ctx, {
    existingByTemplateKey,
    existingTasks,
    reviewRunId,
  });
  await syncAnnualVendorReviewTasks(ctx, {
    existingByTemplateKey,
    existingTasks,
    reviewRunId,
  });
  await syncAnnualFindingsReviewTask(ctx, {
    existingByTemplateKey,
    reviewRunId,
  });
}

export async function syncReviewRunStatus(ctx: MutationCtx, reviewRunId: Id<'reviewRuns'>) {
  const run = await ctx.db.get(reviewRunId);
  if (!run) {
    return;
  }

  const tasks = await listReviewTasksByRunId(ctx, reviewRunId);
  await ctx.db.patch(reviewRunId, {
    status: deriveReviewRunStatus(tasks, run.finalizedAt),
    updatedAt: Date.now(),
  });
}
