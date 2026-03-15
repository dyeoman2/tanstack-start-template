import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const clearOrganizationMembershipStatesForUserInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query('organizationMembershipStates')
      .withIndex('by_organization_id_and_user_id', (query) =>
        query.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .collect();

    await Promise.all(records.map(async (record) => await ctx.db.delete(record._id)));
    return null;
  },
});

export const markOrganizationMembershipDeactivatedForUserInternal = internalMutation({
  args: {
    membershipId: v.string(),
    organizationId: v.string(),
    reason: v.optional(v.union(v.string(), v.null())),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('organizationMembershipStates')
      .withIndex('by_organization_id_and_user_id', (query) =>
        query.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .first();

    const now = Date.now();
    const normalizedReason = args.reason?.trim() ? args.reason.trim() : null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        membershipId: args.membershipId,
        status: 'deactivated',
        reason: normalizedReason,
        updatedAt: now,
        updatedByUserId: args.userId,
        deactivatedAt: now,
      });
      return null;
    }

    await ctx.db.insert('organizationMembershipStates', {
      organizationId: args.organizationId,
      membershipId: args.membershipId,
      userId: args.userId,
      status: 'deactivated',
      reason: normalizedReason,
      createdAt: now,
      updatedAt: now,
      updatedByUserId: args.userId,
      deactivatedAt: now,
    });

    return null;
  },
});
