'use node';

import {
  createThread,
  getFile,
  serializeMessage,
  storeFile,
} from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';
import type { ModelMessage } from 'ai';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, type ActionCtx } from './_generated/server';
import {
  buildAttachmentPromptSummary,
  extractDocumentText,
} from './lib/chatAttachments';
import {
  DEFAULT_CHAT_AGENT_NAME,
  DEFAULT_PERSONA_PROMPT,
  deriveThreadTitle,
  resolveChatModelId,
  type ChatAttachmentDoc,
  type ChatThreadDoc,
} from './lib/agentChat';
import {
  buildChatSystemPrompt,
  createChatAgent,
  fetchPreparedChatMessages,
  recordChatUsageEvent,
} from './lib/chatAgentRuntime';

type PreparedStreamPayload = {
  preparedMessages: unknown[];
  promptMessageId: string;
  runId: Id<'chatRuns'>;
  systemPrompt: string;
  threadId: Id<'chatThreads'>;
  assistantMessageId: string;
  streamId: string;
  model: string;
  provider: 'openrouter';
  supportsWebSearch: boolean;
};

type AuthenticatedChatContext = {
  userId: string;
  organizationId: string;
  isSiteAdmin: boolean;
};

type ChatRateLimitReservation =
  | {
      ok: true;
      estimatedInputTokens: number;
    }
  | {
      ok: false;
      retryAfter?: number;
      errorMessage: string;
    };

type AgentMessageDoc = {
  _id: string;
  threadId: string;
  order: number;
  stepOrder: number;
  status: string;
  error?: string;
  fileIds?: string[];
  message?: {
    role: string;
    content:
      | string
      | Array<{
          type?: string;
          text?: string;
        }>;
  };
};

function toSourceMetadata(
  sources: Array<{
    sourceType: 'url';
    id: string;
    url: string;
    title?: string;
  }>,
) {
  return sources.map((source) => ({
    type: 'source' as const,
    sourceType: 'url' as const,
    id: source.id,
    url: source.url,
    title: source.title,
  }));
}

async function getAuthenticatedContext(ctx: ActionCtx): Promise<AuthenticatedChatContext> {
  return (await ctx.runQuery(internal.agentChat.getCurrentChatContextInternal, {})) as AuthenticatedChatContext;
}

async function resolveThread(
  ctx: ActionCtx,
  args: {
    threadId?: Id<'chatThreads'>;
    organizationId: string;
    userId: string;
    text: string;
    attachments: ChatAttachmentDoc[];
    personaId?: Id<'aiPersonas'>;
    model?: string;
  },
) {
  if (args.threadId) {
    const existingThread = (await ctx.runQuery(internal.agentChat.getThreadForOrganizationInternal, {
      threadId: args.threadId,
      organizationId: args.organizationId,
    })) as ChatThreadDoc | null;

    if (!existingThread) {
      throw new ConvexError('Thread not found.');
    }

    return {
      thread: existingThread,
    };
  }

  const now = Date.now();
  const title = deriveThreadTitle({
    text: args.text,
    attachments: args.attachments.map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
    })),
  });
  const agentThreadId = await createThread(ctx, components.agent, {
    userId: args.userId,
    title,
  });
  const threadId = (await ctx.runMutation(internal.agentChat.createThreadShellInternal, {
    userId: args.userId,
    organizationId: args.organizationId,
    agentThreadId,
    title,
    personaId: args.personaId,
    model: args.model,
    titleManuallyEdited: false,
    createdAt: now,
  })) as Id<'chatThreads'>;

  const thread: ChatThreadDoc = {
    _id: threadId,
    _creationTime: now,
    userId: args.userId,
    organizationId: args.organizationId,
    agentThreadId,
    title,
    pinned: false,
    personaId: args.personaId,
    model: args.model,
    titleManuallyEdited: false,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };

  return {
    thread,
  };
}

async function buildUserMessage(
  ctx: ActionCtx,
  text: string,
  attachments: ChatAttachmentDoc[],
) {
  const content: Array<
    | { type: 'text'; text: string }
    | NonNullable<Awaited<ReturnType<typeof getFile>>['imagePart']>
    | Awaited<ReturnType<typeof getFile>>['filePart']
  > = [];
  const trimmedText = text.trim();
  const fileIds: string[] = [];

  if (trimmedText) {
    content.push({
      type: 'text',
      text: trimmedText,
    });
  }

  for (const attachment of attachments) {
    if (!attachment.agentFileId) {
      content.push({
        type: 'text',
        text: attachment.promptSummary,
      });
      continue;
    }

    const file = await getFile(ctx, components.agent, attachment.agentFileId);
    fileIds.push(file.file.fileId);

    if (attachment.kind === 'image' && file.imagePart) {
      content.push(file.imagePart);
      continue;
    }

    content.push(file.filePart);
    content.push({
      type: 'text',
      text: attachment.promptSummary,
    });
  }

  const message: ModelMessage = {
    role: 'user',
    content: content.length === 1 && content[0]?.type === 'text' ? content[0].text : content,
  };

  return {
    message,
    fileIds,
  };
}

async function resolveSystemPrompt(
  ctx: ActionCtx,
  organizationId: string,
  personaId?: Id<'aiPersonas'>,
) {
  if (!personaId) {
    return DEFAULT_PERSONA_PROMPT;
  }

  const persona = (await ctx.runQuery(internal.agentChat.getPersonaByIdInternal, {
    personaId,
    organizationId,
  })) as Doc<'aiPersonas'> | null;

  return persona?.prompt ?? DEFAULT_PERSONA_PROMPT;
}

async function preparePendingAssistantRun(
  ctx: ActionCtx,
  args: {
    thread: ChatThreadDoc;
    organizationId: string;
    ownerSessionId: string;
    promptMessageId: string;
    preparedMessages: unknown[];
    pendingAssistantMessage: {
      _id: string;
      order: number;
      stepOrder: number;
    };
    model: string;
    supportsWebSearch: boolean;
    useWebSearch: boolean;
    personaId?: Id<'aiPersonas'>;
  },
): Promise<PreparedStreamPayload> {
  const systemPrompt = buildChatSystemPrompt({
    instructions: await resolveSystemPrompt(ctx, args.organizationId, args.personaId),
    threadSummary: args.thread.summary,
    useWebSearch: args.useWebSearch && args.supportsWebSearch,
  });
  const streamId = await ctx.runMutation(components.agent.streams.create, {
    threadId: args.thread.agentThreadId,
    userId: args.thread.userId,
    agentName: DEFAULT_CHAT_AGENT_NAME,
    model: args.model,
    provider: 'openrouter',
    format: 'UIMessageChunk',
    order: args.pendingAssistantMessage.order,
    stepOrder: args.pendingAssistantMessage.stepOrder,
  });
  const runId = (await ctx.runMutation(internal.agentChat.createRunInternal, {
    threadId: args.thread._id,
    agentThreadId: args.thread.agentThreadId,
    organizationId: args.organizationId,
    ownerSessionId: args.ownerSessionId,
    agentStreamId: streamId,
    status: 'streaming',
    startedAt: Date.now(),
    activeAssistantMessageId: args.pendingAssistantMessage._id,
    promptMessageId: args.promptMessageId,
    provider: 'openrouter',
    model: args.model,
    useWebSearch: args.useWebSearch,
  })) as Id<'chatRuns'>;

  await ctx.runMutation(internal.agentChat.patchThreadInternal, {
    threadId: args.thread._id,
    patch: {
      personaId: args.personaId ?? null,
      model: args.model,
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
    },
  });

  return {
    preparedMessages: args.preparedMessages,
    promptMessageId: args.promptMessageId,
    runId,
    systemPrompt,
    threadId: args.thread._id,
    assistantMessageId: args.pendingAssistantMessage._id,
    streamId,
    model: args.model,
    provider: 'openrouter',
    supportsWebSearch: args.supportsWebSearch,
  };
}

async function buildPreparedMessages(
  ctx: ActionCtx,
  args: {
    userId: string;
    thread: ChatThreadDoc;
    promptMessageId: string;
    model: string;
    systemPrompt: string;
    useWebSearch: boolean;
  },
) {
  return await fetchPreparedChatMessages(ctx, {
    userId: args.userId,
    threadId: args.thread.agentThreadId,
    promptMessageId: args.promptMessageId,
    modelId: args.model,
    instructions: args.systemPrompt,
    useWebSearch: args.useWebSearch,
  });
}

function isTextOnlyUserMessage(message: AgentMessageDoc | null) {
  if (!message || message.message?.role !== 'user') {
    return false;
  }

  if ((message.fileIds?.length ?? 0) > 0) {
    return false;
  }

  const content = message.message?.content;
  if (typeof content === 'string') {
    return true;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }

  return content.every((part) => part?.type === 'text');
}

async function deleteMessagesAfterPrompt(
  ctx: ActionCtx,
  threadId: string,
  promptMessage: Pick<AgentMessageDoc, 'order' | 'stepOrder'>,
) {
  let startOrder = promptMessage.order;
  let startStepOrder = promptMessage.stepOrder + 1;

  while (true) {
    const result = await ctx.runMutation(components.agent.messages.deleteByOrder, {
      threadId,
      startOrder,
      startStepOrder,
      endOrder: Number.MAX_SAFE_INTEGER,
    });

    if (result.isDone) {
      return;
    }

    startOrder = result.lastOrder ?? startOrder;
    startStepOrder = (result.lastStepOrder ?? 0) + 1;
  }
}

export const createChatAttachmentFromUpload = action({
  args: {
    storageId: v.id('_storage'),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, organizationId } = await getAuthenticatedContext(ctx);
    const kind = args.mimeType.toLowerCase().startsWith('image/') ? 'image' : 'document';
    const now = Date.now();
    const initialSummary = buildAttachmentPromptSummary({
      kind,
      name: args.name,
    });
    const attachmentId = (await ctx.runMutation(internal.agentChat.createAttachmentInternal, {
      threadId: undefined,
      agentMessageId: undefined,
      userId,
      organizationId,
      kind,
      name: args.name,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      rawStorageId: args.storageId,
      extractedTextStorageId: undefined,
      agentFileId: undefined,
      promptSummary: initialSummary,
      status: 'pending',
      errorMessage: undefined,
      createdAt: now,
    })) as Id<'chatAttachments'>;

    try {
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) {
        throw new Error('Uploaded file was not found.');
      }

      const stored = await storeFile(ctx, components.agent, blob, {
        filename: args.name,
      });
      let extractedTextStorageId: Id<'_storage'> | undefined;
      let promptSummary = initialSummary;

      if (kind === 'document') {
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

      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId,
        patch: {
          extractedTextStorageId: extractedTextStorageId ?? null,
          agentFileId: stored.file.fileId,
          promptSummary,
          status: 'ready',
          errorMessage: null,
          updatedAt: Date.now(),
        },
      });

      const attachment = (await ctx.runQuery(internal.agentChat.getAttachmentByIdInternal, {
        attachmentId,
        organizationId,
      })) as ChatAttachmentDoc | null;

      if (!attachment) {
        throw new Error('Attachment was not found after processing.');
      }

      return {
        ...attachment,
        previewUrl: kind === 'image' ? stored.file.url : null,
      };
    } catch (error) {
      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId,
        patch: {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Failed to process attachment.',
          updatedAt: Date.now(),
        },
      });

      throw error;
    }
  },
});

async function abortRun(
  ctx: ActionCtx,
  args: {
    runId: Id<'chatRuns'>;
    reason: string;
    status: 'aborted' | 'error';
    partialText?: string;
  },
) {
  const { organizationId } = await getAuthenticatedContext(ctx);
  const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
    runId: args.runId,
    organizationId,
  })) as Doc<'chatRuns'> | null;

  if (!run) {
    return false;
  }

  const partialText =
    args.partialText?.trim() ||
    (run.agentStreamId
      ? (
          await ctx.runQuery(components.agent.streams.listDeltas, {
            threadId: run.agentThreadId,
            cursors: [{ streamId: run.agentStreamId, cursor: 0 }],
          })
        )
          .flatMap((delta) => delta.parts)
          .flatMap((part) =>
            part &&
            typeof part === 'object' &&
            'type' in part &&
            part.type === 'text-delta' &&
            'text' in part &&
            typeof part.text === 'string'
              ? [part.text]
              : part &&
                  typeof part === 'object' &&
                  'type' in part &&
                  part.type === 'text-delta' &&
                  'delta' in part &&
                  typeof part.delta === 'string'
                ? [part.delta]
              : [],
          )
          .join('')
          .trim()
      : '');
  if (run.activeAssistantMessageId) {
    const agent = createChatAgent({
      modelId: run.model,
      useWebSearch: run.useWebSearch,
    });
    if (partialText) {
      await agent.saveMessages(ctx, {
        threadId: run.agentThreadId,
        messages: [{ role: 'assistant', content: partialText }],
        promptMessageId: run.promptMessageId,
        pendingMessageId: run.activeAssistantMessageId,
        metadata: [
          {
            status: 'failed',
            error: args.reason,
            model: run.model,
            provider: run.provider,
          },
        ],
      });
    } else {
      await ctx.runMutation(components.agent.messages.finalizeMessage, {
        messageId: run.activeAssistantMessageId,
        result: {
          status: 'failed',
          error: args.reason,
        },
      });
    }
  }

  await ctx.runMutation(internal.agentChat.patchRunInternal, {
    runId: run._id,
    patch: {
      agentStreamId: null,
      status: args.status,
      endedAt: Date.now(),
      errorMessage: args.reason,
    },
  });
  if (run.agentStreamId) {
    await ctx.runMutation(components.agent.streams.abort, {
      streamId: run.agentStreamId,
      reason: args.reason,
    });
  }
  await ctx.runMutation(internal.agentChat.patchThreadInternal, {
    threadId: run.threadId,
    patch: {
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
    },
  });

  return true;
}

export const reserveChatRateLimit = action({
  args: {
    textLength: v.optional(v.number()),
    hasAttachments: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ChatRateLimitReservation> => {
    const { organizationId, userId } = await getAuthenticatedContext(ctx);
    const baseKey = `${organizationId}:${userId}`;
    const hasAttachments = args.hasAttachments ?? false;
    const estimatedInputTokens = Math.max(
      1,
      Math.ceil((args.textLength ?? 0) / 4) + (hasAttachments ? 1_200 : 0),
    );
    const frequency = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
      name: hasAttachments ? 'chatStreamWithAttachments' : 'chatStream',
      key: baseKey,
      config: {
        kind: 'token bucket',
        rate: hasAttachments ? 4 : 12,
        period: 60 * 1000,
        capacity: hasAttachments ? 4 : 12,
      },
    });
    if (!frequency.ok) {
      return {
        ok: false as const,
        retryAfter: frequency.retryAfter,
        errorMessage: `Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(frequency.retryAfter / 1000))} seconds.`,
      };
    }
    const tokens = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
      name: 'chatTokenBudget',
      key: baseKey,
      count: estimatedInputTokens,
      reserve: true,
      config: {
        kind: 'token bucket',
        rate: 40_000,
        period: 60 * 1000,
        capacity: 40_000,
        maxReserved: 40_000,
      },
    });
    if (!tokens.ok) {
      return {
        ok: false as const,
        retryAfter: tokens.retryAfter,
        errorMessage: `Token budget exceeded. Try again in ${Math.max(1, Math.ceil(tokens.retryAfter / 1000))} seconds.`,
      };
    }
    return {
      ok: true as const,
      estimatedInputTokens,
    };
  },
});

export const appendStreamParts = action({
  args: {
    runId: v.id('chatRuns'),
    start: v.number(),
    end: v.number(),
    parts: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getAuthenticatedContext(ctx);
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: args.runId,
      organizationId,
    })) as Doc<'chatRuns'> | null;

    if (!run || run.status !== 'streaming' || !run.agentStreamId) {
      return false;
    }

    return await ctx.runMutation(components.agent.streams.addDelta, {
      streamId: run.agentStreamId,
      start: args.start,
      end: args.end,
      parts: args.parts,
    });
  },
});

export const prepareStream = action({
  args: {
    threadId: v.optional(v.id('chatThreads')),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
    text: v.string(),
    attachmentIds: v.array(v.id('chatAttachments')),
    clientMessageId: v.optional(v.string()),
    ownerSessionId: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedStreamPayload> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);
    const useWebSearch = args.useWebSearch ?? false;

    if (!args.text.trim() && args.attachmentIds.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const attachments = (await ctx.runQuery(internal.agentChat.getAttachmentsForSendInternal, {
      attachmentIds: args.attachmentIds,
      userId,
      organizationId,
    })) as ChatAttachmentDoc[];
    const { thread } = await resolveThread(ctx, {
      threadId: args.threadId,
      organizationId,
      userId,
      text: args.text,
      attachments,
      personaId: args.personaId,
      model: args.model,
    });
    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const selectedModel = resolveChatModelId({
      requestedModelId: args.model,
      threadModelId: thread.model,
      availableModels,
      isSiteAdmin,
    });
    const systemPrompt = buildChatSystemPrompt({
      instructions: await resolveSystemPrompt(ctx, organizationId, args.personaId),
      threadSummary: thread.summary,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });
    const agent = createChatAgent({
      modelId: selectedModel.modelId,
      instructions: systemPrompt,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });
    const resolvedPersonaId = args.personaId ?? thread.personaId;
    const userMessage = await buildUserMessage(ctx, args.text, attachments);
    const savedPrompt = await agent.saveMessages(ctx, {
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

    await ctx.runMutation(internal.agentChat.assignAttachmentsToMessageInternal, {
      attachmentIds: args.attachmentIds,
      threadId: thread._id,
      agentMessageId: promptMessage._id,
      updatedAt: Date.now(),
    });

    const preparedMessages = await buildPreparedMessages(ctx, {
      userId,
      thread,
      promptMessageId: promptMessage._id,
      model: selectedModel.modelId,
      systemPrompt,
      useWebSearch,
    });
    const savedPending = await agent.saveMessages(ctx, {
      threadId: thread.agentThreadId,
      userId,
      promptMessageId: promptMessage._id,
      messages: [{ role: 'assistant', content: '' }],
      metadata: [{ status: 'pending', model: selectedModel.modelId, provider: 'openrouter' }],
      failPendingSteps: false,
    });
    const pendingAssistantMessage = savedPending.messages[savedPending.messages.length - 1];
    if (!pendingAssistantMessage) {
      throw new ConvexError('Failed to create pending assistant message.');
    }

    return await preparePendingAssistantRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: promptMessage._id,
      preparedMessages,
      pendingAssistantMessage,
      model: selectedModel.modelId,
      supportsWebSearch: selectedModel.supportsWebSearch !== false,
      useWebSearch,
      personaId: resolvedPersonaId ?? undefined,
    });
  },
});

export const prepareEditedStream = action({
  args: {
    messageId: v.string(),
    text: v.string(),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
    ownerSessionId: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedStreamPayload> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);
    const nextText = args.text.trim();
    const useWebSearch = args.useWebSearch ?? false;

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
    const targetMessage: AgentMessageDoc = message;

    const thread = (await ctx.runQuery(internal.agentChat.getThreadByAgentThreadIdInternal, {
      agentThreadId: targetMessage.threadId,
      organizationId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    await deleteMessagesAfterPrompt(ctx, targetMessage.threadId, targetMessage);

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

    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const selectedModel = resolveChatModelId({
      requestedModelId: args.model,
      threadModelId: thread.model,
      availableModels,
      isSiteAdmin,
    });
    const systemPrompt = buildChatSystemPrompt({
      instructions: await resolveSystemPrompt(ctx, organizationId, thread.personaId),
      threadSummary: thread.summary,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });
    const agent = createChatAgent({
      modelId: selectedModel.modelId,
      instructions: systemPrompt,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });
    const preparedMessages = await buildPreparedMessages(ctx, {
      userId,
      thread,
      promptMessageId: args.messageId,
      model: selectedModel.modelId,
      systemPrompt,
      useWebSearch,
    });
    const saved = await agent.saveMessages(ctx, {
      threadId: thread.agentThreadId,
      userId,
      promptMessageId: args.messageId,
      messages: [{ role: 'assistant', content: '' }],
      metadata: [{ status: 'pending', model: selectedModel.modelId, provider: 'openrouter' }],
      failPendingSteps: false,
    });
    const pendingAssistantMessage = saved.messages[saved.messages.length - 1];
    if (!pendingAssistantMessage) {
      throw new ConvexError('Failed to create pending assistant message.');
    }

    return await preparePendingAssistantRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: args.messageId,
      preparedMessages,
      pendingAssistantMessage,
      model: selectedModel.modelId,
      supportsWebSearch: selectedModel.supportsWebSearch !== false,
      useWebSearch,
      personaId: thread.personaId,
    });
  },
});

export const prepareRetryStream = action({
  args: {
    runId: v.id('chatRuns'),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
    ownerSessionId: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedStreamPayload> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: args.runId,
      organizationId,
    })) as Doc<'chatRuns'> | null;
    if (!run || !run.promptMessageId || !run.activeAssistantMessageId) {
      throw new ConvexError('Run not found.');
    }

    const thread = (await ctx.runQuery(internal.agentChat.getThreadForOrganizationInternal, {
      threadId: run.threadId,
      organizationId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const selectedModel = resolveChatModelId({
      requestedModelId: args.model,
      threadModelId: thread.model ?? run.model,
      availableModels,
      isSiteAdmin,
    });
    const useWebSearch = args.useWebSearch ?? run.useWebSearch;
    const systemPrompt = buildChatSystemPrompt({
      instructions: await resolveSystemPrompt(ctx, organizationId, thread.personaId),
      threadSummary: thread.summary,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });
    const preparedMessages = await buildPreparedMessages(ctx, {
      userId,
      thread,
      promptMessageId: run.promptMessageId,
      model: selectedModel.modelId,
      systemPrompt,
      useWebSearch,
    });

    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: run.activeAssistantMessageId,
      patch: {
        message: {
          role: 'assistant',
          content: '',
        },
        status: 'pending',
        model: selectedModel.modelId,
        provider: 'openrouter',
      },
    });
    const [updatedAssistantMessage] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [run.activeAssistantMessageId],
    })) as Array<AgentMessageDoc | null>;
    if (!updatedAssistantMessage) {
      throw new ConvexError('Failed to load pending assistant message.');
    }

    return await preparePendingAssistantRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: run.promptMessageId,
      preparedMessages,
      pendingAssistantMessage: updatedAssistantMessage,
      model: selectedModel.modelId,
      supportsWebSearch: selectedModel.supportsWebSearch !== false,
      useWebSearch,
      personaId: thread.personaId,
    });
  },
});

export const finalizeStream = action({
  args: {
    runId: v.id('chatRuns'),
    finalText: v.string(),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
    }),
    sources: v.optional(
      v.array(
        v.object({
          sourceType: v.literal('url'),
          id: v.string(),
          url: v.string(),
          title: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getAuthenticatedContext(ctx);
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: args.runId,
      organizationId,
    })) as Doc<'chatRuns'> | null;

    if (!run) {
      throw new ConvexError('Run not found.');
    }

    const agent = createChatAgent({
      modelId: run.model,
      useWebSearch: run.useWebSearch,
    });
    await agent.saveMessages(ctx, {
      threadId: run.agentThreadId,
      messages: [{ role: 'assistant', content: args.finalText }],
      promptMessageId: run.promptMessageId,
      pendingMessageId: run.activeAssistantMessageId,
      metadata: [
        {
          status: 'success',
          model: run.model,
          provider: run.provider,
          usage: {
            promptTokens: args.usage.inputTokens ?? 0,
            completionTokens: args.usage.outputTokens ?? 0,
            totalTokens: args.usage.totalTokens ?? 0,
          },
          sources: args.sources ? toSourceMetadata(args.sources) : undefined,
        },
      ],
    });
    await ctx.runMutation(internal.agentChat.patchRunInternal, {
      runId: run._id,
      patch: {
        agentStreamId: null,
        status: 'complete',
        endedAt: Date.now(),
        errorMessage: null,
      },
    });
    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: run.threadId,
      patch: {
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    });
    if (run.agentStreamId) {
      await ctx.runMutation(components.agent.streams.finish, {
        streamId: run.agentStreamId,
        });
    }
    await ctx.scheduler.runAfter(0, internal.chatBackground.runPostCompletionJobs, {
      runId: run._id,
    });
  },
});

export const recordStreamUsage = action({
  args: {
    runId: v.id('chatRuns'),
    usage: v.object({
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
    }),
    sourceCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { organizationId } = await getAuthenticatedContext(ctx);
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: args.runId,
      organizationId,
    })) as Doc<'chatRuns'> | null;

    if (!run) {
      return false;
    }

    await recordChatUsageEvent(ctx, {
      agentThreadId: run.agentThreadId,
      runId: run._id,
      agentName: DEFAULT_CHAT_AGENT_NAME,
      model: run.model ?? 'unknown',
      provider: run.provider ?? 'openrouter',
      totalTokens: args.usage.totalTokens,
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      providerMetadata: {
        sourceCount: args.sourceCount ?? 0,
      },
    });

    return true;
  },
});

export const abortStream = action({
  args: {
    runId: v.id('chatRuns'),
    reason: v.string(),
    status: v.union(v.literal('aborted'), v.literal('error')),
    partialText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await abortRun(ctx, args);
  },
});

export const stopRun = action({
  args: {
    runId: v.id('chatRuns'),
  },
  handler: async (ctx, args) => {
    return await abortRun(ctx, {
      runId: args.runId,
      reason: 'Stopped by user.',
      status: 'aborted',
    });
  },
});

export const quickCreateThread = action({
  args: {
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    text: v.string(),
    attachmentIds: v.array(v.id('chatAttachments')),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: Id<'chatThreads'>; promptMessageId: string }> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);

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

    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const selectedModel = resolveChatModelId({
      requestedModelId: args.model,
      threadModelId: thread.model,
      availableModels,
      isSiteAdmin,
    });
    const useWebSearch = false;
    const systemPrompt = buildChatSystemPrompt({
      instructions: await resolveSystemPrompt(ctx, organizationId, args.personaId),
      threadSummary: thread.summary,
      useWebSearch,
    });
    const agent = createChatAgent({
      modelId: selectedModel.modelId,
      instructions: systemPrompt,
      useWebSearch,
    });

    const userMessage = await buildUserMessage(ctx, args.text, attachments);
    const savedPrompt = await agent.saveMessages(ctx, {
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

    return {
      threadId: thread._id,
      promptMessageId: promptMessage._id,
    };
  },
});

export const prepareStreamForMessage = action({
  args: {
    threadId: v.id('chatThreads'),
    promptMessageId: v.string(),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    useWebSearch: v.optional(v.boolean()),
    ownerSessionId: v.string(),
  },
  handler: async (ctx, args): Promise<PreparedStreamPayload> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);
    const useWebSearch = args.useWebSearch ?? false;

    const [thread, availableModels] = await Promise.all([
      ctx.runQuery(internal.agentChat.getThreadForOrganizationInternal, {
        threadId: args.threadId,
        organizationId,
      }) as Promise<ChatThreadDoc | null>,
      ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {}) as Promise<
        Awaited<ReturnType<typeof ctx.runQuery>>
      >,
    ]);

    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const selectedModel = resolveChatModelId({
      requestedModelId: args.model,
      threadModelId: thread.model,
      availableModels,
      isSiteAdmin,
    });
    const resolvedPersonaId = args.personaId ?? thread.personaId;
    const systemPrompt = buildChatSystemPrompt({
      instructions: await resolveSystemPrompt(ctx, organizationId, resolvedPersonaId),
      threadSummary: thread.summary,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });
    const agent = createChatAgent({
      modelId: selectedModel.modelId,
      instructions: systemPrompt,
      useWebSearch: useWebSearch && selectedModel.supportsWebSearch !== false,
    });

    const preparedMessages = await buildPreparedMessages(ctx, {
      userId,
      thread,
      promptMessageId: args.promptMessageId,
      model: selectedModel.modelId,
      systemPrompt,
      useWebSearch,
    });

    const savedPending = await agent.saveMessages(ctx, {
      threadId: thread.agentThreadId,
      userId,
      promptMessageId: args.promptMessageId,
      messages: [{ role: 'assistant', content: '' }],
      metadata: [{ status: 'pending', model: selectedModel.modelId, provider: 'openrouter' }],
      failPendingSteps: false,
    });
    const pendingAssistantMessage = savedPending.messages[savedPending.messages.length - 1];
    if (!pendingAssistantMessage) {
      throw new ConvexError('Failed to create pending assistant message.');
    }

    return await preparePendingAssistantRun(ctx, {
      thread,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: args.promptMessageId,
      preparedMessages,
      pendingAssistantMessage,
      model: selectedModel.modelId,
      supportsWebSearch: selectedModel.supportsWebSearch !== false,
      useWebSearch,
      personaId: resolvedPersonaId ?? undefined,
    });
  },
});
