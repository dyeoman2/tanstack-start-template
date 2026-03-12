'use node';

import { streamText, type LanguageModelUsage, type ModelMessage } from 'ai';
import { ConvexError, v } from 'convex/values';
import { createWorkersAI } from 'workers-ai-provider';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action, type ActionCtx } from './_generated/server';
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
const DEFAULT_MODEL_ID = '@cf/meta/llama-3.1-8b-instruct';

let workersProvider: ReturnType<typeof createWorkersAI> | null = null;
let defaultModel: ReturnType<ReturnType<typeof createWorkersAI>> | null = null;

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

function getDefaultModel() {
  if (!workersProvider || !defaultModel) {
    const config = getProviderConfig();
    workersProvider = createWorkersAI({
      accountId: config.accountId,
      apiKey: config.apiToken,
    });
    defaultModel = workersProvider(DEFAULT_MODEL_ID);
  }

  if (!defaultModel) {
    throw new Error('Failed to initialize Cloudflare AI model.');
  }

  return defaultModel;
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
      model: getDefaultModel(),
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
      model: DEFAULT_MODEL_ID,
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
    parts: v.array(messagePartValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: Id<'aiThreads'>; assistantMessageId: Id<'aiMessages'> }> => {
    const { userId, organizationId } = await getAuthenticatedContext(ctx);

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
        ? (await ctx.runQuery(internal.chat.getPersonaByIdInternal, {
            personaId: thread.personaId,
            organizationId,
          }))?.name ?? DEFAULT_THREAD_TITLE
        : DEFAULT_THREAD_TITLE,
    });

    const messages = await ctx.runQuery(api.chat.listMessages, { threadId });
    try {
      const assistantMessageId = await streamAssistantReply(ctx, {
        threadId,
        userId,
        organizationId,
        thread,
        messages,
      });

      return {
        threadId,
        assistantMessageId,
      };
    } catch (error) {
      throw error;
    }
  },
});

export const editUserMessageAndRegenerate = action({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<'aiThreads'>; assistantMessageId: Id<'aiMessages'> }> => {
    const { userId, organizationId } = await getAuthenticatedContext(ctx);
    const threadId = await ctx.runMutation(internal.chat.updateUserMessageTextInternal, {
      messageId: args.messageId,
      text: args.text,
    });

    if (!threadId) {
      throw new Error('Message not found.');
    }

    const messages = await ctx.runQuery(api.chat.listMessages, { threadId });
    const editedMessage = messages.find((message) => message._id === args.messageId);
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
    const assistantMessageId = await streamAssistantReply(ctx, {
      threadId,
      userId,
      organizationId,
      thread,
      messages: regeneratedMessages,
    });

    return {
      threadId,
      assistantMessageId,
    };
  },
});
