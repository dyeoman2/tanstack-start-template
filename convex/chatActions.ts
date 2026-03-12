'use node';

import { type LanguageModelUsage, type ModelMessage, streamText } from 'ai';
import { ConvexError, v } from 'convex/values';
import { createWorkersAI } from 'workers-ai-provider';
import {
  getAuthorizedChatModel,
  type ChatModelId,
  DEFAULT_CHAT_MODEL_ID,
  type ChatModelCatalogEntry,
} from '../src/lib/shared/chat-models';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { type ActionCtx, action } from './_generated/server';
import { authComponent } from './auth';

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
const DEFAULT_THREAD_TITLE = 'New Chat';

let workersProvider: ReturnType<typeof createWorkersAI> | null = null;
const modelCache = new Map<string, ReturnType<ReturnType<typeof createWorkersAI>>>();

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

function getProviderConfig() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!apiToken || !accountId) {
    throw new Error(
      'Missing required Cloudflare AI environment variables: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.',
    );
  }

  return { apiToken, accountId };
}

function getWorkersProvider() {
  if (!workersProvider) {
    const config = getProviderConfig();
    workersProvider = createWorkersAI({
      accountId: config.accountId,
      apiKey: config.apiToken,
    });
  }

  return workersProvider;
}

function getChatModel(modelId: ChatModelId) {
  const cachedModel = modelCache.get(modelId);
  if (cachedModel) {
    return cachedModel;
  }

  const nextModel = getWorkersProvider()(modelId);
  modelCache.set(modelId, nextModel);
  return nextModel;
}

function resolveChatModelId(
  modelId: string | undefined,
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

async function getAuthenticatedContext(ctx: ActionCtx) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Authentication required.');
  }

  const profile = await ctx.runQuery(api.users.getCurrentUserProfile, {});
  if (!profile?.currentOrganization) {
    throw new Error('Active organization not initialized for this user.');
  }

  return {
    userId: profile.id,
    organizationId: profile.currentOrganization.id,
    isSiteAdmin: profile.isSiteAdmin === true,
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

async function streamAssistantReply(
  ctx: ActionCtx,
  args: {
    threadId: Id<'aiThreads'>;
    userId: string;
    organizationId: string;
    thread: AiThreadDoc;
    messages: AiMessageDoc[];
    modelId: ChatModelId;
  },
) {
  const prompt = await getPersonaPrompt(ctx, args.thread, args.organizationId);
  const assistantMessageId = await ctx.runMutation(
    internal.chat.createPendingAssistantMessageInternal,
    {
      threadId: args.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
    },
  );

  try {
    const result = await streamText({
      model: getChatModel(args.modelId),
      messages: [
        { role: 'system', content: prompt },
        ...args.messages.map((message: AiMessageDoc) => toModelMessage(message)),
      ],
    });

    for await (const chunk of result.textStream) {
      await ctx.runMutation(internal.chat.appendAssistantChunkInternal, {
        messageId: assistantMessageId,
        content: chunk,
      });
    }

    const usage = await result.usage;

    await ctx.runMutation(internal.chat.markAssistantCompleteInternal, {
      messageId: assistantMessageId,
      provider: 'cloudflare-workers-ai',
      model: args.modelId,
      usage: buildUsageMetadata(usage),
    });

    return assistantMessageId;
  } catch (error) {
    await ctx.runMutation(internal.chat.markAssistantErrorInternal, {
      messageId: assistantMessageId,
      errorMessage: error instanceof Error ? error.message : 'Streaming failed.',
    });

    throw error;
  }
}

export const sendChatMessage = action({
  args: {
    threadId: v.optional(v.id('aiThreads')),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
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

    let threadId = args.threadId;
    let thread = threadId ? await ctx.runQuery(api.chat.getThread, { threadId }) : null;

    if (threadId && !thread) {
      throw new Error('Thread not found.');
    }

    if (!thread) {
      threadId = await ctx.runMutation(api.chat.createThread, {
        personaId: args.personaId,
      });
      thread = await ctx.runQuery(api.chat.getThread, { threadId });
    }

    if (!threadId || !thread) {
      throw new Error('Failed to initialize chat thread.');
    }

    await ctx.runMutation(internal.chat.createUserMessageInternal, {
      threadId,
      userId,
      organizationId,
      parts: args.parts,
      clientMessageId: args.clientMessageId,
    });

    await ctx.runMutation(internal.chat.updateThreadAfterMessageInternal, {
      threadId,
      parts: args.parts,
      titleFallback: thread.personaId
        ? ((
            await ctx.runQuery(internal.chat.getPersonaByIdInternal, {
              personaId: thread.personaId,
              organizationId,
            })
          )?.name ?? DEFAULT_THREAD_TITLE)
        : DEFAULT_THREAD_TITLE,
    });

    const messages = await ctx.runQuery(api.chat.listMessages, { threadId });
    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const modelId = resolveChatModelId(args.model, messages, availableModels, isSiteAdmin);
    const assistantMessageId = await streamAssistantReply(ctx, {
      threadId,
      userId,
      organizationId,
      thread,
      messages,
      modelId,
    });

    return {
      threadId,
      assistantMessageId,
    };
  },
});

export const editUserMessageAndRegenerate = action({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: Id<'aiThreads'>; assistantMessageId: Id<'aiMessages'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getAuthenticatedContext(ctx);
    const threadId = await ctx.runMutation(internal.chat.updateUserMessageTextInternal, {
      messageId: args.messageId,
      text: args.text,
    });

    if (!threadId) {
      throw new Error('Message not found.');
    }

    const messages = await ctx.runQuery(api.chat.listMessages, { threadId });
    const editedMessage = messages.find((message: AiMessageDoc) => message._id === args.messageId);
    if (!editedMessage) {
      throw new Error('Message not found.');
    }

    await ctx.runMutation(internal.chat.deleteMessagesAfterInternal, {
      threadId,
      createdAt: editedMessage.createdAt,
    });

    const thread = await ctx.runQuery(api.chat.getThread, { threadId });
    if (!thread) {
      throw new Error('Thread not found.');
    }

    await ctx.runMutation(internal.chat.updateThreadAfterMessageInternal, {
      threadId,
      parts: [{ type: 'text', text: args.text }],
      titleFallback: thread.title,
    });

    const regeneratedMessages = await ctx.runQuery(api.chat.listMessages, { threadId });
    const availableModels = await ctx.runQuery(internal.chatModels.listActiveChatModelsInternal, {});
    const modelId = resolveChatModelId(args.model, regeneratedMessages, availableModels, isSiteAdmin);
    const assistantMessageId = await streamAssistantReply(ctx, {
      threadId,
      userId,
      organizationId,
      thread,
      messages: regeneratedMessages,
      modelId,
    });

    return {
      threadId,
      assistantMessageId,
    };
  },
});
