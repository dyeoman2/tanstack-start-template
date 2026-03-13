'use node';

import { type LanguageModelUsage, type ModelMessage, generateText, streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ConvexError, v } from 'convex/values';
import {
  getAuthorizedChatModel,
  type ChatModelId,
  DEFAULT_CHAT_MODEL_ID,
  type ChatModelCatalogEntry,
} from '../src/lib/shared/chat-models';
import {
  buildAttachmentPromptSummary,
  blobToDataUrl,
  clipDocumentPromptText,
  extractDocumentText,
} from './lib/chatAttachments';
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

type StoredChatMessagePart =
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
    }
  | {
      type: 'attachment';
      attachmentId: Id<'aiAttachments'>;
      kind: 'image' | 'document';
      name: string;
      mimeType: string;
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
type AiAttachmentDoc = Doc<'aiAttachments'>;
type AssistantChunkWrite = (content: string) => Promise<void>;

const DEFAULT_PERSONA_PROMPT = 'You are an AI assistant that helps people find information.';
const SUMMARY_SYSTEM_PROMPT =
  'Summarize the prior conversation for future continuation. Capture the user goal, constraints, decisions, referenced attachments, and unresolved questions. Keep it concise and factual.';
const STREAM_FLUSH_INTERVAL_MS = 120;
const STREAM_FLUSH_CHAR_THRESHOLD = 400;
const RECENT_CONTEXT_MESSAGE_LIMIT = 12;
const PROMPT_CHAR_BUDGET = 12_000;
const CURRENT_ATTACHMENT_TOTAL_CHAR_BUDGET = 12_000;
const SUMMARY_CHAR_LIMIT = 1_500;

let openRouterProvider: ReturnType<typeof createOpenRouter> | null = null;
const modelCache = new Map<string, ReturnType<ReturnType<typeof createOpenRouter>['chat']>>();
const SEARCHABLE_MODEL_CACHE_SUFFIX = ':web-search';

function getTextFromParts(parts: StoredChatMessagePart[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'attachment' || part.type === 'document') {
        return part.name;
      }

      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function getAttachmentIdsFromMessage(message: AiMessageDoc) {
  return (message.parts as StoredChatMessagePart[])
    .filter((part): part is Extract<StoredChatMessagePart, { type: 'attachment' }> => part.type === 'attachment')
    .map((part) => part.attachmentId);
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

function buildUsageMetadata(usage: LanguageModelUsage | undefined) {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
  };
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
  return (await ctx.runQuery(internal.chat.getCurrentChatUserContextInternal, {})) as {
    userId: string;
    organizationId: string;
    isSiteAdmin: boolean;
  };
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

async function loadAttachmentsByIds(
  ctx: ActionCtx,
  attachmentIds: Id<'aiAttachments'>[],
  organizationId: string,
): Promise<Map<Id<'aiAttachments'>, AiAttachmentDoc>> {
  const uniqueIds = [...new Set(attachmentIds)];
  if (uniqueIds.length === 0) {
    return new Map<Id<'aiAttachments'>, AiAttachmentDoc>();
  }

  const attachments = (await ctx.runQuery(internal.chat.getAttachmentsByIdsInternal, {
    attachmentIds: uniqueIds,
    organizationId,
  })) as Array<AiAttachmentDoc | null>;

  return new Map<Id<'aiAttachments'>, AiAttachmentDoc>(
    attachments
      .filter((attachment): attachment is AiAttachmentDoc => attachment !== null)
      .map((attachment) => [attachment._id, attachment] as const),
  );
}

type AttachmentBudget = {
  remainingDocumentChars: number;
};

async function attachmentToPromptContent(
  ctx: ActionCtx,
  attachment: AiAttachmentDoc,
  mode: 'historical' | 'current',
  budget: AttachmentBudget,
) {
  if (mode === 'historical') {
    return [{ type: 'text' as const, text: attachment.promptSummary }];
  }

  if (attachment.kind === 'image') {
    if (!attachment.rawStorageId) {
      return [{ type: 'text' as const, text: attachment.promptSummary }];
    }

    const blob = await ctx.storage.get(attachment.rawStorageId);
    if (!blob) {
      return [{ type: 'text' as const, text: attachment.promptSummary }];
    }

    return [
      { type: 'text' as const, text: `Image attachment: ${attachment.name}` },
      {
        type: 'image' as const,
        image: await blobToDataUrl(blob, attachment.mimeType),
      },
    ];
  }

  if (!attachment.extractedTextStorageId || budget.remainingDocumentChars <= 0) {
    return [{ type: 'text' as const, text: attachment.promptSummary }];
  }

  const blob = await ctx.storage.get(attachment.extractedTextStorageId);
  if (!blob) {
    return [{ type: 'text' as const, text: attachment.promptSummary }];
  }

  const clipLimit = Math.min(6_000, budget.remainingDocumentChars);
  const promptText = clipDocumentPromptText(await blob.text(), clipLimit);
  budget.remainingDocumentChars -= promptText.length;

  return [
    {
      type: 'text' as const,
      text: promptText
        ? `[Document: ${attachment.name}]\n\n${promptText}`
        : attachment.promptSummary,
    },
  ];
}

function legacyPartToPromptContent(
  part: Extract<StoredChatMessagePart, { type: 'image' | 'document' }>,
  mode: 'historical' | 'current',
) {
  if (part.type === 'image') {
    if (mode === 'current') {
      return [
        { type: 'text' as const, text: `Image attachment: ${part.name ?? 'image'}` },
        { type: 'image' as const, image: part.image },
      ];
    }

    return [{ type: 'text' as const, text: `Image attachment: ${part.name ?? 'image'}` }];
  }

  if (mode === 'current') {
    return [{ type: 'text' as const, text: `[Document: ${part.name}]\n\n${part.content}` }];
  }

  return [
    {
      type: 'text' as const,
      text: `[Document: ${part.name}]\n\n${clipDocumentPromptText(part.content, 600)}`,
    },
  ];
}

async function toModelMessage(
  ctx: ActionCtx,
  message: AiMessageDoc,
  attachments: Map<Id<'aiAttachments'>, AiAttachmentDoc>,
  mode: 'historical' | 'current',
  budget: AttachmentBudget,
): Promise<ModelMessage> {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: getTextFromParts(message.parts as StoredChatMessagePart[]),
    };
  }

  const content = (
    await Promise.all(
      (message.parts as StoredChatMessagePart[]).map(async (part) => {
        if (part.type === 'text') {
          return [{ type: 'text' as const, text: part.text }];
        }

        if (part.type === 'attachment') {
          const attachment = attachments.get(part.attachmentId);
          if (!attachment) {
            return [{ type: 'text' as const, text: `Attachment unavailable: ${part.name}` }];
          }

          return await attachmentToPromptContent(ctx, attachment, mode, budget);
        }

        if (part.type === 'image' || part.type === 'document') {
          return legacyPartToPromptContent(part, mode);
        }

        return [];
      }),
    )
  ).flat();

  return {
    role: 'user',
    content,
  };
}

function estimateMessageLength(message: ModelMessage) {
  if (typeof message.content === 'string') {
    return message.content.length;
  }

  return message.content.reduce((total, part) => {
    if (part.type === 'text') {
      return total + part.text.length;
    }

    if (part.type === 'image') {
      return total + 32;
    }

    return total;
  }, 0);
}

function getEligibleGenerationMessages(messages: AiMessageDoc[]) {
  return messages.filter((message) => {
    if (message.role === 'user') {
      return true;
    }

    return message.status === 'complete' && getTextFromParts(message.parts as StoredChatMessagePart[]).trim();
  });
}

async function buildPromptMessages(
  ctx: ActionCtx,
  args: {
    thread: AiThreadDoc;
    messages: AiMessageDoc[];
    organizationId: string;
  },
) {
  const eligibleMessages = getEligibleGenerationMessages(args.messages);
  const tailCandidates = eligibleMessages.slice(-RECENT_CONTEXT_MESSAGE_LIMIT);
  const previewAttachments = await loadAttachmentsByIds(
    ctx,
    tailCandidates.flatMap(getAttachmentIdsFromMessage),
    args.organizationId,
  );
  const previewBudget = { remainingDocumentChars: 0 };
  const previewMessages = await Promise.all(
    tailCandidates.map((message) =>
      toModelMessage(ctx, message, previewAttachments, 'historical', previewBudget),
    ),
  );

  let consumedChars = args.thread.contextSummary?.length ?? 0;
  const selectedIndices: number[] = [];

  for (let index = previewMessages.length - 1; index >= 0; index -= 1) {
    const length = estimateMessageLength(previewMessages[index]);
    if (selectedIndices.length === 0 || consumedChars + length <= PROMPT_CHAR_BUDGET) {
      selectedIndices.unshift(index);
      consumedChars += length;
    }
  }

  const selectedMessages = selectedIndices.map((index) => tailCandidates[index]);
  const selectedAttachmentMap = await loadAttachmentsByIds(
    ctx,
    selectedMessages.flatMap(getAttachmentIdsFromMessage),
    args.organizationId,
  );
  const currentUserMessageId = [...selectedMessages]
    .reverse()
    .find((message) => message.role === 'user')?._id;
  const attachmentBudget: AttachmentBudget = {
    remainingDocumentChars: CURRENT_ATTACHMENT_TOTAL_CHAR_BUDGET,
  };

  const finalMessages = await Promise.all(
    selectedMessages.map((message) =>
      toModelMessage(
        ctx,
        message,
        selectedAttachmentMap,
        message._id === currentUserMessageId ? 'current' : 'historical',
        attachmentBudget,
      ),
    ),
  );

  return {
    messages: finalMessages,
    needsSummaryRefresh: eligibleMessages.length > selectedMessages.length,
  };
}

function messageToSummaryText(
  message: AiMessageDoc,
  attachments: Map<Id<'aiAttachments'>, AiAttachmentDoc>,
) {
  const text = (message.parts as StoredChatMessagePart[])
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'attachment') {
        return attachments.get(part.attachmentId)?.promptSummary ?? part.name;
      }

      if (part.type === 'document') {
        return `[Document: ${part.name}] ${clipDocumentPromptText(part.content, 300)}`;
      }

      if (part.type === 'image') {
        return `Image attachment: ${part.name ?? 'image'}`;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  return `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`;
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

  const queueFlush = () => {
    if (!buffer) {
      return;
    }

    const content = buffer;
    buffer = '';
    flushChain = flushChain.then(async () => {
      await options.flush(content);
    });
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
      queueFlush();
    }, flushIntervalMs);
  };

  return {
    push(chunk: string) {
      buffer += chunk;

      if (buffer.length >= flushCharThreshold) {
        cancelTimer();
        queueFlush();
        return;
      }

      scheduleFlush();
    },
    async flushAndClose() {
      cancelTimer();
      queueFlush();
      while (buffer) {
        queueFlush();
        await flushChain;
      }
      await flushChain;
    },
  };
}

function createBufferedAssistantPersister(ctx: ActionCtx, messageId: Id<'aiMessages'>) {
  return createBufferedChunkWriter({
    flush: async (content) => {
      await ctx.runMutation(internal.chat.appendAssistantDraftInternal, {
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
  const timings = {
    startedAt: Date.now(),
    providerStartedAt: 0,
    firstTokenAt: 0,
    finalTokenAt: 0,
    finalizedAt: 0,
  };
  const prompt = await getPersonaPrompt(ctx, args.thread, args.organizationId);
  const promptMessages = await buildPromptMessages(ctx, {
    thread: args.thread,
    messages: args.messages,
    organizationId: args.organizationId,
  });
  const persister = createBufferedAssistantPersister(ctx, args.assistantMessageId);

  try {
    const openRouterWebSearchProviderOptions =
      !args.useWebSearch || args.model.supportsWebSearch === false
        ? undefined
        : getOpenRouterWebSearchProviderOptions(args.model.modelId);

    timings.providerStartedAt = Date.now();
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
        ...(args.thread.contextSummary
          ? [
              {
                role: 'system' as const,
                content: `Conversation summary:\n${args.thread.contextSummary}`,
              },
            ]
          : []),
        ...promptMessages.messages,
      ],
    });

    let finalText = '';
    for await (const chunk of result.textStream) {
      if (!timings.firstTokenAt) {
        timings.firstTokenAt = Date.now();
      }

      finalText += chunk;
      persister.push(chunk);
    }

    timings.finalTokenAt = Date.now();
    await persister.flushAndClose();

    const usage = await result.usage;
    const sourceParts = await getResultSourceParts(result);

    try {
      await ctx.runMutation(internal.chat.markAssistantCompleteInternal, {
        messageId: args.assistantMessageId,
        text: finalText,
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
        text: finalText,
        provider: 'openrouter',
        model: args.model.modelId,
        usage: buildUsageMetadata(usage),
      });
    }

    timings.finalizedAt = Date.now();
    console.info('[chat timings]', {
      threadId: args.threadId,
      assistantMessageId: args.assistantMessageId,
      promptAssemblyMs: timings.providerStartedAt - timings.startedAt,
      timeToFirstTokenMs: timings.firstTokenAt ? timings.firstTokenAt - timings.providerStartedAt : null,
      streamDurationMs: timings.finalTokenAt ? timings.finalTokenAt - timings.providerStartedAt : null,
      finalizeMs: timings.finalizedAt ? timings.finalizedAt - timings.finalTokenAt : null,
    });

    if (promptMessages.needsSummaryRefresh) {
      await ctx.scheduler.runAfter(0, internal.chatActions.refreshThreadContextSummaryInternal, {
        threadId: args.threadId,
        organizationId: args.organizationId,
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

export const createChatAttachmentFromUpload = action({
  args: {
    storageId: v.id('_storage'),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<(AiAttachmentDoc & { previewUrl: string | null }) | null> => {
    const { userId, organizationId } = await getAuthenticatedContext(ctx);
    const kind = args.mimeType.toLowerCase().startsWith('image/') ? 'image' : 'document';
    const initialSummary = buildAttachmentPromptSummary({
      kind,
      name: args.name,
    });

    const attachmentId = await ctx.runMutation(internal.chat.createAttachmentInternal, {
      messageId: undefined,
      threadId: undefined,
      userId,
      organizationId,
      kind,
      name: args.name,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      rawStorageId: args.storageId,
      extractedTextStorageId: undefined,
      promptSummary: initialSummary,
      status: 'pending',
      errorMessage: undefined,
    });

    try {
      let extractedTextStorageId: Id<'_storage'> | undefined;
      let promptSummary = initialSummary;

      if (kind === 'document') {
        const blob = await ctx.storage.get(args.storageId);
        if (!blob) {
          throw new Error('Uploaded file was not found.');
        }

        const extractedText = await extractDocumentText(blob, args.name, args.mimeType);
        extractedTextStorageId = await ctx.storage.store(
          new Blob([extractedText], { type: 'text/plain' }),
        );
        promptSummary = buildAttachmentPromptSummary({
          kind,
          name: args.name,
          text: extractedText,
        });
      }

      await ctx.runMutation(internal.chat.updateAttachmentInternal, {
        attachmentId,
        extractedTextStorageId,
        promptSummary,
        status: 'ready',
        errorMessage: undefined,
      });

      const [attachment] = (await ctx.runQuery(internal.chat.getAttachmentsByIdsInternal, {
        attachmentIds: [attachmentId],
        organizationId,
      })) as Array<AiAttachmentDoc | null>;

      if (!attachment) {
        throw new Error('Attachment record was not found after processing.');
      }

      return {
        ...attachment,
        previewUrl:
          kind === 'image' && args.storageId ? await ctx.storage.getUrl(args.storageId) : null,
      };
    } catch (error) {
      await ctx.runMutation(internal.chat.updateAttachmentInternal, {
        attachmentId,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to process attachment.',
      });

      throw error;
    }
  },
});

export const refreshThreadContextSummaryInternal = internalAction({
  args: {
    threadId: v.id('aiThreads'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const generationContext = await ctx.runQuery(internal.chat.getThreadGenerationContextInternal, {
      threadId: args.threadId,
      organizationId: args.organizationId,
    });

    if (!generationContext) {
      return;
    }

    const eligibleMessages = getEligibleGenerationMessages(generationContext.messages);
    const messagesToSummarize = eligibleMessages.slice(0, -RECENT_CONTEXT_MESSAGE_LIMIT);

    if (messagesToSummarize.length === 0) {
      return;
    }

    const attachmentMap = await loadAttachmentsByIds(
      ctx,
      messagesToSummarize.flatMap(getAttachmentIdsFromMessage),
      args.organizationId,
    );
    const transcript = messagesToSummarize
      .map((message) => messageToSummaryText(message, attachmentMap))
      .join('\n\n');

    const result = await generateText({
      model: getChatModel(DEFAULT_CHAT_MODEL_ID, false),
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
    });

    await ctx.runMutation(internal.chat.setThreadContextSummaryInternal, {
      threadId: args.threadId,
      summary: result.text.trim().slice(0, SUMMARY_CHAR_LIMIT),
      throughMessageId: messagesToSummarize[messagesToSummarize.length - 1]?._id,
    });
  },
});

export const streamAssistantReplyInternal = internalAction({
  args: {
    assistantMessageId: v.id('aiMessages'),
    threadId: v.id('aiThreads'),
    organizationId: v.string(),
    isSiteAdmin: v.boolean(),
    model: v.optional(v.string()),
    useWebSearch: v.boolean(),
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
      model: modelId,
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
    text: v.string(),
    attachmentIds: v.array(v.id('aiAttachments')),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: Id<'aiThreads'>; assistantMessageId: Id<'aiMessages'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);

    if (!args.text.trim() && args.attachmentIds.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const { threadId, assistantMessageId } = await ctx.runMutation(
      internal.chat.prepareMessageSendInternal,
      {
        threadId: args.threadId,
        personaId: args.personaId,
        userId,
        organizationId,
        text: args.text,
        attachmentIds: args.attachmentIds,
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
