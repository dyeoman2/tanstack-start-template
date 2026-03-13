import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { getCurrentUserOrThrow } from './auth/access';
import { throwConvexError } from './auth/errors';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';

const textPartValidator = v.object({
  type: v.literal('text'),
  text: v.string(),
});

const imagePartValidator = v.object({
  type: v.literal('image'),
  image: v.string(),
  mimeType: v.optional(v.string()),
  name: v.optional(v.string()),
});

const parsedPdfImageValidator = v.object({
  pageNumber: v.number(),
  name: v.string(),
  width: v.number(),
  height: v.number(),
  dataUrl: v.string(),
});

const documentPartValidator = v.object({
  type: v.literal('document'),
  name: v.string(),
  content: v.string(),
  mimeType: v.string(),
  images: v.optional(v.array(parsedPdfImageValidator)),
});

const sourceUrlPartValidator = v.object({
  type: v.literal('source-url'),
  sourceId: v.string(),
  url: v.string(),
  title: v.optional(v.string()),
});

const sourceDocumentPartValidator = v.object({
  type: v.literal('source-document'),
  sourceId: v.string(),
  mediaType: v.string(),
  title: v.string(),
  filename: v.optional(v.string()),
});

const messagePartValidator = v.union(
  textPartValidator,
  imagePartValidator,
  documentPartValidator,
  sourceUrlPartValidator,
  sourceDocumentPartValidator,
);

const usageValidator = v.object({
  totalTokens: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
});

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

type AiThreadDoc = Doc<'aiThreads'>;

const DEFAULT_THREAD_TITLE = 'New Chat';

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

function stripHtmlTags(text: string) {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
}

function deriveThreadTitle(parts: ChatMessagePart[], fallback = DEFAULT_THREAD_TITLE) {
  const candidate = stripHtmlTags(getTextFromParts(parts)).trim();

  if (!candidate) {
    return fallback;
  }

  return candidate.split(/\s+/).slice(0, 4).join(' ') || fallback;
}

function sortThreads<T extends AiThreadDoc>(threads: T[]) {
  return [...threads].sort((a, b) => {
    const pinnedDiff = Number(b.pinned) - Number(a.pinned);
    if (pinnedDiff !== 0) {
      return pinnedDiff;
    }

    return b.updatedAt - a.updatedAt;
  });
}

async function getThreadForUser(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<'aiThreads'>,
  organizationId: string,
) {
  const thread = await ctx.db.get(threadId);

  if (!thread || thread.organizationId !== organizationId) {
    return null;
  }

  return thread;
}

async function getPersonaForUser(
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

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const threads = await ctx.db
      .query('aiThreads')
      .withIndex('by_organizationId_and_updatedAt', (q) =>
        q.eq('organizationId', user.lastActiveOrganizationId),
      )
      .collect();

    return sortThreads(threads);
  },
});

export const getThread = query({
  args: {
    threadId: v.id('aiThreads'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    return await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);
  },
});

export const getThreadTitle = query({
  args: {
    threadId: v.id('aiThreads'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    return thread?.title ?? null;
  },
});

export const listMessages = query({
  args: {
    threadId: v.id('aiThreads'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    if (!thread) {
      return [];
    }

    return await ctx.db
      .query('aiMessages')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
      .collect();
  },
});

export const listPersonas = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);

    return await ctx.db
      .query('aiPersonas')
      .withIndex('by_organizationId_and_createdAt', (q) =>
        q.eq('organizationId', user.lastActiveOrganizationId),
      )
      .collect();
  },
});

export const createThread = mutation({
  args: {
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    let title = DEFAULT_THREAD_TITLE;

    if (args.personaId) {
      const persona = await getPersonaForUser(ctx, args.personaId, user.lastActiveOrganizationId);
      if (!persona) {
        throwConvexError('NOT_FOUND', 'Persona not found');
      }
      title = persona.name;
    }

    const now = Date.now();
    return await ctx.db.insert('aiThreads', {
      userId: user.authUserId,
      organizationId: user.lastActiveOrganizationId,
      title,
      pinned: false,
      personaId: args.personaId,
      model: args.model,
      titleManuallyEdited: false,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    });
  },
});

export const renameThread = mutation({
  args: {
    threadId: v.id('aiThreads'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    if (!thread) {
      throwConvexError('NOT_FOUND', 'Thread not found');
    }

    const title = args.title.trim();
    if (!title) {
      throwConvexError('VALIDATION', 'Thread title is required');
    }

    await ctx.db.patch(args.threadId, {
      title,
      titleManuallyEdited: true,
      updatedAt: Date.now(),
    });
  },
});

export const setThreadPinned = mutation({
  args: {
    threadId: v.id('aiThreads'),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    if (!thread) {
      throwConvexError('NOT_FOUND', 'Thread not found');
    }

    await ctx.db.patch(args.threadId, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });
  },
});

export const setThreadPersona = mutation({
  args: {
    threadId: v.id('aiThreads'),
    personaId: v.optional(v.id('aiPersonas')),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    if (!thread) {
      throwConvexError('NOT_FOUND', 'Thread not found');
    }

    if (args.personaId) {
      const persona = await getPersonaForUser(ctx, args.personaId, user.lastActiveOrganizationId);
      if (!persona) {
        throwConvexError('NOT_FOUND', 'Persona not found');
      }
    }

    await ctx.db.patch(args.threadId, {
      personaId: args.personaId,
      title:
        thread.titleManuallyEdited || thread.lastMessageAt > thread.createdAt
          ? thread.title
          : args.personaId
            ? (await ctx.db.get(args.personaId))?.name ?? DEFAULT_THREAD_TITLE
            : DEFAULT_THREAD_TITLE,
      updatedAt: Date.now(),
    });
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.id('aiThreads'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    if (!thread) {
      throwConvexError('NOT_FOUND', 'Thread not found');
    }

    const messages = await ctx.db
      .query('aiMessages')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
      .collect();

    await Promise.all(messages.map((message) => ctx.db.delete(message._id)));
    await ctx.db.delete(args.threadId);
  },
});

export const updateUserMessageText = mutation({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(args.messageId);

    if (!message || message.organizationId !== user.lastActiveOrganizationId) {
      throwConvexError('NOT_FOUND', 'Message not found');
    }

    if (message.role !== 'user') {
      throwConvexError('FORBIDDEN', 'Only user messages can be edited');
    }

    const nextText = args.text.trim();
    if (!nextText) {
      throwConvexError('VALIDATION', 'Message text is required');
    }

    const hasNonTextParts = message.parts.some((part) => part.type !== 'text');
    if (hasNonTextParts) {
      throwConvexError('FORBIDDEN', 'Only text-only user messages can be edited');
    }

    await ctx.db.patch(args.messageId, {
      parts: [{ type: 'text', text: nextText }],
      updatedAt: Date.now(),
    });
  },
});

export const updateUserMessageTextInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.role !== 'user') {
      return null;
    }

    const nextText = args.text.trim();
    if (!nextText) {
      throwConvexError('VALIDATION', 'Message text is required');
    }

    await ctx.db.patch(args.messageId, {
      parts: [{ type: 'text', text: nextText }],
      updatedAt: Date.now(),
    });

    return message.threadId;
  },
});

export const deleteMessagesAfterInternal = internalMutation({
  args: {
    threadId: v.id('aiThreads'),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('aiMessages')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
      .collect();

    const toDelete = messages.filter((message) => message.createdAt > args.createdAt);
    await Promise.all(toDelete.map((message) => ctx.db.delete(message._id)));
  },
});

export const createPersona = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const name = args.name.trim();
    const prompt = args.prompt.trim();

    if (!name || !prompt) {
      throwConvexError('VALIDATION', 'Persona name and prompt are required');
    }

    const now = Date.now();
    return await ctx.db.insert('aiPersonas', {
      userId: user.authUserId,
      organizationId: user.lastActiveOrganizationId,
      name,
      prompt,
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
    const user = await getCurrentUserOrThrow(ctx);
    const persona = await getPersonaForUser(ctx, args.personaId, user.lastActiveOrganizationId);

    if (!persona) {
      throwConvexError('NOT_FOUND', 'Persona not found');
    }

    const name = args.name.trim();
    const prompt = args.prompt.trim();
    if (!name || !prompt) {
      throwConvexError('VALIDATION', 'Persona name and prompt are required');
    }

    await ctx.db.patch(args.personaId, {
      name,
      prompt,
      updatedAt: Date.now(),
    });
  },
});

export const deletePersona = mutation({
  args: {
    personaId: v.id('aiPersonas'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const persona = await getPersonaForUser(ctx, args.personaId, user.lastActiveOrganizationId);

    if (!persona) {
      throwConvexError('NOT_FOUND', 'Persona not found');
    }

    const threads = await ctx.db
      .query('aiThreads')
      .withIndex('by_organizationId_and_updatedAt', (q) =>
        q.eq('organizationId', user.lastActiveOrganizationId),
      )
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

export const getPersonaByIdInternal = internalQuery({
  args: {
    personaId: v.id('aiPersonas'),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getPersonaForUser(ctx, args.personaId, args.organizationId);
  },
});

export const getCurrentChatUserContextInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);

    return {
      userId: user.authUserId,
      organizationId: user.lastActiveOrganizationId,
      isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(user.authUser.role)),
    };
  },
});

export const getThreadGenerationContextInternal = internalQuery({
  args: {
    threadId: v.id('aiThreads'),
    organizationId: v.string(),
    excludeMessageId: v.optional(v.id('aiMessages')),
  },
  handler: async (ctx, args) => {
    const thread = await getThreadForUser(ctx, args.threadId, args.organizationId);
    if (!thread) {
      return null;
    }

    const messages = await ctx.db
      .query('aiMessages')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
      .collect();

    return {
      thread,
      messages: args.excludeMessageId
        ? messages.filter((message) => message._id !== args.excludeMessageId)
        : messages,
    };
  },
});

export const prepareMessageSendInternal = internalMutation({
  args: {
    threadId: v.optional(v.id('aiThreads')),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    userId: v.string(),
    organizationId: v.string(),
    parts: v.array(messagePartValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let threadId = args.threadId;
    let thread = threadId ? await getThreadForUser(ctx, threadId, args.organizationId) : null;

    if (threadId && !thread) {
      throwConvexError('NOT_FOUND', 'Thread not found');
    }

    if (!thread) {
      let title = DEFAULT_THREAD_TITLE;

      if (args.personaId) {
        const persona = await getPersonaForUser(ctx, args.personaId, args.organizationId);
        if (!persona) {
          throwConvexError('NOT_FOUND', 'Persona not found');
        }
        title = persona.name;
      }

      const now = Date.now();
      threadId = await ctx.db.insert('aiThreads', {
        userId: args.userId,
        organizationId: args.organizationId,
        title,
        pinned: false,
        personaId: args.personaId,
        model: args.model,
        titleManuallyEdited: false,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
      });

      thread = await ctx.db.get(threadId);
    }

    if (!threadId || !thread) {
      throw new Error('Failed to initialize chat thread.');
    }

    const now = Date.now();
    await ctx.db.insert('aiMessages', {
      threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'user',
      parts: args.parts,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
      clientMessageId: args.clientMessageId,
    });

    const assistantMessageId = await ctx.db.insert('aiMessages', {
      threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    return { threadId, assistantMessageId };
  },
});

export const prepareRegenerateMessageInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
    userId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.organizationId !== args.organizationId || message.role !== 'user') {
      throwConvexError('NOT_FOUND', 'Message not found');
    }

    const nextText = args.text.trim();
    if (!nextText) {
      throwConvexError('VALIDATION', 'Message text is required');
    }

    const hasNonTextParts = message.parts.some((part) => part.type !== 'text');
    if (hasNonTextParts) {
      throwConvexError('FORBIDDEN', 'Only text-only user messages can be edited');
    }

    const thread = await getThreadForUser(ctx, message.threadId, args.organizationId);
    if (!thread) {
      throwConvexError('NOT_FOUND', 'Thread not found');
    }

    const messages = await ctx.db
      .query('aiMessages')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', message.threadId))
      .collect();

    const toDelete = messages.filter((candidate) => candidate.createdAt > message.createdAt);
    await Promise.all(toDelete.map((candidate) => ctx.db.delete(candidate._id)));

    await ctx.db.patch(args.messageId, {
      parts: [{ type: 'text', text: nextText }],
      updatedAt: Date.now(),
    });

    const assistantMessageId = await ctx.db.insert('aiMessages', {
      threadId: message.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { threadId: message.threadId, assistantMessageId };
  },
});

export const createUserMessageInternal = internalMutation({
  args: {
    threadId: v.id('aiThreads'),
    userId: v.string(),
    organizationId: v.string(),
    parts: v.array(messagePartValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('aiMessages', {
      threadId: args.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'user',
      parts: args.parts,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
      clientMessageId: args.clientMessageId,
    });
  },
});

export const createPendingAssistantMessageInternal = internalMutation({
  args: {
    threadId: v.id('aiThreads'),
    userId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('aiMessages', {
      threadId: args.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const appendAssistantChunkInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.role !== 'assistant') {
      return;
    }

    const nextParts = [...message.parts] as ChatMessagePart[];
    const firstTextPart = nextParts.find((part) => part.type === 'text');

    if (firstTextPart?.type === 'text') {
      firstTextPart.text += args.content;
    } else {
      nextParts.unshift({ type: 'text', text: args.content });
    }

    await ctx.db.patch(args.messageId, {
      parts: nextParts,
      updatedAt: Date.now(),
    });
  },
});

export const markAssistantCompleteInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    usage: v.optional(usageValidator),
    sourceParts: v.optional(v.array(sourceUrlPartValidator)),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.role !== 'assistant') {
      return;
    }

    const nextParts =
      args.sourceParts && args.sourceParts.length > 0
        ? [...message.parts, ...args.sourceParts]
        : message.parts;

    await ctx.db.patch(args.messageId, {
      parts: nextParts,
      status: 'complete',
      provider: args.provider,
      model: args.model,
      usage: args.usage,
      updatedAt: Date.now(),
    });
  },
});

export const markAssistantErrorInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.role !== 'assistant') {
      return;
    }

    await ctx.db.patch(args.messageId, {
      status: 'error',
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
  },
});

export const updateThreadAfterMessageInternal = internalMutation({
  args: {
    threadId: v.id('aiThreads'),
    parts: v.array(messagePartValidator),
    titleFallback: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return;
    }

    const now = Date.now();
    const patch: Partial<AiThreadDoc> = {
      updatedAt: now,
      lastMessageAt: now,
      ...(args.model ? { model: args.model } : {}),
    };

    if (!thread.personaId && !thread.titleManuallyEdited && thread.title === DEFAULT_THREAD_TITLE) {
      patch.title = deriveThreadTitle(args.parts as ChatMessagePart[], args.titleFallback);
    }

    await ctx.db.patch(args.threadId, patch);
  },
});
