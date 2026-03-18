import type { GenericCtx } from '@convex-dev/better-auth';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server';

export type OrganizationMembershipStatus = 'active' | 'suspended' | 'deactivated';
export type OrganizationMembershipStateDoc = Doc<'organizationMembershipStates'>;

function hasDb(ctx: GenericCtx<DataModel>): ctx is QueryCtx | MutationCtx {
  return 'db' in ctx;
}

async function queryMembershipStateRecord(ctx: QueryCtx | MutationCtx, membershipId: string) {
  return await ctx.db
    .query('organizationMembershipStates')
    .withIndex('by_membership_id', (q) => q.eq('membershipId', membershipId))
    .first();
}

export const getOrganizationMembershipStateRecordInternal = internalQuery({
  args: {
    membershipId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('organizationMembershipStates'),
      _creationTime: v.number(),
      membershipId: v.string(),
      status: v.union(v.literal('suspended'), v.literal('deactivated')),
      reason: v.union(v.string(), v.null()),
      updatedAt: v.number(),
      updatedByUserId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => await queryMembershipStateRecord(ctx, args.membershipId),
});

export const getOrganizationMembershipStateByOrganizationUserInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('organizationMembershipStates'),
      _creationTime: v.number(),
      membershipId: v.string(),
      status: v.union(v.literal('suspended'), v.literal('deactivated')),
      reason: v.union(v.string(), v.null()),
      updatedAt: v.number(),
      updatedByUserId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) =>
    await ctx.db
      .query('organizationMembershipStates')
      .withIndex('by_organization_id_and_user_id', (query) =>
        query.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .first(),
});

export async function getOrganizationMembershipStateRecord(
  ctx: GenericCtx<DataModel>,
  membershipId: string,
) {
  if (hasDb(ctx)) {
    return await queryMembershipStateRecord(ctx, membershipId);
  }

  return await ctx.runQuery(
    internal.lib.organizationMembershipState.getOrganizationMembershipStateRecordInternal,
    { membershipId },
  );
}

export async function getOrganizationMembershipStateByOrganizationUser(
  ctx: GenericCtx<DataModel>,
  organizationId: string,
  userId: string,
) {
  if (hasDb(ctx)) {
    return await ctx.db
      .query('organizationMembershipStates')
      .withIndex('by_organization_id_and_user_id', (query) =>
        query.eq('organizationId', organizationId).eq('userId', userId),
      )
      .first();
  }

  return await ctx.runQuery(
    internal.lib.organizationMembershipState
      .getOrganizationMembershipStateByOrganizationUserInternal,
    { organizationId, userId },
  );
}

export async function getOrganizationMembershipStatus(
  ctx: GenericCtx<DataModel>,
  membershipId: string | undefined | null,
): Promise<OrganizationMembershipStatus> {
  if (!membershipId) {
    return 'active';
  }

  const state = await getOrganizationMembershipStateRecord(ctx, membershipId);
  return state?.status ?? 'active';
}

export async function getOrganizationMembershipStatuses(
  ctx: GenericCtx<DataModel>,
  membershipIds: string[],
) {
  const uniqueIds = Array.from(new Set(membershipIds.filter((id) => id.length > 0)));
  const records = await Promise.all(
    uniqueIds.map(
      async (membershipId) =>
        [membershipId, await getOrganizationMembershipStatus(ctx, membershipId)] as const,
    ),
  );

  return new Map(records);
}
