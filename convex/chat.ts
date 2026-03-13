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

const attachmentKindValidator = v.union(v.literal('image'), v.literal('document'));
const attachmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('error'),
);

const attachmentPartValidator = v.object({
  type: v.literal('attachment'),
  attachmentId: v.id('aiAttachments'),
  kind: attachmentKindValidator,
  name: v.string(),
  mimeType: v.string(),
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
  attachmentPartValidator,
  sourceUrlPartValidator,
  sourceDocumentPartValidator,
);

const usageValidator = v.object({
  totalTokens: v.optional(v.number()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
});

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
      images?: Array<{
        pageNumber: number;
        name: string;
        width: number;
        height: number;
        dataUrl: string;
      }>;
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

type AiThreadDoc = Doc<'aiThreads'>;
type AiAttachmentDoc = Doc<'aiAttachments'>;

const DEFAULT_THREAD_TITLE = 'New Chat';
const MISSING_ATTACHMENT_SUMMARY = 'Attachment unavailable.';

function getTitleTextFromParts(parts: StoredChatMessagePart[]) {
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

function stripHtmlTags(text: string) {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
}

function deriveThreadTitle(parts: StoredChatMessagePart[], fallback = DEFAULT_THREAD_TITLE) {
  const candidate = stripHtmlTags(getTitleTextFromParts(parts)).trim();

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

function buildUserMessageParts(text: string, attachments: AiAttachmentDoc[]): StoredChatMessagePart[] {
  const parts: StoredChatMessagePart[] = [];
  const trimmedText = text.trim();

  if (trimmedText) {
    parts.push({ type: 'text', text: trimmedText });
  }

  for (const attachment of attachments) {
    parts.push({
      type: 'attachment',
      attachmentId: attachment._id,
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
    });
  }

  return parts;
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

async function getValidatedAttachmentsForSend(
  ctx: MutationCtx,
  args: {
    attachmentIds: Id<'aiAttachments'>[];
    userId: string;
    organizationId: string;
  },
) {
  const attachments = await Promise.all(
    args.attachmentIds.map(async (attachmentId) => {
      const attachment = await ctx.db.get(attachmentId);

      if (
        !attachment ||
        attachment.userId !== args.userId ||
        attachment.organizationId !== args.organizationId
      ) {
        throwConvexError('NOT_FOUND', 'Attachment not found');
      }

      if (attachment.status !== 'ready') {
        throwConvexError('FORBIDDEN', 'Attachment is still processing');
      }

      if (attachment.messageId || attachment.threadId) {
        throwConvexError('FORBIDDEN', 'Attachment has already been sent');
      }

      return attachment;
    }),
  );

  return attachments;
}

async function updateThreadAfterUserMessage(
  ctx: MutationCtx,
  args: {
    thread: AiThreadDoc;
    parts: StoredChatMessagePart[];
  },
) {
  const now = Date.now();
  const patch: Partial<AiThreadDoc> = {
    updatedAt: now,
    lastMessageAt: now,
  };

  if (
    !args.thread.personaId &&
    !args.thread.titleManuallyEdited &&
    args.thread.title === DEFAULT_THREAD_TITLE
  ) {
    patch.title = deriveThreadTitle(args.parts, args.thread.title);
  }

  await ctx.db.patch(args.thread._id, patch);
}

async function loadThreadAttachments(ctx: QueryCtx, threadId: Id<'aiThreads'>) {
  return await ctx.db
    .query('aiAttachments')
    .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', threadId))
    .collect();
}

async function resolvePreviewUrls(ctx: QueryCtx, attachments: AiAttachmentDoc[]) {
  const entries = await Promise.all(
    attachments
      .filter((attachment) => attachment.kind === 'image')
      .map(async (attachment) => [
        attachment._id,
        attachment.rawStorageId ? await ctx.storage.getUrl(attachment.rawStorageId) : null,
      ] as const),
  );

  return new Map(entries);
}

function getAttachmentMap(attachments: AiAttachmentDoc[]) {
  return new Map(attachments.map((attachment) => [attachment._id, attachment] as const));
}

async function hydrateMessageParts(
  _ctx: QueryCtx,
  parts: StoredChatMessagePart[],
  attachments: Map<Id<'aiAttachments'>, AiAttachmentDoc>,
  previewUrls: Map<Id<'aiAttachments'>, string | null>,
) {
  return await Promise.all(
    parts.map(async (part) => {
      if (part.type !== 'attachment') {
        return part;
      }

      const attachment = attachments.get(part.attachmentId);
      if (!attachment) {
        return {
          ...part,
          status: 'error' as const,
          previewUrl: null,
          promptSummary: MISSING_ATTACHMENT_SUMMARY,
          errorMessage: 'Attachment not found.',
        };
      }

      return {
        ...part,
        status: attachment.status,
        previewUrl: previewUrls.get(attachment._id) ?? null,
        promptSummary: attachment.promptSummary,
        errorMessage: attachment.errorMessage,
      };
    }),
  );
}

async function deleteArtifactsForMessages(
  ctx: MutationCtx,
  args: {
    threadId: Id<'aiThreads'>;
    messageIds: Id<'aiMessages'>[];
  },
) {
  if (args.messageIds.length === 0) {
    return;
  }

  const drafts = await ctx.db
    .query('aiMessageDrafts')
    .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
    .collect();
  const attachments = await ctx.db
    .query('aiAttachments')
    .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
    .collect();
  const messageIdSet = new Set(args.messageIds);

  await Promise.all([
    ...drafts
      .filter((draft) => messageIdSet.has(draft.messageId))
      .map((draft) => ctx.db.delete(draft._id)),
    ...attachments
      .filter((attachment) => attachment.messageId && messageIdSet.has(attachment.messageId))
      .map((attachment) => ctx.db.delete(attachment._id)),
  ]);
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

export const getLatestThreadId = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const latestThread = await ctx.db
      .query('aiThreads')
      .withIndex('by_organizationId_and_lastMessageAt', (q) =>
        q.eq('organizationId', user.lastActiveOrganizationId),
      )
      .order('desc')
      .first();

    return latestThread?._id ?? null;
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

    const [messages, attachments] = await Promise.all([
      ctx.db
        .query('aiMessages')
        .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
        .collect(),
      loadThreadAttachments(ctx, args.threadId),
    ]);
    const attachmentMap = getAttachmentMap(attachments);
    const previewUrls = await resolvePreviewUrls(ctx, attachments);

    return await Promise.all(
      messages.map(async (message) => ({
        ...message,
        parts: await hydrateMessageParts(
          ctx,
          message.parts as StoredChatMessagePart[],
          attachmentMap,
          previewUrls,
        ),
      })),
    );
  },
});

export const getActiveAssistantDraft = query({
  args: {
    threadId: v.id('aiThreads'),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const thread = await getThreadForUser(ctx, args.threadId, user.lastActiveOrganizationId);

    if (!thread) {
      return null;
    }

    const drafts = await ctx.db
      .query('aiMessageDrafts')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .collect();

    return drafts.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  },
});

export const generateChatAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.storage.generateUploadUrl();
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

    const [messages, drafts, attachments] = await Promise.all([
      ctx.db
        .query('aiMessages')
        .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
        .collect(),
      ctx.db
        .query('aiMessageDrafts')
        .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
        .collect(),
      ctx.db
        .query('aiAttachments')
        .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', args.threadId))
        .collect(),
    ]);

    await Promise.all([
      ...messages.map((message) => ctx.db.delete(message._id)),
      ...drafts.map((draft) => ctx.db.delete(draft._id)),
      ...attachments.map((attachment) => ctx.db.delete(attachment._id)),
    ]);
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
    await deleteArtifactsForMessages(ctx, {
      threadId: args.threadId,
      messageIds: toDelete.map((message) => message._id),
    });
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

export const getAttachmentsByIdsInternal = internalQuery({
  args: {
    attachmentIds: v.array(v.id('aiAttachments')),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await Promise.all(
      args.attachmentIds.map(async (attachmentId) => {
        const attachment = await ctx.db.get(attachmentId);
        if (!attachment || attachment.organizationId !== args.organizationId) {
          return null;
        }

        return attachment;
      }),
    );
  },
});

export const createAttachmentInternal = internalMutation({
  args: {
    messageId: v.optional(v.id('aiMessages')),
    threadId: v.optional(v.id('aiThreads')),
    userId: v.string(),
    organizationId: v.string(),
    kind: attachmentKindValidator,
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    rawStorageId: v.optional(v.id('_storage')),
    extractedTextStorageId: v.optional(v.id('_storage')),
    promptSummary: v.string(),
    status: attachmentStatusValidator,
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('aiAttachments', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateAttachmentInternal = internalMutation({
  args: {
    attachmentId: v.id('aiAttachments'),
    messageId: v.optional(v.id('aiMessages')),
    threadId: v.optional(v.id('aiThreads')),
    rawStorageId: v.optional(v.id('_storage')),
    extractedTextStorageId: v.optional(v.id('_storage')),
    promptSummary: v.optional(v.string()),
    status: v.optional(attachmentStatusValidator),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment) {
      return null;
    }

    const patch: Partial<AiAttachmentDoc> = {
      updatedAt: Date.now(),
    };

    if ('messageId' in args) {
      patch.messageId = args.messageId;
    }

    if ('threadId' in args) {
      patch.threadId = args.threadId;
    }

    if ('rawStorageId' in args) {
      patch.rawStorageId = args.rawStorageId;
    }

    if ('extractedTextStorageId' in args) {
      patch.extractedTextStorageId = args.extractedTextStorageId;
    }

    if ('promptSummary' in args) {
      patch.promptSummary = args.promptSummary;
    }

    if ('status' in args) {
      patch.status = args.status;
    }

    if ('errorMessage' in args) {
      patch.errorMessage = args.errorMessage;
    }

    await ctx.db.patch(args.attachmentId, patch);
    return args.attachmentId;
  },
});

export const replaceMessagePartsInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    parts: v.array(messagePartValidator),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return null;
    }

    await ctx.db.patch(args.messageId, {
      parts: args.parts,
      updatedAt: Date.now(),
    });

    return args.messageId;
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
    text: v.optional(v.string()),
    attachmentIds: v.optional(v.array(v.id('aiAttachments'))),
    parts: v.optional(v.array(messagePartValidator)),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const trimmedText = args.text?.trim() ?? '';
    const attachmentIds = args.attachmentIds ?? [];
    const providedParts = args.parts;

    if (!providedParts && !trimmedText && attachmentIds.length === 0) {
      throwConvexError('VALIDATION', 'Message content is required');
    }

    const attachments =
      attachmentIds.length > 0
        ? await getValidatedAttachmentsForSend(ctx, {
            attachmentIds,
            userId: args.userId,
            organizationId: args.organizationId,
          })
        : [];

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
        model: undefined,
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

    const parts = providedParts ?? buildUserMessageParts(trimmedText, attachments);
    const now = Date.now();
    const userMessageId = await ctx.db.insert('aiMessages', {
      threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'user',
      parts,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
      clientMessageId: args.clientMessageId,
    });

    await Promise.all(
      attachments.map((attachment) =>
        ctx.db.patch(attachment._id, {
          messageId: userMessageId,
          threadId,
          updatedAt: now,
        }),
      ),
    );

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

    await ctx.db.insert('aiMessageDrafts', {
      messageId: assistantMessageId,
      threadId,
      organizationId: args.organizationId,
      text: '',
      createdAt: now,
      updatedAt: now,
    });

    await updateThreadAfterUserMessage(ctx, { thread, parts });

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
    await deleteArtifactsForMessages(ctx, {
      threadId: message.threadId,
      messageIds: toDelete.map((candidate) => candidate._id),
    });
    await Promise.all(toDelete.map((candidate) => ctx.db.delete(candidate._id)));

    await ctx.db.patch(args.messageId, {
      parts: [{ type: 'text', text: nextText }],
      updatedAt: Date.now(),
    });

    const now = Date.now();
    const assistantMessageId = await ctx.db.insert('aiMessages', {
      threadId: message.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert('aiMessageDrafts', {
      messageId: assistantMessageId,
      threadId: message.threadId,
      organizationId: args.organizationId,
      text: '',
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(message.threadId, {
      updatedAt: now,
      lastMessageAt: now,
    });

    return { threadId: message.threadId, assistantMessageId };
  },
});

export const appendAssistantDraftInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db
      .query('aiMessageDrafts')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();
    if (!draft) {
      return;
    }

    await ctx.db.patch(draft._id, {
      text: `${draft.text}${args.content}`,
      updatedAt: Date.now(),
    });
  },
});

export const markAssistantCompleteInternal = internalMutation({
  args: {
    messageId: v.id('aiMessages'),
    text: v.string(),
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

    const draft = await ctx.db
      .query('aiMessageDrafts')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    const nextParts: StoredChatMessagePart[] = [{ type: 'text', text: args.text }];
    if (args.sourceParts && args.sourceParts.length > 0) {
      nextParts.push(...(args.sourceParts as StoredChatMessagePart[]));
    }

    await ctx.db.patch(args.messageId, {
      parts: nextParts,
      status: 'complete',
      provider: args.provider,
      model: args.model,
      usage: args.usage,
      updatedAt: Date.now(),
    });

    if (draft) {
      await ctx.db.delete(draft._id);
    }
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

    const draft = await ctx.db
      .query('aiMessageDrafts')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    await ctx.db.patch(args.messageId, {
      parts: [{ type: 'text', text: draft?.text ?? '' }],
      status: 'error',
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });

    if (draft) {
      await ctx.db.delete(draft._id);
    }
  },
});

export const setThreadContextSummaryInternal = internalMutation({
  args: {
    threadId: v.id('aiThreads'),
    summary: v.string(),
    throughMessageId: v.optional(v.id('aiMessages')),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      return;
    }

    await ctx.db.patch(args.threadId, {
      contextSummary: args.summary,
      contextSummaryThroughMessageId: args.throughMessageId,
      contextSummaryUpdatedAt: Date.now(),
    });
  },
});

export const updateThreadAfterMessageInternal = internalMutation({
  args: {
    threadId: v.id('aiThreads'),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !args.model) {
      return;
    }

    await ctx.db.patch(args.threadId, {
      model: args.model,
      updatedAt: Date.now(),
    });
  },
});

export const chatValidators = {
  attachmentKindValidator,
  attachmentStatusValidator,
  attachmentPartValidator,
  documentPartValidator,
  imagePartValidator,
  messagePartValidator,
  parsedPdfImageValidator,
  sourceDocumentPartValidator,
  sourceUrlPartValidator,
  textPartValidator,
  usageValidator,
};
