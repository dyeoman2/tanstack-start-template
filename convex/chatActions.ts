'use node';

import { type LanguageModelUsage, type ModelMessage, streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ConvexError, v } from 'convex/values';
import {
  getAuthorizedChatModel,
  type ChatModelId,
  DEFAULT_CHAT_MODEL_ID,
  type ChatModelCatalogEntry,
} from '../src/lib/shared/chat-models';
import {
  getOpenRouterWebSearchPlugin,
  getOpenRouterWebSearchProviderOptions,
  shouldUseOpenRouterWebSearch,
  type OpenRouterWebSearchSource,
  toSourceUrlParts,
} from '../src/features/chat/lib/openrouter-web-search';
import { getOpenRouterConfig } from '../src/lib/server/openrouter';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { type ActionCtx, action, internalAction } from './_generated/server';

type ChatMessagePart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      image: string;
      mimeType?: string;
      name?: string;
    }
  | {
      type: 'document';
      name: string;
      content: string;
      mimeType: string;
      images?: Array<{
        pageNumber: number;
        name: string;
        width: number;
        height: number;
        dataUrl: string;
      }>;
    }
  | {
      type: 'source-url';
      sourceId: string;
      url: string;
      title?: string;
    }
  | {
      type: 'source-document';
      sourceId: string;
      mediaType: string;
      title: string;
      filename?: string;
    };

type AiMessageDoc = Doc<'aiMessages'>;
type AiThreadDoc = Doc<'aiThreads'>;
type AssistantChunkWrite = (content: string) => Promise<void>;

const messagePartValidator = v.union(
  v.object({
    type: v.literal('text'),
    text: v.string(),
  }),
  v.object({
    type: v.literal('image'),
    image: v.string(),
    mimeType: v.optional(v.string()),
    name: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('document'),
    name: v.string(),
    content: v.string(),
    mimeType: v.string(),
    images: v.optional(
      v.array(
        v.object({
          pageNumber: v.number(),
          name: v.string(),
          width: v.number(),
          height: v.number(),
          dataUrl: v.string(),
        }),
      ),
    ),
  }),
  v.object({
    type: v.literal('source-url'),
    sourceId: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('source-document'),
    sourceId: v.string(),
    mediaType: v.string(),
    title: v.string(),
    filename: v.optional(v.string()),
  }),
);

const DEFAULT_PERSONA_PROMPT = 'You are an AI assistant that helps people find information.';
const STREAM_FLUSH_INTERVAL_MS = 150;
const STREAM_FLUSH_CHAR_THRESHOLD = 750;

let openRouterProvider: ReturnType<typeof createOpenRouter> | null = null;
const modelCache = new Map<string, ReturnType<ReturnType<typeof createOpenRouter>['chat']>>();
const SEARCHABLE_MODEL_CACHE_SUFFIX = ':web-search';

function getTextFromParts(parts: ChatMessagePart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'document') {
        return part.name;
      }

      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function toModelMessage(message: AiMessageDoc): ModelMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: getTextFromParts(message.parts as ChatMessagePart[]),
    };
  }

  return {
    role: 'user',
    content: (message.parts as ChatMessagePart[]).flatMap((part) => {
      if (part.type === 'text') {
        return [{ type: 'text' as const, text: part.text }];
      }

      if (part.type === 'image') {
        return [{ type: 'image' as const, image: part.image }];
      }

      if (part.type !== 'document') {
        return [];
      }

      const documentParts: Array<
        | {
            type: 'text';
            text: string;
          }
        | {
            type: 'image';
            image: string;
          }
      > = [
        {
          type: 'text',
          text: `[Document: ${part.name}]\n\n${part.content}`,
        },
      ];

      if (part.images?.length) {
        documentParts.push({
          type: 'text',
          text: `\n\n[This document contains ${part.images.length} image(s)]`,
        });

        for (const image of part.images) {
          documentParts.push({
            type: 'image',
            image: image.dataUrl,
          });
        }
      }

      return documentParts;
    }),
  };
}

function buildUsageMetadata(usage: LanguageModelUsage | undefined) {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
  };
}

function getOpenRouterProvider() {
  if (!openRouterProvider) {
    const config = getOpenRouterConfig();
    openRouterProvider = createOpenRouter({
      apiKey: config.apiKey,
      compatibility: config.compatibility,
      ...(config.headers ? { headers: config.headers } : {}),
    });
  }

  return openRouterProvider;
}

function getModelCacheKey(modelId: ChatModelId, supportsWebSearch: boolean) {
  const usesWebSearch = supportsWebSearch && shouldUseOpenRouterWebSearch(modelId);
  return usesWebSearch ? `${modelId}${SEARCHABLE_MODEL_CACHE_SUFFIX}` : modelId;
}

function getChatModel(modelId: ChatModelId, supportsWebSearch: boolean) {
  const cacheKey = getModelCacheKey(modelId, supportsWebSearch);
  const cachedModel = modelCache.get(cacheKey);
  if (cachedModel) {
    return cachedModel;
  }

  const usesWebSearch = supportsWebSearch && shouldUseOpenRouterWebSearch(modelId);
  const nextModel = getOpenRouterProvider().chat(modelId, {
    ...(usesWebSearch ? { plugins: [getOpenRouterWebSearchPlugin(modelId)] } : {}),
  });
  modelCache.set(cacheKey, nextModel);
  return nextModel;
}

export function resolveChatModelId(
  modelId: string | undefined,
  threadModelId: string | undefined,
  messages: AiMessageDoc[],
  availableModels: ChatModelCatalogEntry[],
  isSiteAdmin: boolean,
): ChatModelId {
  if (modelId) {
    const authorization = getAuthorizedChatModel(modelId, availableModels, isSiteAdmin);
    if (!authorization.ok) {
      if (authorization.reason === 'forbidden') {
        throw new ConvexError('This chat model is only available to site admins.');
      }

      throw new ConvexError('Unsupported chat model.');
    }

    return authorization.model.modelId;
  }

  if (threadModelId) {
    const authorization = getAuthorizedChatModel(threadModelId, availableModels, isSiteAdmin);
    if (authorization.ok) {
      return authorization.model.modelId;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.model) {
      const authorization = getAuthorizedChatModel(message.model, availableModels, isSiteAdmin);
      if (authorization.ok) {
        return authorization.model.modelId;
      }
    }
  }

  return DEFAULT_CHAT_MODEL_ID;
}

function getAuthorizedChatModelEntry(
  modelId: ChatModelId,
  availableModels: ChatModelCatalogEntry[],
  isSiteAdmin: boolean,
) {
  const authorization = getAuthorizedChatModel(modelId, availableModels, isSiteAdmin);
  if (!authorization.ok) {
    if (authorization.reason === 'forbidden') {
      throw new ConvexError('This chat model is only available to site admins.');
    }

    throw new ConvexError('Unsupported chat model.');
  }

  return authorization.model;
}

async function getResultSourceParts(
  result: { sources: PromiseLike<OpenRouterWebSearchSource[]> },
) {
  try {
    const sources = await result.sources;
    return toSourceUrlParts(sources);
  } catch (error) {
    console.error('[chat] Failed to resolve OpenRouter sources', error);
    return [];
  }
}

async function getAuthenticatedContext(ctx: ActionCtx) {
  return await ctx.runQuery(internal.chat.getCurrentChatUserContextInternal, {});
}

async function getPersonaPrompt(ctx: ActionCtx, thread: AiThreadDoc, organizationId: string) {
  if (!thread.personaId) {
    return DEFAULT_PERSONA_PROMPT;
  }

  const persona = await ctx.runQuery(internal.chat.getPersonaByIdInternal, {
    personaId: thread.personaId,
    organizationId,
  });

  return persona?.prompt ?? DEFAULT_PERSONA_PROMPT;
}

export function createBufferedChunkWriter(options: {
  flush: AssistantChunkWrite;
  flushIntervalMs?: number;
  flushCharThreshold?: number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let buffer = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushChain = Promise.resolve();
  const flushIntervalMs = options.flushIntervalMs ?? STREAM_FLUSH_INTERVAL_MS;
  const flushCharThreshold = options.flushCharThreshold ?? STREAM_FLUSH_CHAR_THRESHOLD;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));

  const flush = async () => {
    if (!buffer) {
      return;
    }

    const content = buffer;
    buffer = '';
    flushChain = flushChain.then(async () => {
      await options.flush(content);
    });
    await flushChain;
  };

  const cancelTimer = () => {
    if (!flushTimer) {
      return;
    }

    cancel(flushTimer);
    flushTimer = null;
  };

  const scheduleFlush = () => {
    if (flushTimer) {
      return;
    }

    flushTimer = schedule(() => {
      flushTimer = null;
      void flush();
    }, flushIntervalMs);
  };

  return {
    async push(chunk: string) {
      buffer += chunk;

      if (buffer.length >= flushCharThreshold) {
        cancelTimer();
        await flush();
        return;
      }

      scheduleFlush();
    },
    async flushAndClose() {
      cancelTimer();
      await flush();
      await flushChain;
    },
  };
}

function createBufferedAssistantPersister(ctx: ActionCtx, messageId: Id<'aiMessages'>) {
  return createBufferedChunkWriter({
    flush: async (content) => {
      await ctx.runMutation(internal.chat.appendAssistantChunkInternal, {
        messageId,
        content,
      });
    },
  });
}

async function streamAssistantReply(
  ctx: ActionCtx,
  args: {
    assistantMessageId: Id<'aiMessages'>;
    threadId: Id<'aiThreads'>;
    organizationId: string;
    thread: AiThreadDoc;
    messages: AiMessageDoc[];
    model: ChatModelCatalogEntry;
    useWebSearch: boolean;
  },
) {
  const prompt = await getPersonaPrompt(ctx, args.thread, args.organizationId);
  const persister = createBufferedAssistantPersister(ctx, args.assistantMessageId);

  try {
    const openRouterWebSearchProviderOptions =
      !args.useWebSearch || args.model.supportsWebSearch === false
        ? undefined
        : getOpenRouterWebSearchProviderOptions(args.model.modelId);

    const result = await streamText({
      model: getChatModel(args.model.modelId, args.useWebSearch),
      providerOptions: {
        openrouter: {
          provider: {
            zdr: true,
            data_collection: 'deny',
            ...(openRouterWebSearchProviderOptions ?? {}),
          },
        },
      },
      messages: [
        { role: 'system', content: prompt },
        ...args.messages.map((message: AiMessageDoc) => toModelMessage(message)),
      ],
    });

    for await (const chunk of result.textStream) {
      await persister.push(chunk);
    }

    await persister.flushAndClose();

    const usage = await result.usage;
    const sourceParts = await getResultSourceParts(result);

    try {
      await ctx.runMutation(internal.chat.markAssistantCompleteInternal, {
        messageId: args.assistantMessageId,
        provider: 'openrouter',
        model: args.model.modelId,
        usage: buildUsageMetadata(usage),
        sourceParts,
      });
    } catch (error) {
      if (sourceParts.length === 0) {
        throw error;
      }

      console.error('[chat] Failed to persist sources, retrying without them', error);
      await ctx.runMutation(internal.chat.markAssistantCompleteInternal, {
        messageId: args.assistantMessageId,
        provider: 'openrouter',
        model: args.model.modelId,
        usage: buildUsageMetadata(usage),
      });
    }
  } catch (error) {
    await persister.flushAndClose();
    await ctx.runMutation(internal.chat.markAssistantErrorInternal, {
      messageId: args.assistantMessageId,
      errorMessage: error instanceof Error ? error.message : 'Streaming failed.',
    });

    throw error;
  }
}

export const streamAssistantReplyInternal = internalAction({
  args: {
    assistantMessageId: v.id('aiMessages'),
    threadId: v.id('aiThreads'),
    organizationId: v.string(),
    isSiteAdmin: v.boolean(),
    model: v.optional(v.string()),
    useWebSearch: v.boolean(),
    submittedParts: v.array(messagePartValidator),
  },
  handler: async (ctx, args) => {
    const generationContext = await ctx.runQuery(internal.chat.getThreadGenerationContextInternal, {
      threadId: args.threadId,
      organizationId: args.organizationId,
      excludeMessageId: args.assistantMessageId,
    });

    if (!generationContext) {
      await ctx.runMutation(internal.chat.markAssistantErrorInternal, {
        messageId: args.assistantMessageId,
        errorMessage: 'Thread not found.',
      });
      return;
    }

    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const modelId = resolveChatModelId(
      args.model,
      generationContext.thread.model,
      generationContext.messages,
      availableModels,
      args.isSiteAdmin,
    );
    const model = getAuthorizedChatModelEntry(modelId, availableModels, args.isSiteAdmin);

    await ctx.runMutation(internal.chat.updateThreadAfterMessageInternal, {
      threadId: args.threadId,
      parts: args.submittedParts,
      model: modelId,
      titleFallback: generationContext.thread.title,
    });

    await streamAssistantReply(ctx, {
      assistantMessageId: args.assistantMessageId,
      threadId: args.threadId,
      organizationId: args.organizationId,
      thread: generationContext.thread,
      messages: generationContext.messages,
      model,
      useWebSearch: args.useWebSearch,
    });
  },
});

export const sendChatMessage = action({
  args: {
    threadId: v.optional(v.id('aiThreads')),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
    parts: v.array(messagePartValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: Id<'aiThreads'>; assistantMessageId: Id<'aiMessages'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);

    if (args.parts.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const { threadId, assistantMessageId } = await ctx.runMutation(
      internal.chat.prepareMessageSendInternal,
      {
        threadId: args.threadId,
        personaId: args.personaId,
        model: args.model,
        userId,
        organizationId,
        parts: args.parts,
        clientMessageId: args.clientMessageId,
      },
    );

    try {
      await ctx.scheduler.runAfter(0, internal.chatActions.streamAssistantReplyInternal, {
        assistantMessageId,
        threadId,
        organizationId,
        isSiteAdmin,
        model: args.model,
        useWebSearch: args.useWebSearch ?? false,
        submittedParts: args.parts,
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.markAssistantErrorInternal, {
        messageId: assistantMessageId,
        errorMessage: error instanceof Error ? error.message : 'Failed to start streaming.',
      });

      throw error;
    }

    return { threadId, assistantMessageId };
  },
});

export const editUserMessageAndRegenerate = action({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: Id<'aiThreads'>; assistantMessageId: Id<'aiMessages'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);
    const { threadId, assistantMessageId } = await ctx.runMutation(
      internal.chat.prepareRegenerateMessageInternal,
      {
        messageId: args.messageId,
        text: args.text,
        userId,
        organizationId,
      },
    );

    try {
      await ctx.scheduler.runAfter(0, internal.chatActions.streamAssistantReplyInternal, {
        assistantMessageId,
        threadId,
        organizationId,
        isSiteAdmin,
        model: args.model,
        useWebSearch: args.useWebSearch ?? false,
        submittedParts: [{ type: 'text', text: args.text }],
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.markAssistantErrorInternal, {
        messageId: assistantMessageId,
        errorMessage: error instanceof Error ? error.message : 'Failed to start streaming.',
      });

      throw error;
    }

    return {
      threadId,
      assistantMessageId,
    };
  },
});
