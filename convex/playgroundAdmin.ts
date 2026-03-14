import { ConvexError, v } from 'convex/values';
import { components } from './_generated/api';
import { mutation } from './_generated/server';
import { getVerifiedCurrentUserOrThrow } from './auth/access';

export const issueChatPlaygroundApiKey = mutation({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    if (!user.isSiteAdmin) {
      throw new ConvexError('Site admin access required.');
    }

    return await ctx.runMutation(components.agent.apiKeys.issue, {
      name: args.name?.trim() || 'chat-playground',
    });
  },
});

export const revokeChatPlaygroundApiKey = mutation({
  args: {
    apiKey: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);
    if (!user.isSiteAdmin) {
      throw new ConvexError('Site admin access required.');
    }

    return await ctx.runMutation(components.agent.apiKeys.destroy, {
      apiKey: args.apiKey,
      name: args.name?.trim() || undefined,
    });
  },
});
