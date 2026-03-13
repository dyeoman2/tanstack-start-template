import {
  DeltaStreamer,
  compressUIMessageChunks,
  serializeMessage,
  startGeneration,
} from '@convex-dev/agent';
import { streamText as streamTextAi } from 'ai';
import type { StepResult, ToolSet } from 'ai';
import { ConvexError } from 'convex/values';
import { z } from 'zod';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { type ActionCtx, httpAction } from './_generated/server';
import {
  type AgentMessageDoc,
  abortRun,
  buildUserMessage,
  deleteMessagesAfterPrompt,
  getAuthenticatedContext,
  isTextOnlyUserMessage,
  resolveSystemPrompt,
  resolveThread,
} from './agentChatActions';
import type { ChatThreadDoc } from './lib/agentChat';
import { deriveThreadTitle, resolveChatModelId } from './lib/agentChat';
import { buildChatSystemPrompt, createChatAgent } from './lib/chatAgentRuntime';

const sendRequestSchema = z.object({
  mode: z.literal('send').optional(),
  threadId: z.string().optional(),
  personaId: z.string().optional(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  text: z.string(),
  attachmentIds: z.array(z.string()),
  clientMessageId: z.string().optional(),
  ownerSessionId: z.string(),
});

const editRequestSchema = z.object({
  mode: z.literal('edit'),
  messageId: z.string(),
  text: z.string(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  ownerSessionId: z.string(),
});

const continueRequestSchema = z.object({
  mode: z.literal('continue'),
  threadId: z.string(),
  promptMessageId: z.string(),
  personaId: z.string().optional(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  ownerSessionId: z.string(),
});

const retryRequestSchema = z.object({
  mode: z.literal('retry'),
  runId: z.string(),
  model: z.string().optional(),
  useWebSearch: z.boolean().optional(),
  ownerSessionId: z.string(),
});

const requestSchema = z
  .discriminatedUnion('mode', [
    sendRequestSchema.extend({ mode: z.literal('send') }),
    continueRequestSchema,
    editRequestSchema,
    retryRequestSchema,
  ])
  .or(sendRequestSchema);

type ChatStreamRequest = z.infer<typeof requestSchema>;

type PreparedRuntimeStream = {
  thread: ChatThreadDoc;
  userId: string;
  organizationId: string;
  promptMessageId: string;
  resolvedPersonaId?: Id<'aiPersonas'>;
  modelId: string;
  useWebSearch: boolean;
  supportsWebSearch: boolean;
  systemPrompt: string;
  ownerSessionId: string;
};

type UrlSource = {
  sourceType: 'url';
  id: string;
  url: string;
  title?: string;
};

function buildCorsHeaders(request: Request, extra?: HeadersInit) {
  const origin = request.headers.get('origin') ?? '*';
  const headers = new Headers(extra);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set(
    'Access-Control-Expose-Headers',
    'x-chat-thread-id, x-chat-run-id, x-chat-assistant-message-id, x-chat-stream-id',
  );
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin');
  return headers;
}

function jsonError(request: Request, status: number, errorMessage: string) {
  return Response.json(
    { errorMessage },
    {
      status,
      headers: buildCorsHeaders(request),
    },
  );
}

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

function dedupeSources(sources: UrlSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }
    seen.add(source.url);
    return true;
  });
}

function shouldCreatePendingMessage(steps: StepResult<ToolSet>[]) {
  const step = steps[steps.length - 1];
  if (!step || step.finishReason !== 'tool-calls') {
    return false;
  }
  return step.toolCalls.length === step.toolResults.length;
}

function errorToString(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function resolveModelAndPrompt(
  ctx: ActionCtx,
  args: {
    thread: ChatThreadDoc;
    organizationId: string;
    isSiteAdmin: boolean;
    requestedModelId?: string;
    personaId?: Id<'aiPersonas'>;
    useWebSearch?: boolean;
  },
) {
  const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
  const selectedModel = resolveChatModelId({
    requestedModelId: args.requestedModelId,
    threadModelId: args.thread.model,
    availableModels,
    isSiteAdmin: args.isSiteAdmin,
  });
  const resolvedPersonaId = args.personaId ?? args.thread.personaId;
  const useWebSearch = args.useWebSearch ?? false;
  const supportsWebSearch = selectedModel.supportsWebSearch !== false;
  const systemPrompt = buildChatSystemPrompt({
    instructions: await resolveSystemPrompt(ctx, args.organizationId, resolvedPersonaId),
    threadSummary: args.thread.summary,
    useWebSearch: useWebSearch && supportsWebSearch,
  });

  return {
    modelId: selectedModel.modelId,
    resolvedPersonaId,
    useWebSearch,
    supportsWebSearch,
    systemPrompt,
  };
}

async function getPendingAssistantMessage(ctx: ActionCtx, agentThreadId: string, order: number) {
  const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: agentThreadId,
    order: 'desc',
    statuses: ['pending'],
    paginationOpts: {
      numItems: 10,
      cursor: null,
    },
  });

  return (
    messages.page.find(
      (message) => message.order === order && message.message?.role === 'assistant',
    ) ?? null
  );
}

function sourcePartsFromSources(sources: UrlSource[]) {
  return sources.map((source) => ({
    type: 'source' as const,
    sourceType: 'url' as const,
    id: source.id,
    url: source.url,
    ...(source.title ? { title: source.title } : {}),
  }));
}

async function appendSourcesToAssistantMessage(
  ctx: ActionCtx,
  assistantMessageId: string,
  sources: UrlSource[],
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

  const existingContent = message.message?.content;
  const textContent =
    typeof existingContent === 'string'
      ? existingContent
      : Array.isArray(existingContent)
        ? existingContent
            .flatMap((part) =>
              part &&
              typeof part === 'object' &&
              'type' in part &&
              part.type === 'text' &&
              'text' in part &&
              typeof part.text === 'string'
                ? [part.text]
                : [],
            )
            .join('')
        : '';
  const existingSourceUrls = new Set(
    Array.isArray(existingContent)
      ? existingContent.flatMap((part) =>
          part &&
          typeof part === 'object' &&
          'type' in part &&
          part.type === 'source' &&
          'sourceType' in part &&
          part.sourceType === 'url' &&
          'url' in part &&
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

async function finalizeRunSuccess(
  ctx: ActionCtx,
  args: {
    runId: Id<'chatRuns'>;
    threadId: Id<'chatThreads'>;
    assistantMessageId: string;
    sources: UrlSource[];
  },
) {
  if (args.sources.length > 0) {
    await appendSourcesToAssistantMessage(ctx, args.assistantMessageId, args.sources);
  }

  await ctx.runMutation(internal.agentChat.patchRunInternal, {
    runId: args.runId,
    patch: {
      agentStreamId: null,
      status: 'complete',
      endedAt: Date.now(),
      errorMessage: null,
    },
  });
  await ctx.runMutation(internal.agentChat.patchThreadInternal, {
    threadId: args.threadId,
    patch: {
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
    },
  });
  await ctx.scheduler.runAfter(0, internal.chatBackground.runPostCompletionJobs, {
    runId: args.runId,
  });
}

async function prepareRuntimeStream(
  ctx: ActionCtx,
  request: ChatStreamRequest,
): Promise<PreparedRuntimeStream> {
  const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);

  if (request.mode === 'edit') {
    const nextText = request.text.trim();
    if (!nextText) {
      throw new ConvexError('Message content is required.');
    }

    const [message] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [request.messageId],
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

    await deleteMessagesAfterPrompt(ctx, message.threadId, message);
    const serialized = await serializeMessage(ctx, components.agent, {
      role: 'user',
      content: nextText,
    });
    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: request.messageId,
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

    const model = await resolveModelAndPrompt(ctx, {
      thread,
      organizationId,
      isSiteAdmin,
      requestedModelId: request.model,
      personaId: thread.personaId,
      useWebSearch: request.useWebSearch,
    });

    return {
      thread,
      userId,
      organizationId,
      promptMessageId: request.messageId,
      ownerSessionId: request.ownerSessionId,
      ...model,
    };
  }

  if (request.mode === 'retry') {
    const run = await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: request.runId as Id<'chatRuns'>,
      organizationId,
    });
    if (!run?.promptMessageId) {
      throw new ConvexError('Run not found.');
    }

    const thread = (await ctx.runQuery(internal.agentChat.getThreadForOrganizationInternal, {
      threadId: run.threadId,
      organizationId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const model = await resolveModelAndPrompt(ctx, {
      thread,
      organizationId,
      isSiteAdmin,
      requestedModelId: request.model,
      personaId: thread.personaId,
      useWebSearch: request.useWebSearch ?? run.useWebSearch,
    });

    return {
      thread,
      userId,
      organizationId,
      promptMessageId: run.promptMessageId,
      ownerSessionId: request.ownerSessionId,
      ...model,
    };
  }

  if (request.mode === 'continue') {
    const thread = (await ctx.runQuery(internal.agentChat.getThreadForOrganizationInternal, {
      threadId: request.threadId as Id<'chatThreads'>,
      organizationId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const model = await resolveModelAndPrompt(ctx, {
      thread,
      organizationId,
      isSiteAdmin,
      requestedModelId: request.model,
      personaId: request.personaId as Id<'aiPersonas'> | undefined,
      useWebSearch: request.useWebSearch,
    });

    return {
      thread,
      userId,
      organizationId,
      promptMessageId: request.promptMessageId,
      ownerSessionId: request.ownerSessionId,
      ...model,
    };
  }

  if (!request.text.trim() && request.attachmentIds.length === 0) {
    throw new ConvexError('Message content is required.');
  }

  const attachments = await ctx.runQuery(internal.agentChat.getAttachmentsForSendInternal, {
    attachmentIds: request.attachmentIds as Array<Id<'chatAttachments'>>,
    userId,
    organizationId,
  });
  const { thread } = await resolveThread(ctx, {
    threadId: request.threadId as Id<'chatThreads'> | undefined,
    organizationId,
    userId,
    text: request.text,
    attachments,
    personaId: request.personaId as Id<'aiPersonas'> | undefined,
    model: request.model,
  });
  const model = await resolveModelAndPrompt(ctx, {
    thread,
    organizationId,
    isSiteAdmin,
    requestedModelId: request.model,
    personaId: request.personaId as Id<'aiPersonas'> | undefined,
    useWebSearch: request.useWebSearch,
  });
  const agent = createChatAgent({
    modelId: model.modelId,
    instructions: model.systemPrompt,
    useWebSearch: model.useWebSearch && model.supportsWebSearch,
  });
  const userMessage = await buildUserMessage(ctx, request.text, attachments);
  const savedPrompt = await agent.saveMessages(ctx, {
    threadId: thread.agentThreadId,
    userId,
    messages: [userMessage.message],
    metadata: [
      {
        ...(userMessage.fileIds.length > 0 ? { fileIds: userMessage.fileIds } : {}),
        ...(request.clientMessageId ? { clientMessageId: request.clientMessageId } : {}),
      },
    ],
    failPendingSteps: false,
  });
  const promptMessage = savedPrompt.messages[savedPrompt.messages.length - 1];
  if (!promptMessage) {
    throw new ConvexError('Failed to create prompt message.');
  }

  if (request.attachmentIds.length > 0) {
    await ctx.runMutation(internal.agentChat.assignAttachmentsToMessageInternal, {
      attachmentIds: request.attachmentIds as Array<Id<'chatAttachments'>>,
      threadId: thread._id,
      agentMessageId: promptMessage._id,
      updatedAt: Date.now(),
    });
  }

  return {
    thread,
    userId,
    organizationId,
    promptMessageId: promptMessage._id,
    ownerSessionId: request.ownerSessionId,
    ...model,
  };
}

export const chatStreamHttp = httpAction(async (ctx, request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(request),
    });
  }

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonError(request, 400, parsed.error.message);
    }
    const isSendRequest = parsed.data.mode === undefined || parsed.data.mode === 'send';
    const hasAttachments = 'attachmentIds' in parsed.data && parsed.data.attachmentIds.length > 0;

    const rateLimitReservation = await ctx.runAction(api.agentChatActions.reserveChatRateLimit, {
      textLength:
        parsed.data.mode === 'retry' || parsed.data.mode === 'continue'
          ? undefined
          : parsed.data.text.length,
      hasAttachments: isSendRequest && hasAttachments,
    });
    if (!rateLimitReservation.ok) {
      return jsonError(request, 429, rateLimitReservation.errorMessage);
    }

    const prepared = await prepareRuntimeStream(ctx, parsed.data);
    const collectedSources: UrlSource[] = [];
    let pendingText = '';
    let runId: Id<'chatRuns'> | null = null;
    let generationOrder: number | null = null;
    const encoder = new TextEncoder();

    const agent = createChatAgent({
      modelId: prepared.modelId,
      instructions: prepared.systemPrompt,
      useWebSearch: prepared.useWebSearch && prepared.supportsWebSearch,
      onWebSearchResults: (results) => {
        collectedSources.push(
          ...results.map((source) => ({
            sourceType: 'url' as const,
            id: source.id,
            url: source.url,
            title: source.title,
          })),
        );
      },
    });

    const generation = await startGeneration(
      ctx,
      components.agent,
      {
        promptMessageId: prepared.promptMessageId,
        ...(agent.options.instructions ? { system: agent.options.instructions } : {}),
        ...(agent.options.tools ? { tools: agent.options.tools } : {}),
        ...(agent.options.stopWhen ? { stopWhen: agent.options.stopWhen } : {}),
      },
      {
        userId: prepared.userId,
        threadId: prepared.thread.agentThreadId,
        languageModel: agent.options.languageModel,
        contextOptions: agent.options.contextOptions,
        storageOptions: agent.options.storageOptions,
        usageHandler: agent.options.usageHandler,
        contextHandler: agent.options.contextHandler,
        rawRequestResponseHandler: agent.options.rawRequestResponseHandler,
        providerOptions: agent.options.providerOptions,
        callSettings: agent.options.callSettings,
        maxSteps: agent.options.maxSteps,
        agentName: agent.options.name,
        agentForToolCtx: agent,
      },
    );
    generationOrder = generation.order;

    const steps: StepResult<ToolSet>[] = [];
    const streamer = new DeltaStreamer(
      components.agent,
      ctx,
      {
        throttleMs: 250,
        onAsyncAbort: generation.fail,
        compress: compressUIMessageChunks,
        abortSignal: generation.args.abortSignal,
      },
      {
        threadId: prepared.thread.agentThreadId,
        userId: prepared.userId,
        agentName: agent.options.name,
        model: prepared.modelId,
        provider: 'openrouter',
        providerOptions: agent.options.providerOptions,
        format: 'UIMessageChunk',
        order: generation.order,
        stepOrder: generation.stepOrder,
      },
    );

    const pendingAssistantMessage = await getPendingAssistantMessage(
      ctx,
      prepared.thread.agentThreadId,
      generationOrder,
    );
    if (!pendingAssistantMessage?._id) {
      throw new ConvexError('Failed to create pending assistant message.');
    }

    const streamId = await streamer.getStreamId();
    runId = await ctx.runMutation(internal.agentChat.createRunInternal, {
      threadId: prepared.thread._id,
      agentThreadId: prepared.thread.agentThreadId,
      organizationId: prepared.organizationId,
      ownerSessionId: prepared.ownerSessionId,
      agentStreamId: streamId,
      status: 'streaming',
      startedAt: Date.now(),
      activeAssistantMessageId: pendingAssistantMessage._id,
      promptMessageId: prepared.promptMessageId,
      provider: 'openrouter',
      model: prepared.modelId,
      useWebSearch: prepared.useWebSearch,
    });
    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: prepared.thread._id,
      patch: {
        personaId: prepared.resolvedPersonaId ?? null,
        model: prepared.modelId,
        updatedAt: Date.now(),
        lastMessageAt: Date.now(),
      },
    });

    const result = streamTextAi({
      ...generation.args,
      abortSignal: streamer.abortController.signal,
      onError: async (event) => {
        await generation.fail(errorToString(event.error));
        await streamer.fail(errorToString(event.error));
      },
      onStepFinish: async (step) => {
        steps.push(step);
        const createPendingMessage = shouldCreatePendingMessage(steps);
        await generation.save({ step }, createPendingMessage);
      },
    });
    void streamer.consumeStream(result.toUIMessageStream()).catch(() => undefined);

    const headers = buildCorsHeaders(request, {
      'x-chat-thread-id': prepared.thread._id,
      'x-chat-run-id': runId,
      'x-chat-assistant-message-id': pendingAssistantMessage._id,
      ...(streamId ? { 'x-chat-stream-id': streamId } : {}),
    });

    const textStreamResponse = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            pendingText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          const allSources = dedupeSources([
            ...mapOpenRouterSources(await result.sources),
            ...collectedSources,
          ]);
          await finalizeRunSuccess(ctx, {
            runId,
            threadId: prepared.thread._id,
            assistantMessageId: pendingAssistantMessage._id,
            sources: allSources,
          });
          controller.close();
        } catch (error) {
          const currentRun = await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
            runId,
          });
          if (currentRun?.status === 'aborted') {
            controller.close();
            return;
          }

          await abortRun(ctx, {
            runId,
            reason: error instanceof Error ? error.message : 'Streaming failed.',
            status: 'error',
            partialText: pendingText,
          });
          controller.error(error instanceof Error ? error : new Error('Streaming failed.'));
        }
      },
    });

    return new Response(textStreamResponse, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('[chat.stream.http] failed to start stream', error);
    const payload = error instanceof Error ? error.message : 'Failed to start chat stream.';
    return jsonError(request, 500, payload);
  }
});
