'use node';

import {
  getFile,
  serializeMessage,
  storeFile,
} from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';
import type { ModelMessage } from 'ai';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  action,
  internalAction,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server';
import {
  buildAttachmentPromptSummary,
  extractDocumentText,
} from './lib/chatAttachments';
import {
  deriveThreadTitle,
  type ChatAttachmentDoc,
  type ChatThreadDoc,
} from './lib/agentChat';
import {
  baseChatAgent,
  buildChatRequestConfig,
  type ChatWebSearchSource,
} from './lib/chatAgentRuntime';
import { DEFAULT_CHAT_MODEL_ID, type ChatModelId } from '../src/lib/shared/chat-models';

type ChatDataCtx = Pick<ActionCtx, 'runQuery' | 'runMutation'> | Pick<MutationCtx, 'runQuery' | 'runMutation'>;

export type AuthenticatedChatContext = {
  userId: string;
  organizationId: string;
  isSiteAdmin: boolean;
};

export type AgentMessageDoc = {
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
          sourceType?: string;
          url?: string;
          title?: string;
          id?: string;
        }>;
  };
};

function mapOpenRouterSources(sources: unknown[] | undefined) {
  if (!sources) {
    return [];
  }

  return sources.flatMap((source) => {
    if (!source || typeof source !== 'object') {
      return [];
    }

    const value = source as {
      sourceType?: string;
      id?: string;
      url?: string;
      title?: string;
    };
    if (value.sourceType !== 'url' || !value.id || !value.url) {
      return [];
    }

    return [
      {
        sourceType: 'url' as const,
        id: value.id,
        url: value.url,
        title: value.title,
      },
    ];
  });
}

function dedupeSources(
  sources: Array<{
    sourceType: 'url';
    id: string;
    url: string;
    title?: string;
  }>,
) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

async function getAssistantMessageForOrder(
  ctx: ChatDataCtx,
  agentThreadId: string,
  order: number,
) {
  const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: agentThreadId,
    order: 'desc',
    paginationOpts: {
      numItems: 20,
      cursor: null,
    },
  });

  return (
    messages.page.find(
      (message) => message.order === order && message.message?.role === 'assistant',
    ) ?? null
  );
}

async function getStreamIdForOrder(
  ctx: ChatDataCtx,
  agentThreadId: string,
  order: number,
) {
  const streams = await ctx.runQuery(components.agent.streams.list, {
    threadId: agentThreadId,
    startOrder: order,
    statuses: ['streaming', 'finished', 'aborted'],
  });

  return streams.find((stream) => stream.order === order)?.streamId ?? null;
}

function sourcePartsFromSources(
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
    ...(source.title ? { title: source.title } : {}),
  }));
}

async function appendSourcesToAssistantMessage(
  ctx: ChatDataCtx,
  assistantMessageId: string,
  sources: Array<{
    sourceType: 'url';
    id: string;
    url: string;
    title?: string;
  }>,
) {
  if (sources.length === 0) {
    return;
  }

  const [message] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
    messageIds: [assistantMessageId],
  })) as Array<AgentMessageDoc | null>;
  if (!message || message.message?.role !== 'assistant') {
    return;
  }

  const existingContent = message.message.content;
  const textContent =
    typeof existingContent === 'string'
      ? existingContent
      : Array.isArray(existingContent)
        ? existingContent
            .flatMap((part) =>
              part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [],
            )
            .join('')
        : '';
  const existingSourceUrls = new Set(
    Array.isArray(existingContent)
      ? existingContent.flatMap((part) =>
          part?.type === 'source' &&
          part.sourceType === 'url' &&
          typeof part.url === 'string'
            ? [part.url]
            : [],
        )
      : [],
  );
  const nextSources = sourcePartsFromSources(sources).filter(
    (source) => !existingSourceUrls.has(source.url),
  );

  if (nextSources.length === 0) {
    return;
  }

  await ctx.runMutation(components.agent.messages.updateMessage, {
    messageId: assistantMessageId,
    patch: {
      message: {
        role: 'assistant',
        content: textContent
          ? [{ type: 'text' as const, text: textContent }, ...nextSources]
          : nextSources,
      },
    },
  });
}

async function getStreamPartialText(
  ctx: ChatDataCtx,
  run: Pick<Doc<'chatRuns'>, 'agentStreamId' | 'agentThreadId'>,
) {
  if (!run.agentStreamId) {
    return '';
  }

  return (
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
    .trim();
}

export async function getAuthenticatedContext(ctx: ActionCtx): Promise<AuthenticatedChatContext> {
  return (await ctx.runQuery(internal.agentChat.getCurrentChatContextInternal, {})) as AuthenticatedChatContext;
}

export async function resolveThread(
  ctx: MutationCtx,
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
  const { threadId: agentThreadId } = await baseChatAgent.createThread(ctx, {
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

export async function buildUserMessage(
  ctx: MutationCtx | ActionCtx,
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

export async function resolveSystemPrompt(
  ctx: MutationCtx | ActionCtx,
  organizationId: string,
  personaId?: Id<'aiPersonas'>,
) {
  if (!personaId) {
    return undefined;
  }

  const persona = (await ctx.runQuery(internal.agentChat.getPersonaByIdInternal, {
    personaId,
    organizationId,
  })) as Doc<'aiPersonas'> | null;

  return persona?.prompt;
}

export function isTextOnlyUserMessage(message: AgentMessageDoc | null) {
  if (!message || message.message?.role !== 'user') {
    return false;
  }

  if ((message.fileIds?.length ?? 0) > 0) {
    return false;
  }

  const content = message.message.content;
  if (typeof content === 'string') {
    return true;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }

  return content.every((part) => part?.type === 'text');
}

export async function deleteMessagesAfterPrompt(
  ctx: MutationCtx | ActionCtx,
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

export async function abortRunWithReason(
  ctx: ChatDataCtx,
  args: {
    run: Doc<'chatRuns'>;
    reason: string;
    status: 'aborted' | 'error';
    partialText?: string;
  },
) {
  const run = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
    runId: args.run._id,
  })) as Doc<'chatRuns'> | null;

  if (!run || run.status !== 'streaming') {
    return false;
  }

  const partialText = args.partialText?.trim() || (await getStreamPartialText(ctx, run));
  if (run.activeAssistantMessageId) {
    if (partialText) {
      const serialized = await serializeMessage(ctx, components.agent, {
        role: 'assistant',
        content: partialText,
      });
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: run.activeAssistantMessageId,
        patch: {
          message: serialized.message,
          status: 'failed',
          error: args.reason,
          model: run.model,
          provider: run.provider,
        },
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

export const runChatGenerationInternal = internalAction({
  args: {
    runId: v.id('chatRuns'),
  },
  handler: async (ctx, args) => {
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
      runId: args.runId,
    })) as Doc<'chatRuns'> | null;

    if (!run || run.status !== 'streaming' || !run.promptMessageId) {
      return;
    }

    const thread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
      threadId: run.threadId,
    })) as ChatThreadDoc | null;

    if (!thread) {
      await ctx.runMutation(internal.agentChat.patchRunInternal, {
        runId: args.runId,
        patch: {
          status: 'error',
          endedAt: Date.now(),
          errorMessage: 'Thread not found.',
        },
      });
      return;
    }

    const collectedSources: ChatWebSearchSource[] = [];

    try {
      const { thread: continuedThread } = await baseChatAgent.continueThread(ctx, {
        threadId: run.agentThreadId,
        userId: thread.userId,
      });
      const requestConfig = buildChatRequestConfig({
        modelId: (run.model as ChatModelId | undefined) ?? DEFAULT_CHAT_MODEL_ID,
        instructions: await resolveSystemPrompt(ctx, thread.organizationId, thread.personaId),
        useWebSearch: run.useWebSearch,
        onWebSearchResults: (results) => {
          collectedSources.push(...results);
        },
      });
      const streamArgs =
        'tools' in requestConfig
          ? {
              promptMessageId: run.promptMessageId,
              model: requestConfig.model,
              system: requestConfig.system,
              tools: requestConfig.tools,
              stopWhen: requestConfig.stopWhen as any,
            }
          : {
              promptMessageId: run.promptMessageId,
              model: requestConfig.model,
              system: requestConfig.system,
              stopWhen: requestConfig.stopWhen as any,
            };
      const result = await (continuedThread.streamText as unknown as (
        args: typeof streamArgs,
        options: {
          saveStreamDeltas: {
            chunking: 'word';
            throttleMs: number;
            returnImmediately: true;
          };
        },
      ) => Promise<any>)(streamArgs, {
        saveStreamDeltas: {
          chunking: 'word',
          throttleMs: 250,
          returnImmediately: true,
        },
      });

      const [assistantMessage, streamId, currentRun] = await Promise.all([
        getAssistantMessageForOrder(ctx, run.agentThreadId, result.order),
        getStreamIdForOrder(ctx, run.agentThreadId, result.order),
        ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
          runId: args.runId,
        }) as Promise<Doc<'chatRuns'> | null>,
      ]);

      if (!currentRun || currentRun.status !== 'streaming') {
        return;
      }

      await ctx.runMutation(internal.agentChat.patchRunInternal, {
        runId: args.runId,
        patch: {
          activeAssistantMessageId: assistantMessage?._id ?? currentRun.activeAssistantMessageId ?? null,
          agentStreamId: streamId ?? currentRun.agentStreamId ?? null,
        },
      });

      await result.consumeStream();
      await result.text;
      const allSources = dedupeSources([
        ...mapOpenRouterSources(await result.sources),
        ...collectedSources.map((source) => ({
          sourceType: 'url' as const,
          id: source.id,
          url: source.url,
          title: source.title,
        })),
      ]);

      const finalizedRun = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
        runId: args.runId,
      })) as Doc<'chatRuns'> | null;
      if (!finalizedRun || finalizedRun.status !== 'streaming') {
        return;
      }

      if (assistantMessage?._id && allSources.length > 0) {
        await appendSourcesToAssistantMessage(ctx, assistantMessage._id, allSources);
      }

      await ctx.runMutation(internal.agentChat.patchRunInternal, {
        runId: args.runId,
        patch: {
          agentStreamId: null,
          status: 'complete',
          endedAt: Date.now(),
          errorMessage: null,
          ...(assistantMessage?._id ? { activeAssistantMessageId: assistantMessage._id } : {}),
        },
      });
      await ctx.runMutation(internal.agentChat.patchThreadInternal, {
        threadId: run.threadId,
        patch: {
          updatedAt: Date.now(),
          lastMessageAt: Date.now(),
        },
      });
      await ctx.scheduler.runAfter(0, internal.chatBackground.runPostCompletionJobs, {
        runId: args.runId,
      });
    } catch (error) {
      const latestRun = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
        runId: args.runId,
      })) as Doc<'chatRuns'> | null;

      if (!latestRun || latestRun.status === 'aborted') {
        return;
      }

      await abortRunWithReason(ctx, {
        run: latestRun,
        reason: error instanceof Error ? error.message : 'Streaming failed.',
        status: 'error',
      });
    }
  },
});

export const stopRun = action({
  args: {
    runId: v.id('chatRuns'),
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

    return await abortRunWithReason(ctx, {
      run,
      reason: 'Stopped by user.',
      status: 'aborted',
    });
  },
});
