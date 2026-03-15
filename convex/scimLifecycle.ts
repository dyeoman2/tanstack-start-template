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
