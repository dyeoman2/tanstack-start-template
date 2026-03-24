import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { ACTIVE_CONTROL_REGISTER } from '../../../src/lib/shared/compliance/control-register';
import { getVendorBoundarySnapshot } from '../../../src/lib/server/vendor-boundary.server';
import {
  addMonths,
  getSecurityScopeFields,
  normalizeSecurityRelationshipObjectType,
  normalizeSecurityRelationshipType,
  normalizeSecurityScope,
} from './core';
import { VENDOR_RELATED_CONTROL_LINKS_BY_VENDOR } from './securityReviewConfig';

const VENDOR_REVIEW_CADENCE_MONTHS = 12;
const VENDOR_REVIEW_DUE_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type VendorKey = 'openrouter' | 'resend' | 'sentry';

function buildAnnualVendorReviewTaskTemplateKey(vendorKey: VendorKey) {
  return `annual:attest:vendor:${vendorKey}`;
}

function deriveVendorReviewStatus(args: {
  nextReviewAt: number | null;
  now?: number;
}): 'current' | 'due_soon' | 'overdue' {
  const now = args.now ?? Date.now();
  if (typeof args.nextReviewAt !== 'number') {
    return 'overdue';
  }
  if (now > args.nextReviewAt) {
    return 'overdue';
  }
  if (args.nextReviewAt - now <= VENDOR_REVIEW_DUE_SOON_WINDOW_MS) {
    return 'due_soon';
  }
  return 'current';
}

function resolveVendorNextReviewAt(lastReviewedAt: number | null) {
  if (typeof lastReviewedAt !== 'number') {
    return null;
  }
  return addMonths(lastReviewedAt, VENDOR_REVIEW_CADENCE_MONTHS);
}

async function resolveDefaultSecurityOwner(
  ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
): Promise<string> {
  const adminProfiles = await ctx.db
    .query('userProfiles')
    .withIndex('by_role_and_created_at', (q) => q.eq('role', 'admin'))
    .collect();
  const firstSiteAdmin = [...adminProfiles]
    .filter((profile) => profile.isSiteAdmin)
    .sort((left, right) => left.createdAt - right.createdAt)[0];

  return firstSiteAdmin?.name?.trim() || firstSiteAdmin?.email?.trim() || 'Site admin';
}

async function syncSecurityVendorRecords(ctx: MutationCtx) {
  const [runtimeVendors, existingVendors, defaultOwner, relationships] = await Promise.all([
    Promise.resolve(getVendorBoundarySnapshot()),
    ctx.db.query('securityVendors').collect(),
    resolveDefaultSecurityOwner(ctx),
    ctx.db.query('securityRelationships').collect(),
  ]);
  const activeVendorKeys = new Set(runtimeVendors.map((vendor) => vendor.vendor));
  const existingByKey = new Map(existingVendors.map((row) => [row.vendorKey, row] as const));
  const now = Date.now();

  for (const runtimeVendor of runtimeVendors) {
    const existing = existingByKey.get(runtimeVendor.vendor);
    const patch = {
      owner: existing?.owner ?? defaultOwner,
      summary: existing?.summary ?? null,
      title: runtimeVendor.displayName,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      continue;
    }

    await ctx.db.insert('securityVendors', {
      ...getSecurityScopeFields(),
      createdAt: now,
      lastReviewedAt: null,
      linkedFollowUpRunId: undefined,
      nextReviewAt: null,
      vendorKey: runtimeVendor.vendor,
      ...patch,
    });
  }

  for (const existingVendor of existingVendors) {
    if (activeVendorKeys.has(existingVendor.vendorKey)) {
      continue;
    }

    const [linkedReviewTasks, linkedEvidenceLinks] = await Promise.all([
      ctx.db
        .query('reviewTasks')
        .collect()
        .then((rows) => rows.filter((row) => row.vendorKey === existingVendor.vendorKey)),
      ctx.db
        .query('reviewTaskEvidenceLinks')
        .withIndex('by_source_type_and_source_id', (q) =>
          q.eq('sourceType', 'vendor').eq('sourceId', existingVendor.vendorKey),
        )
        .collect(),
    ]);
    const linkedRelationships = relationships.filter(
      (relationship) =>
        relationship.fromId === existingVendor.vendorKey &&
        normalizeSecurityRelationshipObjectType(relationship.fromType) === 'vendor',
    );
    const hasHistory =
      linkedReviewTasks.length > 0 ||
      linkedEvidenceLinks.length > 0 ||
      linkedRelationships.length > 0 ||
      typeof existingVendor.linkedFollowUpRunId === 'string';

    if (hasHistory) {
      continue;
    }

    await ctx.db.delete(existingVendor._id);
  }
}

async function syncSecurityVendorControlMappings(ctx: MutationCtx) {
  const existing = await ctx.db.query('securityVendorControlMappings').collect();
  const existingByKey = new Map<string, (typeof existing)[number]>(
    existing.map((row) => [`${row.vendorKey}:${row.internalControlId}`, row] as const),
  );
  const desired = getVendorBoundarySnapshot().flatMap((vendor) => {
    const controlIds = new Set(
      VENDOR_RELATED_CONTROL_LINKS_BY_VENDOR[vendor.vendor].map((link) => link.internalControlId),
    );
    return [...controlIds].map((internalControlId) => ({
      internalControlId,
      vendorKey: vendor.vendor,
    }));
  });
  const desiredKeys = new Set(
    desired.map((mapping) => `${mapping.vendorKey}:${mapping.internalControlId}` as string),
  );
  const now = Date.now();
  for (const mapping of desired) {
    const key = `${mapping.vendorKey}:${mapping.internalControlId}`;
    if (existingByKey.has(key)) {
      continue;
    }
    await ctx.db.insert('securityVendorControlMappings', {
      ...getSecurityScopeFields(),
      createdAt: now,
      internalControlId: mapping.internalControlId,
      vendorKey: mapping.vendorKey,
    });
  }

  for (const existingMapping of existing) {
    const key = `${existingMapping.vendorKey}:${existingMapping.internalControlId}`;
    if (desiredKeys.has(key)) {
      continue;
    }
    await ctx.db.delete(existingMapping._id);
  }
}

async function listSecurityVendorRecords(ctx: QueryCtx): Promise<
  Array<
    Doc<'securityVendors'> & {
      runtime: ReturnType<typeof getVendorBoundarySnapshot>[number];
      reviewStatus: 'current' | 'due_soon' | 'overdue';
    }
  >
> {
  const [runtimeVendors, vendorRows] = await Promise.all([
    Promise.resolve(getVendorBoundarySnapshot()),
    ctx.db.query('securityVendors').collect(),
  ]);
  const vendorByKey = new Map(vendorRows.map((row) => [row.vendorKey, row] as const));

  return runtimeVendors.flatMap((runtimeVendor) => {
    const row = vendorByKey.get(runtimeVendor.vendor);
    return [
      {
        ...(row ?? {
          _creationTime: 0,
          _id: `virtual-vendor:${runtimeVendor.vendor}` as Id<'securityVendors'>,
          createdAt: 0,
          lastReviewedAt: null,
          linkedFollowUpRunId: undefined,
          nextReviewAt: null,
          owner: undefined,
          scopeId: undefined,
          scopeType: undefined,
          summary: null,
          title: runtimeVendor.displayName,
          updatedAt: 0,
          vendorKey: runtimeVendor.vendor,
        }),
        reviewStatus: deriveVendorReviewStatus({
          nextReviewAt: row?.nextReviewAt ?? null,
        }),
        runtime: runtimeVendor,
      },
    ];
  });
}

async function buildVendorWorkspaceRows(ctx: QueryCtx) {
  const [vendors, mappings, relationships, annualTasks, defaultOwner] = await Promise.all([
    listSecurityVendorRecords(ctx),
    ctx.db.query('securityVendorControlMappings').collect(),
    ctx.db.query('securityRelationships').collect(),
    (async () => {
      const run = await ctx.db
        .query('reviewRuns')
        .withIndex('by_run_key', (q) => q.eq('runKey', `annual:${new Date().getUTCFullYear()}`))
        .unique();
      if (!run) {
        return [] as Array<Doc<'reviewTasks'>>;
      }
      return await ctx.db
        .query('reviewTasks')
        .withIndex('by_review_run_id', (q) => q.eq('reviewRunId', run._id))
        .collect();
    })(),
    resolveDefaultSecurityOwner(ctx),
  ]);
  const controlById = new Map(
    ACTIVE_CONTROL_REGISTER.controls.map(
      (control) => [control.internalControlId, control] as const,
    ),
  );
  const relationshipsByFromKey = relationships.reduce<Map<string, typeof relationships>>(
    (accumulator, relationship) => {
      const normalizedFromType = normalizeSecurityRelationshipObjectType(relationship.fromType);
      if (!normalizedFromType) {
        return accumulator;
      }
      const key = `${normalizedFromType}:${relationship.fromId}`;
      const current = accumulator.get(key) ?? [];
      current.push(relationship);
      accumulator.set(key, current);
      return accumulator;
    },
    new Map(),
  );
  const reviewRunIds = Array.from(
    new Set(
      relationships
        .filter((relationship) => relationship.toType === 'review_run')
        .map((relationship) => relationship.toId as Id<'reviewRuns'>),
    ),
  );
  const reviewRuns = await Promise.all(
    reviewRunIds.map(async (reviewRunId) => await ctx.db.get(reviewRunId)),
  );
  const reviewRunById = new Map(
    reviewRuns
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .map((entry) => [entry._id, entry] as const),
  );
  const annualTaskByVendorKey = new Map(
    annualTasks
      .filter(
        (task): task is Doc<'reviewTasks'> & { vendorKey: VendorKey } =>
          typeof task.vendorKey === 'string',
      )
      .map((task) => [task.vendorKey, task] as const),
  );

  return vendors.map((vendor) => {
    const relatedControls = mappings
      .filter((mapping) => mapping.vendorKey === vendor.vendorKey)
      .map((mapping) => {
        const control = controlById.get(mapping.internalControlId);
        return {
          internalControlId: mapping.internalControlId,
          itemId: null,
          itemLabel: null,
          nist80053Id: control?.nist80053Id ?? mapping.internalControlId,
          title: control?.title ?? mapping.internalControlId,
        };
      });
    const linkedAnnualReviewTask = annualTaskByVendorKey.get(vendor.vendorKey);
    const linkedEntities = (relationshipsByFromKey.get(`vendor:${vendor.vendorKey}`) ?? [])
      .map((relationship) => {
        if (relationship.toType === 'review_run') {
          const run = reviewRunById.get(relationship.toId as Id<'reviewRuns'>);
          if (!run) {
            return null;
          }
          return {
            entityId: relationship.toId,
            entityType: relationship.toType,
            label: run.title,
            relationshipType:
              normalizeSecurityRelationshipType(relationship.relationshipType) ?? 'follow_up_for',
            status: run.status,
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      allowedDataClasses: vendor.runtime.allowedDataClasses,
      allowedEnvironments: vendor.runtime.allowedEnvironments,
      approvalEnvVar: vendor.runtime.approvalEnvVar,
      approved: vendor.runtime.approved,
      approvedByDefault: vendor.runtime.approvedByDefault,
      lastReviewedAt: vendor.lastReviewedAt ?? null,
      linkedAnnualReviewTask: linkedAnnualReviewTask
        ? {
            id: linkedAnnualReviewTask._id,
            status: linkedAnnualReviewTask.status,
            title: linkedAnnualReviewTask.title,
          }
        : null,
      linkedEntities,
      linkedFollowUpRunId: vendor.linkedFollowUpRunId ?? null,
      nextReviewAt: vendor.nextReviewAt ?? null,
      owner: vendor.owner ?? defaultOwner,
      relatedControls,
      reviewStatus: vendor.reviewStatus,
      scopeId: normalizeSecurityScope(vendor).scopeId,
      scopeType: normalizeSecurityScope(vendor).scopeType,
      summary: vendor.summary ?? null,
      title: vendor.title,
      vendor: vendor.vendorKey,
    };
  });
}

export {
  buildAnnualVendorReviewTaskTemplateKey,
  buildVendorWorkspaceRows,
  deriveVendorReviewStatus,
  resolveDefaultSecurityOwner,
  resolveVendorNextReviewAt,
  syncSecurityVendorControlMappings,
  syncSecurityVendorRecords,
  VENDOR_REVIEW_CADENCE_MONTHS,
};
