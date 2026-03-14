import { v } from 'convex/values';
import { components } from './_generated/api';
import { siteAdminMutation } from './auth/authorized';
import { inviteApiKeyDestroyResultValidator } from './lib/returnValidators';

export const issueChatPlaygroundApiKey = siteAdminMutation({
  args: {
    name: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.agent.apiKeys.issue, {
      name: args.name?.trim() || 'chat-playground',
    });
  },
});

export const revokeChatPlaygroundApiKey = siteAdminMutation({
  args: {
    apiKey: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: inviteApiKeyDestroyResultValidator,
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.agent.apiKeys.destroy, {
      apiKey: args.apiKey,
      name: args.name?.trim() || undefined,
    });
  },
});
