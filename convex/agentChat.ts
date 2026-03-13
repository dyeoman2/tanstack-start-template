import {
  serializeMessage,
  listUIMessages,
  syncStreams,
  updateThreadMetadata,
  vStreamArgs,
} from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { components, internal } from './_generated/api';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { getCurrentUserOrThrow } from './auth/access';
import {
  abortRunWithReason,
  buildUserMessage,
  deleteMessagesAfterPrompt,
  isTextOnlyUserMessage,
  resolveThread,
  type AgentMessageDoc,
} from './agentChatActions';
import {
  type ChatAttachmentDoc,
  type ChatRunDoc,
  type ChatThreadDoc,
  deriveThreadTitle,
  ensureThreadId,
  resolveChatModelId,
} from './lib/agentChat';
import { baseChatAgent } from './lib/chatAgentRuntime';

type PersonaDoc = Doc<'aiPersonas'>;
const CHAT_MESSAGE_RATE_LIMIT_CONFIG = {
  kind: 'token bucket' as const,
  rate: 12,
  period: 60 * 1000,
  capacity: 12,
};
const CHAT_ATTACHMENT_MESSAGE_RATE_LIMIT_CONFIG = {
  kind: 'token bucket' as const,
  rate: 4,
  period: 60 * 1000,
  capacity: 4,
};
const CHAT_TOKEN_RATE_LIMIT_CONFIG = {
  kind: 'token bucket' as const,
  rate: 40_000,
  period: 60 * 1000,
  capacity: 40_000,
};

function estimateChatInputTokens(args: { textLength?: number; hasAttachments?: boolean }) {
  const textTokens = Math.max(1, Math.ceil((args.textLength ?? 0) / 4));
  return textTokens + (args.hasAttachments ? 1_200 : 0);
}

async function getCurrentChatContext(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUserOrThrow(ctx);
  const organizationId = user.lastActiveOrganizationId;

  if (!organizationId) {
    throw new ConvexError('No active organization is selected.');
  }

  return {
    userId: user._id,
    organizationId,
    isSiteAdmin: user.isSiteAdmin,
  };
}

async function getThreadForOrganization(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<'chatThreads'>,
  organizationId: string,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread || thread.organizationId !== organizationId) {
    return null;
  }

  return thread;
}

async function getPersonaForOrganization(
  ctx: QueryCtx | MutationCtx,
  personaId: Id<'aiPersonas'>,
  organizationId: string,
) {
  const persona = await ctx.db.get(personaId);
  if (!persona || persona.organizationId !== organizationId) {
    return null;
  }

  return persona;
}

async function getChatRunsForThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<'chatThreads'>,
) {
  return await ctx.db
    .query('chatRuns')
    .withIndex('by_threadId_and_startedAt', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(20);
}

export const getCurrentChatContextInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await getCurrentChatContext(ctx);
  },
});

export const getThreadForOrganizationInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getThreadForOrganization(ctx, args.threadId, args.organizationId);
  },
});

export const getThreadByAgentThreadIdInternal = internalQuery({
  args: {
    agentThreadId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query('chatThreads')
      .withIndex('by_agentThreadId', (q) => q.eq('agentThreadId', args.agentThreadId))
      .first();

    if (!thread || thread.organizationId !== args.organizationId) {
      return null;
    }

    return thread;
  },
});

export const getPersonaByIdInternal = internalQuery({
  args: {
    personaId: v.id('aiPersonas'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getPersonaForOrganization(ctx, args.personaId, args.organizationId);
  },
});

export const getAttachmentsForSendInternal = internalQuery({
  args: {
    attachmentIds: v.array(v.id('chatAttachments')),
    userId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const attachments = await Promise.all(
      args.attachmentIds.map(async (attachmentId) => {
        const attachment = await ctx.db.get(attachmentId);
        if (
          !attachment ||
          attachment.userId !== args.userId ||
          attachment.organizationId !== args.organizationId
        ) {
          throw new ConvexError('Attachment not found.');
        }

        if (attachment.status !== 'ready') {
          throw new ConvexError('Attachment is still processing.');
        }

        return attachment;
      }),
    );

    return attachments;
  },
});

export const getAttachmentByIdInternal = internalQuery({
  args: {
    attachmentId: v.id('chatAttachments'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.organizationId !== args.organizationId) {
      return null;
    }

    return attachment;
  },
});

export const createThreadShellInternal = internalMutation({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    agentThreadId: v.string(),
    title: v.string(),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    titleManuallyEdited: v.boolean(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatThreads', {
      ...args,
      pinned: false,
      updatedAt: args.createdAt,
      lastMessageAt: args.createdAt,
    });
  },
});

export const patchThreadInternal = internalMutation({
  args: {
    threadId: v.id('chatThreads'),
    patch: v.object({
      agentThreadId: v.optional(v.string()),
      title: v.optional(v.string()),
      pinned: v.optional(v.boolean()),
      personaId: v.optional(v.union(v.id('aiPersonas'), v.null())),
      model: v.optional(v.union(v.string(), v.null())),
      titleManuallyEdited: v.optional(v.boolean()),
      summary: v.optional(v.union(v.string(), v.null())),
      summaryUpdatedAt: v.optional(v.union(v.number(), v.null())),
      updatedAt: v.optional(v.number()),
      lastMessageAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const patch: Partial<Doc<'chatThreads'>> = {};
    if (args.patch.agentThreadId !== undefined) patch.agentThreadId = args.patch.agentThreadId;
    if (args.patch.title !== undefined) patch.title = args.patch.title;
    if (args.patch.pinned !== undefined) patch.pinned = args.patch.pinned;
    if (args.patch.personaId !== undefined) {
      patch.personaId = args.patch.personaId ?? undefined;
    }
    if (args.patch.model !== undefined) {
      patch.model = args.patch.model ?? undefined;
    }
    if (args.patch.titleManuallyEdited !== undefined) {
      patch.titleManuallyEdited = args.patch.titleManuallyEdited;
    }
    if (args.patch.summary !== undefined) {
      patch.summary = args.patch.summary ?? undefined;
    }
    if (args.patch.summaryUpdatedAt !== undefined) {
      patch.summaryUpdatedAt = args.patch.summaryUpdatedAt ?? undefined;
    }
    if (args.patch.updatedAt !== undefined) patch.updatedAt = args.patch.updatedAt;
    if (args.patch.lastMessageAt !== undefined) patch.lastMessageAt = args.patch.lastMessageAt;
    await ctx.db.patch(args.threadId, patch);
  },
});

export const createAttachmentInternal = internalMutation({
  args: {
    threadId: v.optional(v.id('chatThreads')),
    agentMessageId: v.optional(v.string()),
    userId: v.string(),
    organizationId: v.string(),
    kind: v.union(v.literal('image'), v.literal('document')),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    rawStorageId: v.optional(v.id('_storage')),
    extractedTextStorageId: v.optional(v.id('_storage')),
    agentFileId: v.optional(v.string()),
    promptSummary: v.string(),
    status: v.union(v.literal('pending'), v.literal('ready'), v.literal('error')),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatAttachments', {
      ...args,
      updatedAt: args.createdAt,
    });
  },
});

export const updateAttachmentInternal = internalMutation({
  args: {
    attachmentId: v.id('chatAttachments'),
    patch: v.object({
      threadId: v.optional(v.union(v.id('chatThreads'), v.null())),
      agentMessageId: v.optional(v.union(v.string(), v.null())),
      extractedTextStorageId: v.optional(v.union(v.id('_storage'), v.null())),
      agentFileId: v.optional(v.union(v.string(), v.null())),
      promptSummary: v.optional(v.string()),
      status: v.optional(v.union(v.literal('pending'), v.literal('ready'), v.literal('error'))),
      errorMessage: v.optional(v.union(v.string(), v.null())),
      updatedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const patch: Partial<Doc<'chatAttachments'>> = {};
    if (args.patch.threadId !== undefined) patch.threadId = args.patch.threadId ?? undefined;
    if (args.patch.agentMessageId !== undefined) {
      patch.agentMessageId = args.patch.agentMessageId ?? undefined;
    }
    if (args.patch.extractedTextStorageId !== undefined) {
      patch.extractedTextStorageId = args.patch.extractedTextStorageId ?? undefined;
    }
    if (args.patch.agentFileId !== undefined) {
      patch.agentFileId = args.patch.agentFileId ?? undefined;
    }
    if (args.patch.promptSummary !== undefined) patch.promptSummary = args.patch.promptSummary;
    if (args.patch.status !== undefined) patch.status = args.patch.status;
    if (args.patch.errorMessage !== undefined) {
      patch.errorMessage = args.patch.errorMessage ?? undefined;
    }
    patch.updatedAt = args.patch.updatedAt;
    await ctx.db.patch(args.attachmentId, patch);
  },
});

export const assignAttachmentsToMessageInternal = internalMutation({
  args: {
    attachmentIds: v.array(v.id('chatAttachments')),
    threadId: v.id('chatThreads'),
    agentMessageId: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.attachmentIds.map((attachmentId) =>
        ctx.db.patch(attachmentId, {
          threadId: args.threadId,
          agentMessageId: args.agentMessageId,
          updatedAt: args.updatedAt,
        }),
      ),
    );
  },
});

export const createRunInternal = internalMutation({
  args: {
    threadId: v.id('chatThreads'),
    agentThreadId: v.string(),
    organizationId: v.string(),
    ownerSessionId: v.string(),
    agentStreamId: v.optional(v.string()),
    status: v.union(
      v.literal('idle'),
      v.literal('streaming'),
      v.literal('complete'),
      v.literal('aborted'),
      v.literal('error'),
    ),
    startedAt: v.number(),
    activeAssistantMessageId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    useWebSearch: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatRuns', args);
  },
});

export const patchRunInternal = internalMutation({
  args: {
    runId: v.id('chatRuns'),
    patch: v.object({
      agentStreamId: v.optional(v.union(v.string(), v.null())),
      status: v.optional(
        v.union(
          v.literal('idle'),
          v.literal('streaming'),
          v.literal('complete'),
          v.literal('aborted'),
          v.literal('error'),
        ),
      ),
      endedAt: v.optional(v.union(v.number(), v.null())),
      errorMessage: v.optional(v.union(v.string(), v.null())),
      activeAssistantMessageId: v.optional(v.union(v.string(), v.null())),
      provider: v.optional(v.union(v.string(), v.null())),
      model: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, args) => {
    const patch: Partial<Doc<'chatRuns'>> = {};
    if (args.patch.agentStreamId !== undefined) {
      patch.agentStreamId = args.patch.agentStreamId ?? undefined;
    }
    if (args.patch.status !== undefined) patch.status = args.patch.status;
    if (args.patch.endedAt !== undefined) patch.endedAt = args.patch.endedAt ?? undefined;
    if (args.patch.errorMessage !== undefined) {
      patch.errorMessage = args.patch.errorMessage ?? undefined;
    }
    if (args.patch.activeAssistantMessageId !== undefined) {
      patch.activeAssistantMessageId = args.patch.activeAssistantMessageId ?? undefined;
    }
    if (args.patch.provider !== undefined) patch.provider = args.patch.provider ?? undefined;
    if (args.patch.model !== undefined) patch.model = args.patch.model ?? undefined;
    await ctx.db.patch(args.runId, patch);
  },
});

export const getRunByIdInternal = internalQuery({
  args: {
    runId: v.id('chatRuns'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.organizationId !== args.organizationId) {
      return null;
    }

    return run;
  },
});

export const getRunByIdAnyInternal = internalQuery({
  args: {
    runId: v.id('chatRuns'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const getLatestRunForThreadInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatRuns')
      .withIndex('by_threadId_and_startedAt', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .first();
  },
});

export const getLatestActiveRunForThreadInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatRuns')
      .withIndex('by_threadId_and_status', (q) => q.eq('threadId', args.threadId).eq('status', 'streaming'))
      .first();
  },
});

export const listStaleStreamingRunsInternal = internalQuery({
  args: {
    startedBefore: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatRuns')
      .withIndex('by_status_and_startedAt', (q) =>
        q.eq('status', 'streaming').lt('startedAt', args.startedBefore),
      )
      .order('asc')
      .take(args.limit);
  },
});

export const getThreadByIdInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.threadId);
  },
});

export const getThreadByAgentThreadIdAnyInternal = internalQuery({
  args: {
    agentThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatThreads')
      .withIndex('by_agentThreadId', (q) => q.eq('agentThreadId', args.agentThreadId))
      .first();
  },
});

export const recordUsageEventInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    threadId: v.id('chatThreads'),
    runId: v.optional(v.id('chatRuns')),
    agentThreadId: v.string(),
    agentName: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    totalTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    providerMetadataJson: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatUsageEvents', args);
  },
});

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await getCurrentChatContext(ctx);

    return await ctx.db
      .query('chatThreads')
      .withIndex('by_organizationId_and_updatedAt', (q) => q.eq('organizationId', organizationId))
      .collect();
  },
});

export const getLatestThreadId = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const threads = await ctx.db
      .query('chatThreads')
      .withIndex('by_organizationId_and_lastMessageAt', (q) =>
        q.eq('organizationId', organizationId),
      )
      .order('desc')
      .take(1);

    return threads[0]?._id ?? null;
  },
});

export const getThread = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args): Promise<ChatThreadDoc | null> => {
    const { organizationId } = await getCurrentChatContext(ctx);
    return await getThreadForOrganization(ctx, args.threadId, organizationId);
  },
});

export const getThreadTitle = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const normalizedThreadId = ensureThreadId(ctx, args.threadId);
    if (!normalizedThreadId) {
      return null;
    }

    const thread = await getThreadForOrganization(ctx, normalizedThreadId, organizationId);
    return thread?.title ?? null;
  },
});

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const normalizedThreadId = ensureThreadId(ctx, args.threadId);

    if (!normalizedThreadId) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? '',
        streams: undefined,
      };
    }

    const thread = await getThreadForOrganization(ctx, normalizedThreadId, organizationId);
    if (!thread) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? '',
        streams: undefined,
      };
    }

    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: thread.agentThreadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: thread.agentThreadId,
      streamArgs: args.streamArgs,
    });
    return {
      ...paginated,
      streams,
    };
  },
});

export const getActiveRun = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args): Promise<ChatRunDoc | null> => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      return null;
    }

    const runs = await getChatRunsForThread(ctx, args.threadId);
    return runs.find((run) => run.status === 'streaming') ?? null;
  },
});

export const getRetryableRunIds = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      return {};
    }

    const runs = await ctx.db
      .query('chatRuns')
      .withIndex('by_threadId_and_startedAt', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .collect();

    const retryableRunIds: Record<string, string> = {};

    for (const run of runs) {
      if (!run.activeAssistantMessageId || retryableRunIds[run.activeAssistantMessageId]) {
        continue;
      }

      retryableRunIds[run.activeAssistantMessageId] = run._id;
    }

    return retryableRunIds;
  },
});

export const getChatRateLimit = query({
  args: {
    textLength: v.optional(v.number()),
    hasAttachments: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId, organizationId } = await getCurrentChatContext(ctx);
    const baseKey = `${organizationId}:${userId}`;
    const hasAttachments = args.hasAttachments ?? false;
    const frequency = await ctx.runQuery(components.rateLimiter.lib.checkRateLimit, {
      name: hasAttachments ? 'chatStreamWithAttachments' : 'chatStream',
      key: baseKey,
      config: hasAttachments
        ? CHAT_ATTACHMENT_MESSAGE_RATE_LIMIT_CONFIG
        : CHAT_MESSAGE_RATE_LIMIT_CONFIG,
    });
    const tokenEstimate = estimateChatInputTokens({
      textLength: args.textLength,
      hasAttachments,
    });
    const tokens = await ctx.runQuery(components.rateLimiter.lib.checkRateLimit, {
      name: 'chatTokenBudget',
      key: baseKey,
      count: tokenEstimate,
      config: {
        ...CHAT_TOKEN_RATE_LIMIT_CONFIG,
        maxReserved: CHAT_TOKEN_RATE_LIMIT_CONFIG.capacity,
      },
    });
    return {
      frequency,
      tokens,
      estimatedInputTokens: tokenEstimate,
    };
  },
});

async function reserveChatRateLimitOrThrow(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    textLength?: number;
    hasAttachments?: boolean;
  },
) {
  const baseKey = `${args.organizationId}:${args.userId}`;
  const hasAttachments = args.hasAttachments ?? false;
  const frequency = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
    name: hasAttachments ? 'chatStreamWithAttachments' : 'chatStream',
    key: baseKey,
    config: hasAttachments
      ? CHAT_ATTACHMENT_MESSAGE_RATE_LIMIT_CONFIG
      : CHAT_MESSAGE_RATE_LIMIT_CONFIG,
  });

  if (!frequency.ok) {
    throw new ConvexError(
      `Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(frequency.retryAfter / 1000))} seconds.`,
    );
  }

  const estimatedInputTokens = estimateChatInputTokens({
    textLength: args.textLength,
    hasAttachments,
  });
  const tokens = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
    name: 'chatTokenBudget',
    key: baseKey,
    count: estimatedInputTokens,
    reserve: true,
    config: {
      ...CHAT_TOKEN_RATE_LIMIT_CONFIG,
      maxReserved: CHAT_TOKEN_RATE_LIMIT_CONFIG.capacity,
    },
  });

  if (!tokens.ok) {
    throw new ConvexError(
      `Token budget exceeded. Try again in ${Math.max(1, Math.ceil(tokens.retryAfter / 1000))} seconds.`,
    );
  }
}

async function abortExistingRunForThread(
  ctx: MutationCtx,
  args: {
    threadId: Id<'chatThreads'>;
    reason: string;
  },
) {
  const activeRun = (await ctx.runQuery(internal.agentChat.getLatestActiveRunForThreadInternal, {
    threadId: args.threadId,
  })) as Doc<'chatRuns'> | null;

  if (!activeRun) {
    return;
  }

  await abortRunWithReason(ctx, {
    run: activeRun,
    reason: args.reason,
    status: 'aborted',
  });
}

async function resolveRequestedModel(
  ctx: MutationCtx,
  args: {
    requestedModelId?: string;
    threadModelId?: string;
    isSiteAdmin: boolean;
  },
) {
  const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
  return resolveChatModelId({
    requestedModelId: args.requestedModelId,
    threadModelId: args.threadModelId,
    availableModels,
    isSiteAdmin: args.isSiteAdmin,
  });
}

async function createStreamingRun(
  ctx: MutationCtx,
  args: {
    thread: ChatThreadDoc;
    organizationId: string;
    ownerSessionId: string;
    promptMessageId: string;
    model: string;
    useWebSearch: boolean;
  },
): Promise<Id<'chatRuns'>> {
  return (await ctx.runMutation(internal.agentChat.createRunInternal, {
    threadId: args.thread._id,
    agentThreadId: args.thread.agentThreadId,
    organizationId: args.organizationId,
    ownerSessionId: args.ownerSessionId,
    status: 'streaming',
    startedAt: Date.now(),
    promptMessageId: args.promptMessageId,
    provider: 'openrouter',
    model: args.model,
    useWebSearch: args.useWebSearch,
  })) as Id<'chatRuns'>;
}

export const precreateThread = mutation({
  args: {
    text: v.string(),
    attachmentIds: v.array(v.id('chatAttachments')),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'> }> => {
    const { userId, organizationId } = await getCurrentChatContext(ctx);

    if (!args.text.trim() && args.attachmentIds.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const attachments = (await ctx.runQuery(internal.agentChat.getAttachmentsForSendInternal, {
      attachmentIds: args.attachmentIds,
      userId,
      organizationId,
    })) as ChatAttachmentDoc[];
    const { thread } = await resolveThread(ctx, {
      threadId: undefined,
      organizationId,
      userId,
      text: args.text,
      attachments,
      personaId: args.personaId,
      model: args.model,
    });

    return {
      threadId: thread._id,
    };
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.id('chatThreads'),
    text: v.string(),
    attachmentIds: v.array(v.id('chatAttachments')),
    clientMessageId: v.optional(v.string()),
    ownerSessionId: v.string(),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);

    if (!args.text.trim() && args.attachmentIds.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    await reserveChatRateLimitOrThrow(ctx, {
      organizationId,
      userId,
      textLength: args.text.length,
      hasAttachments: args.attachmentIds.length > 0,
    });
    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
    });

    if (args.personaId) {
      const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
      if (!persona) {
        throw new ConvexError('Persona not found.');
      }
    }

    const attachments = (await ctx.runQuery(internal.agentChat.getAttachmentsForSendInternal, {
      attachmentIds: args.attachmentIds,
      userId,
      organizationId,
    })) as ChatAttachmentDoc[];
    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model,
      isSiteAdmin,
    });
    const userMessage = await buildUserMessage(ctx, args.text, attachments);
    const savedPrompt = await baseChatAgent.saveMessages(ctx, {
      threadId: thread.agentThreadId,
      userId,
      messages: [userMessage.message],
      metadata: [
        {
          ...(userMessage.fileIds.length > 0 ? { fileIds: userMessage.fileIds } : {}),
          ...(args.clientMessageId ? { clientMessageId: args.clientMessageId } : {}),
        },
      ],
      failPendingSteps: false,
    });
    const promptMessage = savedPrompt.messages[savedPrompt.messages.length - 1];

    if (!promptMessage) {
      throw new ConvexError('Failed to create prompt message.');
    }

    if (args.attachmentIds.length > 0) {
      await ctx.runMutation(internal.agentChat.assignAttachmentsToMessageInternal, {
        attachmentIds: args.attachmentIds,
        threadId: thread._id,
        agentMessageId: promptMessage._id,
        updatedAt: Date.now(),
      });
    }

    const resolvedPersonaId = args.personaId ?? thread.personaId;
    const runId = await createStreamingRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: promptMessage._id,
      model: selectedModel.modelId,
      useWebSearch: args.useWebSearch ?? false,
    });

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: thread._id,
      patch: {
        personaId: resolvedPersonaId ?? null,
        model: selectedModel.modelId,
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    });
    await ctx.scheduler.runAfter(0, internal.agentChatActions.runChatGenerationInternal, {
      runId,
    });

    return {
      threadId: thread._id,
      runId,
    };
  },
});

export const editUserMessage = mutation({
  args: {
    messageId: v.string(),
    text: v.string(),
    ownerSessionId: v.string(),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);
    const nextText = args.text.trim();

    if (!nextText) {
      throw new ConvexError('Message content is required.');
    }

    const [message] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [args.messageId],
    })) as Array<AgentMessageDoc | null>;

    if (!isTextOnlyUserMessage(message)) {
      throw new ConvexError('Only text-only user messages can be edited.');
    }

    if (!message) {
      throw new ConvexError('Message not found.');
    }

    const thread = (await ctx.runQuery(internal.agentChat.getThreadByAgentThreadIdInternal, {
      agentThreadId: message.threadId,
      organizationId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
    });
    await deleteMessagesAfterPrompt(ctx, message.threadId, message);

    const serialized = await serializeMessage(ctx, components.agent, {
      role: 'user',
      content: nextText,
    });
    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: args.messageId,
      patch: {
        message: serialized.message,
        fileIds: [],
        status: 'success',
      },
    });

    if (!thread.titleManuallyEdited) {
      await ctx.runMutation(internal.agentChat.patchThreadInternal, {
        threadId: thread._id,
        patch: {
          title: deriveThreadTitle({
            text: nextText,
            attachments: [],
          }),
          updatedAt: Date.now(),
          lastMessageAt: Date.now(),
        },
      });
    }

    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model,
      isSiteAdmin,
    });
    const runId = await createStreamingRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: args.messageId,
      model: selectedModel.modelId,
      useWebSearch: args.useWebSearch ?? false,
    });

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: thread._id,
      patch: {
        model: selectedModel.modelId,
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    });
    await ctx.scheduler.runAfter(0, internal.agentChatActions.runChatGenerationInternal, {
      runId,
    });

    return {
      threadId: thread._id,
      runId,
    };
  },
});

export const retryAssistantResponse = mutation({
  args: {
    runId: v.id('chatRuns'),
    ownerSessionId: v.string(),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: args.runId,
      organizationId,
    })) as Doc<'chatRuns'> | null;

    if (!run?.promptMessageId) {
      throw new ConvexError('Run not found.');
    }

    const thread = await getThreadForOrganization(ctx, run.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
    });

    const [promptMessage] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [run.promptMessageId],
    })) as Array<AgentMessageDoc | null>;

    if (!promptMessage) {
      throw new ConvexError('Prompt message not found.');
    }

    await deleteMessagesAfterPrompt(ctx, thread.agentThreadId, promptMessage);

    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model ?? run.model,
      isSiteAdmin,
    });
    const runId = await createStreamingRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: run.promptMessageId,
      model: selectedModel.modelId,
      useWebSearch: args.useWebSearch ?? run.useWebSearch,
    });

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: thread._id,
      patch: {
        model: selectedModel.modelId,
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    });
    await ctx.scheduler.runAfter(0, internal.agentChatActions.runChatGenerationInternal, {
      runId,
    });

    return {
      threadId: thread._id,
      runId,
    };
  },
});

export const continuePrompt = mutation({
  args: {
    threadId: v.id('chatThreads'),
    promptMessageId: v.string(),
    ownerSessionId: v.string(),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    if (args.personaId) {
      const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
      if (!persona) {
        throw new ConvexError('Persona not found.');
      }
    }

    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
    });

    const [promptMessage] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [args.promptMessageId],
    })) as Array<AgentMessageDoc | null>;

    if (!promptMessage) {
      throw new ConvexError('Prompt message not found.');
    }

    await deleteMessagesAfterPrompt(ctx, thread.agentThreadId, promptMessage);

    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model,
      isSiteAdmin,
    });
    const resolvedPersonaId = args.personaId ?? thread.personaId;
    const runId = await createStreamingRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: args.promptMessageId,
      model: selectedModel.modelId,
      useWebSearch: args.useWebSearch ?? false,
    });

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: thread._id,
      patch: {
        personaId: resolvedPersonaId ?? null,
        model: selectedModel.modelId,
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    });
    await ctx.scheduler.runAfter(0, internal.agentChatActions.runChatGenerationInternal, {
      runId,
    });

    return {
      threadId: thread._id,
      runId,
    };
  },
});

export const generateChatAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentChatContext(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const listPersonas = query({
  args: {},
  handler: async (ctx): Promise<PersonaDoc[]> => {
    const { organizationId } = await getCurrentChatContext(ctx);

    return await ctx.db
      .query('aiPersonas')
      .withIndex('by_organizationId_and_createdAt', (q) => q.eq('organizationId', organizationId))
      .collect();
  },
});

export const setThreadPersona = mutation({
  args: {
    threadId: v.id('chatThreads'),
    personaId: v.optional(v.id('aiPersonas')),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    if (args.personaId) {
      const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
      if (!persona) {
        throw new ConvexError('Persona not found.');
      }
    }

    await ctx.db.patch(args.threadId, {
      personaId: args.personaId,
      updatedAt: Date.now(),
    });
  },
});

export const renameThread = mutation({
  args: {
    threadId: v.id('chatThreads'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const title = args.title.trim();

    await ctx.db.patch(args.threadId, {
      title,
      titleManuallyEdited: true,
      updatedAt: Date.now(),
    });
    await updateThreadMetadata(ctx, components.agent, {
      threadId: thread.agentThreadId,
      patch: {
        title,
      },
    });
  },
});

export const setThreadPinned = mutation({
  args: {
    threadId: v.id('chatThreads'),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    await ctx.db.patch(args.threadId, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.id('chatThreads'),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const thread = await getThreadForOrganization(ctx, args.threadId, organizationId);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const runs = await getChatRunsForThread(ctx, args.threadId);
    const attachments = await ctx.db
      .query('chatAttachments')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
      .collect();
    const usageEvents = await ctx.db
      .query('chatUsageEvents')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
      .collect();

    await Promise.all(runs.map((run) => ctx.db.delete(run._id)));
    await Promise.all(attachments.map((attachment) => ctx.db.delete(attachment._id)));
    await Promise.all(usageEvents.map((event) => ctx.db.delete(event._id)));
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: thread.agentThreadId,
    });
    await ctx.db.delete(args.threadId);
  },
});

export const createPersona = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, organizationId } = await getCurrentChatContext(ctx);
    const now = Date.now();

    return await ctx.db.insert('aiPersonas', {
      userId,
      organizationId,
      name: args.name.trim(),
      prompt: args.prompt.trim(),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updatePersona = mutation({
  args: {
    personaId: v.id('aiPersonas'),
    name: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
    if (!persona) {
      throw new ConvexError('Persona not found.');
    }

    await ctx.db.patch(args.personaId, {
      name: args.name.trim(),
      prompt: args.prompt.trim(),
      updatedAt: Date.now(),
    });
  },
});

export const deletePersona = mutation({
  args: {
    personaId: v.id('aiPersonas'),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getCurrentChatContext(ctx);
    const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
    if (!persona) {
      throw new ConvexError('Persona not found.');
    }

    const threads = await ctx.db
      .query('chatThreads')
      .withIndex('by_organizationId_and_updatedAt', (q) => q.eq('organizationId', organizationId))
      .collect();

    await Promise.all(
      threads
        .filter((thread) => thread.personaId === args.personaId)
        .map((thread) =>
          ctx.db.patch(thread._id, {
            personaId: undefined,
            updatedAt: Date.now(),
          }),
        ),
    );

    await ctx.db.delete(args.personaId);
  },
});
