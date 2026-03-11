import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import { getCurrentUserOrNull, getCurrentUserOrThrow } from './auth/access';

const usageShape = v.object({
  totalTokens: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
});

const structuredDataShape = v.object({
  title: v.string(),
  summary: v.string(),
  keyPoints: v.array(v.string()),
  category: v.string(),
  difficulty: v.string(),
});

type AiResponseDoc = Doc<'aiResponses'>;

const buildPatch = (
  base: Partial<AiResponseDoc>,
  updates: Partial<AiResponseDoc>,
): Partial<AiResponseDoc> => ({
  ...base,
  ...updates,
  updatedAt: Date.now(),
});

export const createResponse = internalMutation({
  args: {
    userId: v.string(),
    teamId: v.id('teams'),
    requestKey: v.string(),
    method: v.union(v.literal('direct'), v.literal('gateway'), v.literal('structured')),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const responseId = await ctx.db.insert('aiResponses', {
      userId: args.userId,
      teamId: args.teamId,
      requestKey: args.requestKey,
      method: args.method,
      response: '',
      status: 'pending',
      provider: args.provider,
      model: args.model,
      createdAt: now,
      updatedAt: now,
    });

    return { responseId };
  },
});

export const appendChunk = internalMutation({
  args: {
    responseId: v.id('aiResponses'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response) {
      return;
    }

    await ctx.db.patch(
      args.responseId,
      buildPatch(
        {},
        {
          response: `${response.response}${args.content}`,
        },
      ),
    );
  },
});

export const updateMetadata = internalMutation({
  args: {
    responseId: v.id('aiResponses'),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Partial<AiResponseDoc> = {};

    if (args.provider) {
      patch.provider = args.provider;
    }

    if (args.model) {
      patch.model = args.model;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    await ctx.db.patch(args.responseId, buildPatch({}, patch));
  },
});

export const markComplete = internalMutation({
  args: {
    responseId: v.id('aiResponses'),
    response: v.optional(v.string()),
    finishReason: v.optional(v.string()),
    usage: v.optional(usageShape),
    rawText: v.optional(v.string()),
    structuredData: v.optional(structuredDataShape),
    parseError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Partial<AiResponseDoc> = {
      status: 'complete',
    };

    // Ensure the response field contains the complete text
    // This prevents cut-off responses if the final buffer flush was missed
    if (args.response !== undefined) {
      patch.response = args.response;
    }

    if (args.finishReason) {
      patch.finishReason = args.finishReason;
    }

    if (args.usage) {
      patch.usage = args.usage;
    }

    if (args.rawText) {
      patch.rawText = args.rawText;
    }

    if (args.structuredData) {
      patch.structuredData = args.structuredData;
    }

    if (args.parseError) {
      patch.parseError = args.parseError;
    }

    await ctx.db.patch(args.responseId, buildPatch({}, patch));
  },
});

export const markError = internalMutation({
  args: {
    responseId: v.id('aiResponses'),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(
      args.responseId,
      buildPatch(
        {},
        {
          status: 'error',
          errorMessage: args.errorMessage,
        },
      ),
    );
  },
});

export const listUserResponses = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user?.lastActiveTeamId) {
      return [];
    }

    return ctx.db
      .query('aiResponses')
      .withIndex('by_teamId_createdAt', (q) => q.eq('teamId', user.lastActiveTeamId))
      .order('desc')
      .take(20);
  },
});

export const deleteAllUserResponses = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (!user.lastActiveTeamId) {
      throw new Error('No active team selected');
    }

    const responses = await ctx.db
      .query('aiResponses')
      .withIndex('by_teamId_createdAt', (q) => q.eq('teamId', user.lastActiveTeamId))
      .collect();

    await Promise.all(responses.map((response) => ctx.db.delete(response._id)));

    return { deletedCount: responses.length };
  },
});
