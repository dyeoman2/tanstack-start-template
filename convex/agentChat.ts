import {
  listUIMessages,
  serializeMessage,
  syncStreams,
  updateThreadMetadata,
  vStreamArgs,
} from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from './_generated/server';
import {
  type AgentMessageDoc,
  abortRunWithReason,
  buildUserMessage,
  deleteMessagesAfterPrompt,
  isTextOnlyUserMessage,
  isValidContinuationPromptMessage,
  resolveThread,
} from './agentChatActions';
import { getVerifiedCurrentUserOrThrow } from './auth/access';
import {
  assertChatModelSupportsWebSearch,
  type ChatAttachmentDoc,
  type ChatRunDoc,
  type ChatRunFailureKind,
  type ChatThreadDoc,
  deriveThreadTitle,
  ensureThreadId,
  resolveChatModelId,
} from './lib/agentChat';
import { baseChatAgent } from './lib/chatAgentRuntime';
import {
  type AdvisoryChatRateLimit,
  buildChatUsageAggregatePatch,
  chargeActualChatTokens,
  enforceChatAttachmentUploadsRateLimitOrThrow,
  enforceChatPreflightOrThrow,
  getAdvisoryChatRateLimit,
} from './lib/chatRateLimits';
import { getOrganizationPolicies } from './organizationManagement';
import {
  activeRunWithAccessValidator,
  advisoryChatRateLimitValidator,
  aiPersonasDocValidator,
  chatAttachmentsDocValidator,
  chatLatestRunStateValidator,
  chatMessagePageValidator,
  chatRunsDocValidator,
  chatThreadsDocValidator,
  currentUserContextValidator,
  personaWithAccessValidator,
  threadWithAccessValidator,
} from './lib/returnValidators';
import { uploadTargetResultValidator } from './storageTypes';
import { createUploadTargetWithMode } from './storagePlatform';

type PersonaDoc = Doc<'aiPersonas'>;
type ChatViewerContext = Awaited<ReturnType<typeof getCurrentChatContext>>;
type ThreadWithAccess = ChatThreadDoc & {
  canManage: boolean;
};
type PersonaWithAccess = PersonaDoc & {
  canManage: boolean;
};

function getCurrentUserDisplayName(
  user: Awaited<ReturnType<typeof getVerifiedCurrentUserOrThrow>>,
) {
  const normalizedName = user.authUser.name?.trim();
  if (normalizedName) {
    return normalizedName;
  }

  return user.authUser.email ?? 'Unknown user';
}

const CHAT_ATTACHMENT_UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const THREAD_LIST_LIMIT = 200;
const RETRYABLE_RUN_LOOKBACK_LIMIT = 200;
const PERSONA_THREAD_CLEANUP_BATCH_SIZE = 128;

function createChatAttachmentUploadToken() {
  return crypto.randomUUID();
}

async function getCurrentChatContext(ctx: QueryCtx | MutationCtx) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const identity = await ctx.auth.getUserIdentity();
  const organizationId = user.activeOrganizationId;

  if (!organizationId) {
    throw new ConvexError('No active organization is selected.');
  }

  if (!identity?.sessionId) {
    throw new ConvexError('Authentication session is unavailable.');
  }

  return {
    userId: user._id,
    organizationId,
    sessionId: String(identity.sessionId),
    isSiteAdmin: user.isSiteAdmin,
    currentUserName: getCurrentUserDisplayName(user),
  };
}

async function getCurrentChatContextOrNull(ctx: QueryCtx | MutationCtx) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const identity = await ctx.auth.getUserIdentity();
  const organizationId = user.activeOrganizationId;

  if (!organizationId || !identity?.sessionId) {
    return null;
  }

  return {
    userId: user._id,
    organizationId,
    sessionId: String(identity.sessionId),
    isSiteAdmin: user.isSiteAdmin,
    currentUserName: getCurrentUserDisplayName(user),
  };
}

function canViewThread(
  thread: ChatThreadDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  if (thread.deletedAt) {
    return false;
  }

  if (thread.organizationId !== viewer.organizationId) {
    return false;
  }

  if (viewer.isSiteAdmin) {
    return true;
  }

  return thread.ownerUserId === viewer.userId;
}

function canManageThread(
  thread: ChatThreadDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  if (thread.organizationId !== viewer.organizationId) {
    return false;
  }

  return viewer.isSiteAdmin || thread.ownerUserId === viewer.userId;
}

function canManagePersona(
  persona: PersonaDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  if (persona.organizationId !== viewer.organizationId) {
    return false;
  }

  return viewer.isSiteAdmin || persona.userId === viewer.userId;
}

function toPersonaWithAccess(
  persona: PersonaDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
): PersonaWithAccess {
  return {
    ...persona,
    canManage: canManagePersona(persona, viewer),
  };
}

function getMessageMetadataRecord(message: { metadata?: unknown } | null) {
  const metadata =
    message?.metadata && typeof message.metadata === 'object' ? message.metadata : null;

  return metadata as Record<string, unknown> | null;
}

function getMessageAuthorUserId(
  message: AgentMessageDoc | { metadata?: unknown } | null,
  thread: ChatThreadDoc,
) {
  const metadata = getMessageMetadataRecord(message);
  return typeof metadata?.authorUserId === 'string' ? metadata.authorUserId : thread.ownerUserId;
}

function canEditUserMessage(
  message: AgentMessageDoc | { metadata?: unknown } | null,
  thread: ChatThreadDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  if (!message || !canViewThread(thread, viewer)) {
    return false;
  }

  return viewer.isSiteAdmin || getMessageAuthorUserId(message, thread) === viewer.userId;
}

function canStopRun(
  run: ChatRunDoc,
  thread: ChatThreadDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  if (!canViewThread(thread, viewer)) {
    return false;
  }

  return viewer.isSiteAdmin || run.initiatedByUserId === viewer.userId;
}

function toThreadWithAccess(
  thread: ChatThreadDoc,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
): ThreadWithAccess {
  return {
    ...thread,
    canManage: canManageThread(thread, viewer),
  };
}

async function getThreadForViewer(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<'chatThreads'>,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread || !canViewThread(thread, viewer)) {
    return null;
  }

  return thread;
}

async function listAccessibleThreads(
  ctx: QueryCtx | MutationCtx,
  viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>,
) {
  const threads = viewer.isSiteAdmin
    ? await ctx.db
        .query('chatThreads')
        .withIndex('by_organizationId_and_lastMessageAt', (q) =>
          q.eq('organizationId', viewer.organizationId),
        )
        .order('desc')
        .take(THREAD_LIST_LIMIT)
    : await ctx.db
        .query('chatThreads')
        .withIndex('by_ownerUserId_and_lastMessageAt', (q) => q.eq('ownerUserId', viewer.userId))
        .order('desc')
        .take(THREAD_LIST_LIMIT);

  return threads.filter((thread) => !thread.deletedAt);
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

async function getChatRunsForThread(ctx: QueryCtx | MutationCtx, threadId: Id<'chatThreads'>) {
  return await ctx.db
    .query('chatRuns')
    .withIndex('by_threadId_and_startedAt', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(20);
}

function getMessageTextLength(message: AgentMessageDoc | null) {
  if (!message) {
    return 0;
  }

  const content = message.message?.content;
  if (typeof content === 'string') {
    return content.trim().length;
  }

  if (!Array.isArray(content)) {
    return 0;
  }

  return content.reduce((total, part) => {
    if (
      !part ||
      typeof part !== 'object' ||
      part.type !== 'text' ||
      typeof part.text !== 'string'
    ) {
      return total;
    }

    return total + part.text.trim().length;
  }, 0);
}

const THREAD_DELETE_BATCH_SIZE = 128;

async function deleteThreadDocumentsInBatches(ctx: MutationCtx, threadId: Id<'chatThreads'>) {
  while (true) {
    const runs = await ctx.db
      .query('chatRuns')
      .withIndex('by_threadId_and_startedAt', (q) => q.eq('threadId', threadId))
      .order('asc')
      .take(THREAD_DELETE_BATCH_SIZE);

    if (runs.length === 0) {
      break;
    }

    await Promise.all(runs.map((run) => ctx.db.delete(run._id)));
  }

  while (true) {
    const attachments = await ctx.db
      .query('chatAttachments')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', threadId))
      .order('asc')
      .take(THREAD_DELETE_BATCH_SIZE);

    if (attachments.length === 0) {
      break;
    }

    await Promise.all(attachments.map((attachment) => ctx.db.delete(attachment._id)));
  }

  while (true) {
    const usageEvents = await ctx.db
      .query('chatUsageEvents')
      .withIndex('by_threadId_and_createdAt', (q) => q.eq('threadId', threadId))
      .order('asc')
      .take(THREAD_DELETE_BATCH_SIZE);

    if (usageEvents.length === 0) {
      break;
    }

    await Promise.all(usageEvents.map((event) => ctx.db.delete(event._id)));
  }
}

async function deleteThreadForCleanup(ctx: MutationCtx, threadId: Id<'chatThreads'>) {
  const thread = await ctx.db.get(threadId);
  if (!thread) {
    return { deleted: false as const };
  }

  await deleteThreadDocumentsInBatches(ctx, threadId);
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
    threadId: thread.agentThreadId,
  });
  await ctx.db.delete(threadId);

  return { deleted: true as const, organizationId: thread.organizationId };
}

export const getCurrentChatContextInternal = internalQuery({
  args: {},
  returns: currentUserContextValidator,
  handler: async (ctx) => {
    return await getCurrentChatContext(ctx);
  },
});

export const getThreadForOrganizationInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
    organizationId: v.string(),
  },
  returns: v.union(chatThreadsDocValidator, v.null()),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.organizationId !== args.organizationId || thread.deletedAt) {
      return null;
    }

    return thread;
  },
});

export const deleteThreadForCleanupInternal = internalMutation({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.union(
    v.object({
      deleted: v.literal(false),
    }),
    v.object({
      deleted: v.literal(true),
      organizationId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    return await deleteThreadForCleanup(ctx, args.threadId);
  },
});

export const getThreadByAgentThreadIdInternal = internalQuery({
  args: {
    agentThreadId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(chatThreadsDocValidator, v.null()),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query('chatThreads')
      .withIndex('by_agentThreadId', (q) => q.eq('agentThreadId', args.agentThreadId))
      .first();

    if (!thread || thread.organizationId !== args.organizationId || thread.deletedAt) {
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
  returns: v.union(aiPersonasDocValidator, v.null()),
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
  returns: v.array(chatAttachmentsDocValidator),
  handler: async (ctx, args) => {
    const attachments = await Promise.all(
      args.attachmentIds.map(async (attachmentId) => {
        const attachment = await ctx.db.get(attachmentId);
        if (
          !attachment ||
          attachment.userId !== args.userId ||
          attachment.organizationId !== args.organizationId ||
          attachment.deletedAt
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
  returns: v.union(chatAttachmentsDocValidator, v.null()),
  handler: async (ctx, args) => {
    const attachment = await ctx.db.get(args.attachmentId);
    if (!attachment || attachment.organizationId !== args.organizationId || attachment.deletedAt) {
      return null;
    }

    return attachment;
  },
});

export const createThreadShellInternal = internalMutation({
  args: {
    ownerUserId: v.string(),
    organizationId: v.string(),
    agentThreadId: v.string(),
    title: v.string(),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    titleManuallyEdited: v.boolean(),
    createdAt: v.number(),
  },
  returns: v.id('chatThreads'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatThreads', {
      ...args,
      visibility: 'private',
      pinned: false,
      deletedAt: undefined,
      deletedByUserId: undefined,
      purgeEligibleAt: undefined,
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
      summaryThroughOrder: v.optional(v.union(v.number(), v.null())),
      deletedAt: v.optional(v.union(v.number(), v.null())),
      deletedByUserId: v.optional(v.union(v.string(), v.null())),
      purgeEligibleAt: v.optional(v.union(v.number(), v.null())),
      updatedAt: v.optional(v.number()),
      lastMessageAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
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
    if (args.patch.summaryThroughOrder !== undefined) {
      patch.summaryThroughOrder = args.patch.summaryThroughOrder ?? undefined;
    }
    if (args.patch.deletedAt !== undefined) {
      patch.deletedAt = args.patch.deletedAt ?? undefined;
    }
    if (args.patch.deletedByUserId !== undefined) {
      patch.deletedByUserId = args.patch.deletedByUserId ?? undefined;
    }
    if (args.patch.purgeEligibleAt !== undefined) {
      patch.purgeEligibleAt = args.patch.purgeEligibleAt ?? undefined;
    }
    if (args.patch.updatedAt !== undefined) patch.updatedAt = args.patch.updatedAt;
    if (args.patch.lastMessageAt !== undefined) patch.lastMessageAt = args.patch.lastMessageAt;
    await ctx.db.patch(args.threadId, patch);
    return null;
  },
});

export const createAttachmentInternal = internalMutation({
  args: {
    threadId: v.optional(v.id('chatThreads')),
    agentMessageId: v.optional(v.string()),
    userId: v.string(),
    organizationId: v.string(),
    storageId: v.string(),
    kind: v.union(v.literal('image'), v.literal('document')),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    rawStorageId: v.optional(v.id('_storage')),
    extractedTextStorageId: v.optional(v.id('_storage')),
    agentFileId: v.optional(v.string()),
    promptSummary: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('pending_scan'),
      v.literal('quarantined'),
      v.literal('ready'),
      v.literal('error'),
      v.literal('rejected'),
    ),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id('chatAttachments'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('chatAttachments', {
      ...args,
      deletedAt: undefined,
      deletedByUserId: undefined,
      purgeEligibleAt: undefined,
      updatedAt: args.createdAt,
    });
  },
});

export const issueAttachmentUploadTokenInternal = internalMutation({
  args: {
    token: v.string(),
    storageId: v.string(),
    userId: v.string(),
    organizationId: v.string(),
    sessionId: v.string(),
    expectedFileName: v.string(),
    expectedMimeType: v.string(),
    expectedSizeBytes: v.number(),
    expectedSha256: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('chatAttachmentUploadTokens', args);
    return null;
  },
});

export const consumeAttachmentUploadTokenInternal = internalMutation({
  args: {
    token: v.string(),
    userId: v.string(),
    organizationId: v.string(),
    sessionId: v.string(),
  },
  returns: v.union(
    v.object({
      expectedFileName: v.string(),
      expectedMimeType: v.string(),
      expectedSizeBytes: v.number(),
      expectedSha256: v.string(),
      storageId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const tokenRecord = await ctx.db
      .query('chatAttachmentUploadTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();

    if (!tokenRecord) {
      return null;
    }

    const isValid =
      tokenRecord.userId === args.userId &&
      tokenRecord.organizationId === args.organizationId &&
      tokenRecord.sessionId === args.sessionId &&
      tokenRecord.expiresAt > Date.now();

    await ctx.db.delete(tokenRecord._id);
    if (!isValid) {
      return null;
    }

    return {
      expectedFileName: tokenRecord.expectedFileName,
      expectedMimeType: tokenRecord.expectedMimeType,
      expectedSizeBytes: tokenRecord.expectedSizeBytes,
      expectedSha256: tokenRecord.expectedSha256,
      storageId: tokenRecord.storageId,
    };
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
      status: v.optional(
        v.union(
          v.literal('pending'),
          v.literal('pending_scan'),
          v.literal('quarantined'),
          v.literal('ready'),
          v.literal('error'),
          v.literal('rejected'),
        ),
      ),
      errorMessage: v.optional(v.union(v.string(), v.null())),
      deletedAt: v.optional(v.union(v.number(), v.null())),
      deletedByUserId: v.optional(v.union(v.string(), v.null())),
      purgeEligibleAt: v.optional(v.union(v.number(), v.null())),
      updatedAt: v.number(),
    }),
  },
  returns: v.null(),
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
    if (args.patch.deletedAt !== undefined) patch.deletedAt = args.patch.deletedAt ?? undefined;
    if (args.patch.deletedByUserId !== undefined) {
      patch.deletedByUserId = args.patch.deletedByUserId ?? undefined;
    }
    if (args.patch.purgeEligibleAt !== undefined) {
      patch.purgeEligibleAt = args.patch.purgeEligibleAt ?? undefined;
    }
    patch.updatedAt = args.patch.updatedAt;
    await ctx.db.patch(args.attachmentId, patch);
    return null;
  },
});

export const assignAttachmentsToMessageInternal = internalMutation({
  args: {
    attachmentIds: v.array(v.id('chatAttachments')),
    threadId: v.id('chatThreads'),
    agentMessageId: v.string(),
    updatedAt: v.number(),
  },
  returns: v.null(),
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
    return null;
  },
});

export const deleteAttachmentStorageInternal = internalMutation({
  args: {
    attachmentId: v.id('chatAttachments'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.attachmentId);
    return null;
  },
});

export const listExpiredAttachmentUploadTokensInternal = internalQuery({
  args: {
    cutoff: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id('chatAttachmentUploadTokens'),
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query('chatAttachmentUploadTokens')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', args.cutoff))
      .collect();

    return tokens.map((token) => ({
      _id: token._id,
      storageId: token.storageId,
    }));
  },
});

export const deleteAttachmentUploadTokenInternal = internalMutation({
  args: {
    tokenId: v.id('chatAttachmentUploadTokens'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.tokenId);
    return null;
  },
});

export const quarantineAttachmentByStorageIdInternal = internalMutation({
  args: {
    reason: v.string(),
    storageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attachment = await ctx.db
      .query('chatAttachments')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .unique();

    if (!attachment) {
      return null;
    }

    await ctx.db.patch(attachment._id, {
      errorMessage: args.reason,
      status: 'quarantined',
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const createRunInternal = internalMutation({
  args: {
    threadId: v.id('chatThreads'),
    agentThreadId: v.string(),
    organizationId: v.string(),
    initiatedByUserId: v.string(),
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
    failureKind: v.optional(
      v.union(
        v.literal('provider_policy'),
        v.literal('provider_unavailable'),
        v.literal('tool_error'),
        v.literal('unknown'),
      ),
    ),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    useWebSearch: v.boolean(),
    actualInputTokens: v.optional(v.number()),
    actualOutputTokens: v.optional(v.number()),
    actualTotalTokens: v.optional(v.number()),
    usageEventCount: v.optional(v.number()),
    usageRecordedAt: v.optional(v.number()),
  },
  returns: v.id('chatRuns'),
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
      failureKind: v.optional(
        v.union(
          v.literal('provider_policy'),
          v.literal('provider_unavailable'),
          v.literal('tool_error'),
          v.literal('unknown'),
          v.null(),
        ),
      ),
      activeAssistantMessageId: v.optional(v.union(v.string(), v.null())),
      provider: v.optional(v.union(v.string(), v.null())),
      model: v.optional(v.union(v.string(), v.null())),
      actualInputTokens: v.optional(v.union(v.number(), v.null())),
      actualOutputTokens: v.optional(v.union(v.number(), v.null())),
      actualTotalTokens: v.optional(v.union(v.number(), v.null())),
      usageEventCount: v.optional(v.union(v.number(), v.null())),
      usageRecordedAt: v.optional(v.union(v.number(), v.null())),
    }),
  },
  returns: v.null(),
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
    if (args.patch.failureKind !== undefined) {
      patch.failureKind = args.patch.failureKind ?? undefined;
    }
    if (args.patch.activeAssistantMessageId !== undefined) {
      patch.activeAssistantMessageId = args.patch.activeAssistantMessageId ?? undefined;
    }
    if (args.patch.provider !== undefined) patch.provider = args.patch.provider ?? undefined;
    if (args.patch.model !== undefined) patch.model = args.patch.model ?? undefined;
    if (args.patch.actualInputTokens !== undefined) {
      patch.actualInputTokens = args.patch.actualInputTokens ?? undefined;
    }
    if (args.patch.actualOutputTokens !== undefined) {
      patch.actualOutputTokens = args.patch.actualOutputTokens ?? undefined;
    }
    if (args.patch.actualTotalTokens !== undefined) {
      patch.actualTotalTokens = args.patch.actualTotalTokens ?? undefined;
    }
    if (args.patch.usageEventCount !== undefined) {
      patch.usageEventCount = args.patch.usageEventCount ?? undefined;
    }
    if (args.patch.usageRecordedAt !== undefined) {
      patch.usageRecordedAt = args.patch.usageRecordedAt ?? undefined;
    }
    await ctx.db.patch(args.runId, patch);
    return null;
  },
});

export const getRunByIdInternal = internalQuery({
  args: {
    runId: v.id('chatRuns'),
    organizationId: v.string(),
  },
  returns: v.union(chatRunsDocValidator, v.null()),
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
  returns: v.union(chatRunsDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const getLatestRunForThreadInternal = internalQuery({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.union(chatRunsDocValidator, v.null()),
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
  returns: v.union(chatRunsDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatRuns')
      .withIndex('by_threadId_and_status', (q) =>
        q.eq('threadId', args.threadId).eq('status', 'streaming'),
      )
      .first();
  },
});

export const listStaleStreamingRunsInternal = internalQuery({
  args: {
    startedBefore: v.number(),
    limit: v.number(),
  },
  returns: v.array(chatRunsDocValidator),
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
  returns: v.union(chatThreadsDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.threadId);
  },
});

export const getThreadByAgentThreadIdAnyInternal = internalQuery({
  args: {
    agentThreadId: v.string(),
  },
  returns: v.union(chatThreadsDocValidator, v.null()),
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
    actorUserId: v.string(),
    threadOwnerUserId: v.string(),
    threadId: v.id('chatThreads'),
    runId: v.optional(v.id('chatRuns')),
    agentThreadId: v.string(),
    agentName: v.optional(v.string()),
    operationKind: v.union(
      v.literal('chat_turn'),
      v.literal('web_search'),
      v.literal('thread_title'),
      v.literal('thread_summary'),
    ),
    model: v.string(),
    provider: v.string(),
    totalTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    providerMetadataJson: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id('chatUsageEvents'),
  handler: async (ctx, args) => {
    const recordedAt = args.createdAt;
    const usage = await chargeActualChatTokens(ctx, {
      organizationId: args.organizationId,
      userId: args.actorUserId,
      totalTokens: args.totalTokens,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
    });

    const usageEventId = await ctx.db.insert('chatUsageEvents', {
      ...args,
      totalTokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    if (args.runId) {
      const run = await ctx.db.get(args.runId);
      if (run) {
        await ctx.db.patch(args.runId, buildChatUsageAggregatePatch(run, usage, recordedAt));
      }
    }

    return usageEventId;
  },
});

export const listThreads = query({
  args: {},
  returns: v.array(threadWithAccessValidator),
  handler: async (ctx) => {
    const viewer = await getCurrentChatContextOrNull(ctx);
    if (!viewer) {
      return [];
    }

    const threads = await listAccessibleThreads(ctx, viewer);

    return threads.map((thread) => toThreadWithAccess(thread, viewer));
  },
});

export const getLatestThreadId = query({
  args: {},
  returns: v.union(v.id('chatThreads'), v.null()),
  handler: async (ctx) => {
    const viewer = await getCurrentChatContextOrNull(ctx);
    if (!viewer) {
      return null;
    }

    const threads = viewer.isSiteAdmin
      ? await ctx.db
          .query('chatThreads')
          .withIndex('by_organizationId_and_lastMessageAt', (q) =>
            q.eq('organizationId', viewer.organizationId),
          )
          .order('desc')
          .take(1)
      : await ctx.db
          .query('chatThreads')
          .withIndex('by_ownerUserId_and_lastMessageAt', (q) => q.eq('ownerUserId', viewer.userId))
          .order('desc')
          .take(1);

    return threads.find((thread) => !thread.deletedAt)?._id ?? null;
  },
});

export const getThread = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.union(threadWithAccessValidator, v.null()),
  handler: async (ctx, args): Promise<ThreadWithAccess | null> => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    return thread ? toThreadWithAccess(thread, viewer) : null;
  },
});

export const getThreadTitle = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const normalizedThreadId = ensureThreadId(ctx, args.threadId);
    if (!normalizedThreadId) {
      return null;
    }

    const thread = await getThreadForViewer(ctx, normalizedThreadId, viewer);
    return thread?.title ?? null;
  },
});

export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  returns: chatMessagePageValidator,
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const normalizedThreadId = ensureThreadId(ctx, args.threadId);

    if (!normalizedThreadId) {
      return {
        page: [],
        isDone: true,
        continueCursor: args.paginationOpts.cursor ?? '',
        streams: undefined,
      };
    }

    const thread = await getThreadForViewer(ctx, normalizedThreadId, viewer);
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
      page: paginated.page.map((message) => ({
        ...message,
        metadata: {
          ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
          canEdit:
            message.role === 'user'
              ? canEditUserMessage(message as { metadata?: unknown }, thread, viewer)
              : false,
        },
      })),
      streams,
    };
  },
});

export const getActiveRun = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.union(activeRunWithAccessValidator, v.null()),
  handler: async (ctx, args): Promise<(ChatRunDoc & { canStop: boolean }) | null> => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      return null;
    }

    const runs = await getChatRunsForThread(ctx, args.threadId);
    const run = runs.find((nextRun) => nextRun.status === 'streaming') ?? null;
    return run ? { ...run, canStop: canStopRun(run, thread, viewer) } : null;
  },
});

export const getLatestRunState = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.union(chatLatestRunStateValidator, v.null()),
  handler: async (
    ctx,
    args,
  ): Promise<{
    runId: Id<'chatRuns'>;
    status: ChatRunDoc['status'];
    canStop: boolean;
    errorMessage?: string;
    failureKind?: ChatRunFailureKind;
    endedAt?: number;
    promptMessageId?: string;
  } | null> => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      return null;
    }

    const run = (await ctx.runQuery(internal.agentChat.getLatestRunForThreadInternal, {
      threadId: args.threadId,
    })) as ChatRunDoc | null;
    if (!run) {
      return null;
    }

    return {
      runId: run._id,
      status: run.status,
      canStop: canStopRun(run, thread, viewer),
      errorMessage: run.errorMessage,
      failureKind: run.failureKind,
      endedAt: run.endedAt,
      promptMessageId: run.promptMessageId,
    };
  },
});

export const getRetryableRunIds = query({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.record(v.string(), v.string()),
  handler: async (ctx, args): Promise<Record<string, string>> => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      return {};
    }

    const runs = await ctx.db
      .query('chatRuns')
      .withIndex('by_threadId_and_startedAt', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .take(RETRYABLE_RUN_LOOKBACK_LIMIT);

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
  returns: advisoryChatRateLimitValidator,
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContextOrNull(ctx);
    if (!viewer) {
      return {
        request: { ok: true },
        estimatedTokens: { ok: true },
        estimatedInputTokens: 0,
      } satisfies AdvisoryChatRateLimit;
    }

    const { userId, organizationId } = viewer;
    return await getAdvisoryChatRateLimit(ctx, {
      organizationId,
      userId,
      textLength: args.textLength,
      hasAttachments: args.hasAttachments,
    });
  },
});

async function abortExistingRunForThread(
  ctx: MutationCtx,
  args: {
    threadId: Id<'chatThreads'>;
    reason: string;
    viewer: Pick<ChatViewerContext, 'userId' | 'organizationId' | 'isSiteAdmin'>;
  },
) {
  const activeRun = (await ctx.runQuery(internal.agentChat.getLatestActiveRunForThreadInternal, {
    threadId: args.threadId,
  })) as Doc<'chatRuns'> | null;

  if (!activeRun) {
    return;
  }

  const thread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
    threadId: args.threadId,
  })) as ChatThreadDoc | null;
  if (!thread || !canStopRun(activeRun, thread, args.viewer)) {
    throw new ConvexError('Another user is generating a response for this thread.');
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

async function assertOrganizationChatPolicies(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    useWebSearch: boolean;
  },
) {
  const policies = await getOrganizationPolicies(ctx, args.organizationId);

  if (args.useWebSearch && !policies.webSearchAllowed) {
    throw new ConvexError('Web search is disabled by organization policy.');
  }

  return policies;
}

async function createStreamingRun(
  ctx: MutationCtx,
  args: {
    thread: ChatThreadDoc;
    initiatedByUserId: string;
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
    initiatedByUserId: args.initiatedByUserId,
    ownerSessionId: args.ownerSessionId,
    status: 'streaming',
    startedAt: Date.now(),
    promptMessageId: args.promptMessageId,
    provider: 'openrouter',
    model: args.model,
    useWebSearch: args.useWebSearch,
    failureKind: undefined,
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualTotalTokens: 0,
    usageEventCount: 0,
  })) as Id<'chatRuns'>;
}

export const precreateThread = mutation({
  args: {
    text: v.string(),
    attachmentIds: v.array(v.id('chatAttachments')),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.id('chatThreads'),
  }),
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'> }> => {
    const { userId, organizationId, sessionId } = await getCurrentChatContext(ctx);

    if (!args.text.trim() && args.attachmentIds.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const attachments = (await ctx.runQuery(internal.agentChat.getAttachmentsForSendInternal, {
      attachmentIds: args.attachmentIds,
      userId,
      organizationId,
    })) as ChatAttachmentDoc[];
    const { thread, created } = await resolveThread(ctx, {
      threadId: undefined,
      organizationId,
      userId,
      text: args.text,
      attachments,
      personaId: args.personaId,
      model: args.model,
    });

    if (created) {
      await ctx.runMutation(internal.audit.insertAuditLog, {
        eventType: 'chat_thread_created',
        userId,
        actorUserId: userId,
        organizationId,
        sessionId,
        outcome: 'success',
        severity: 'info',
        resourceType: 'chat_thread',
        resourceId: thread._id,
        resourceLabel: thread.title,
        sourceSurface: 'chat.precreate_thread',
        metadata: JSON.stringify({
          threadId: thread._id,
          title: thread.title,
          personaId: args.personaId ?? null,
          model: args.model ?? null,
        }),
      });
    }

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
  returns: v.object({
    threadId: v.id('chatThreads'),
    runId: v.id('chatRuns'),
  }),
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { userId, organizationId, isSiteAdmin, currentUserName } =
      await getCurrentChatContext(ctx);

    if (!args.text.trim() && args.attachmentIds.length === 0) {
      throw new ConvexError('Message content is required.');
    }

    const thread = await getThreadForViewer(ctx, args.threadId, {
      userId,
      organizationId,
      isSiteAdmin,
    });
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    await enforceChatPreflightOrThrow(ctx, {
      organizationId,
      userId,
      textLength: args.text.length,
      hasAttachments: args.attachmentIds.length > 0,
    });
    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
      viewer: { userId, organizationId, isSiteAdmin },
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
    await assertOrganizationChatPolicies(ctx, {
      organizationId,
      useWebSearch: args.useWebSearch ?? false,
    });
    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model,
      isSiteAdmin,
    });
    await assertOrganizationChatPolicies(ctx, {
      organizationId,
      useWebSearch: args.useWebSearch ?? false,
    });
    assertChatModelSupportsWebSearch({
      useWebSearch: args.useWebSearch ?? false,
      model: selectedModel,
    });
    const userMessage = await buildUserMessage(ctx, args.text, attachments);
    const savedPrompt = await baseChatAgent.saveMessages(ctx, {
      threadId: thread.agentThreadId,
      userId,
      messages: [userMessage.message],
      skipEmbeddings: true,
      metadata: [
        {
          ...(userMessage.fileIds.length > 0 ? { fileIds: userMessage.fileIds } : {}),
          ...(args.clientMessageId ? { clientMessageId: args.clientMessageId } : {}),
          ...{ authorUserId: userId, authorName: currentUserName },
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
      initiatedByUserId: userId,
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
  returns: v.object({
    threadId: v.id('chatThreads'),
    runId: v.id('chatRuns'),
  }),
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);
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

    if (
      !canEditUserMessage(message, thread, {
        userId,
        organizationId,
        isSiteAdmin,
      })
    ) {
      throw new ConvexError('You do not have permission to edit this message.');
    }

    await enforceChatPreflightOrThrow(ctx, {
      organizationId,
      userId,
      textLength: nextText.length,
      hasAttachments: false,
    });
    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
      viewer: { userId, organizationId, isSiteAdmin },
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
    assertChatModelSupportsWebSearch({
      useWebSearch: args.useWebSearch ?? false,
      model: selectedModel,
    });
    const runId = await createStreamingRun(ctx, {
      thread,
      initiatedByUserId: userId,
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
  returns: v.object({
    threadId: v.id('chatThreads'),
    runId: v.id('chatRuns'),
  }),
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
      runId: args.runId,
      organizationId,
    })) as Doc<'chatRuns'> | null;

    if (!run?.promptMessageId) {
      throw new ConvexError('Run not found.');
    }

    const thread = await getThreadForViewer(ctx, run.threadId, {
      userId,
      organizationId,
      isSiteAdmin,
    });
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    const [promptMessage] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [run.promptMessageId],
    })) as Array<AgentMessageDoc | null>;

    if (!isValidContinuationPromptMessage(promptMessage, thread.agentThreadId)) {
      throw new ConvexError('Prompt message not found.');
    }

    await enforceChatPreflightOrThrow(ctx, {
      organizationId,
      userId,
      textLength: getMessageTextLength(promptMessage),
      hasAttachments: (promptMessage.fileIds?.length ?? 0) > 0,
    });
    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
      viewer: { userId, organizationId, isSiteAdmin },
    });

    await deleteMessagesAfterPrompt(ctx, thread.agentThreadId, promptMessage);

    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model ?? run.model,
      isSiteAdmin,
    });
    const useWebSearch = args.useWebSearch ?? run.useWebSearch;
    await assertOrganizationChatPolicies(ctx, {
      organizationId,
      useWebSearch,
    });
    assertChatModelSupportsWebSearch({
      useWebSearch,
      model: selectedModel,
    });
    const runId = await createStreamingRun(ctx, {
      thread,
      initiatedByUserId: userId,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: run.promptMessageId,
      model: selectedModel.modelId,
      useWebSearch,
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
  returns: v.object({
    threadId: v.id('chatThreads'),
    runId: v.id('chatRuns'),
  }),
  handler: async (ctx, args): Promise<{ threadId: Id<'chatThreads'>; runId: Id<'chatRuns'> }> => {
    const { userId, organizationId, isSiteAdmin } = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, {
      userId,
      organizationId,
      isSiteAdmin,
    });
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }

    if (args.personaId) {
      const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
      if (!persona) {
        throw new ConvexError('Persona not found.');
      }
    }

    const [candidatePromptMessage] = (await ctx.runQuery(
      components.agent.messages.getMessagesByIds,
      {
        messageIds: [args.promptMessageId],
      },
    )) as Array<AgentMessageDoc | null>;

    if (!isValidContinuationPromptMessage(candidatePromptMessage, thread.agentThreadId)) {
      throw new ConvexError('Prompt message not found.');
    }
    const promptMessage = candidatePromptMessage;

    await enforceChatPreflightOrThrow(ctx, {
      organizationId,
      userId,
      textLength: getMessageTextLength(promptMessage),
      hasAttachments: (promptMessage.fileIds?.length ?? 0) > 0,
    });
    await abortExistingRunForThread(ctx, {
      threadId: thread._id,
      reason: 'Superseded by a newer request.',
      viewer: { userId, organizationId, isSiteAdmin },
    });

    await deleteMessagesAfterPrompt(ctx, thread.agentThreadId, promptMessage);

    const selectedModel = await resolveRequestedModel(ctx, {
      requestedModelId: args.model,
      threadModelId: thread.model,
      isSiteAdmin,
    });
    const resolvedPersonaId = args.personaId ?? thread.personaId;
    const useWebSearch = args.useWebSearch ?? false;
    await assertOrganizationChatPolicies(ctx, {
      organizationId,
      useWebSearch,
    });
    assertChatModelSupportsWebSearch({
      useWebSearch,
      model: selectedModel,
    });
    const runId = await createStreamingRun(ctx, {
      thread,
      initiatedByUserId: userId,
      organizationId,
      ownerSessionId: args.ownerSessionId,
      promptMessageId: args.promptMessageId,
      model: selectedModel.modelId,
      useWebSearch,
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

export const generateChatAttachmentUploadTarget = action({
  args: {
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
  },
  returns: v.object({
    uploadTarget: uploadTargetResultValidator,
    uploadToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(internal.agentChat.getCurrentChatContextInternal, {});
    await enforceChatAttachmentUploadsRateLimitOrThrow(ctx, {
      organizationId: viewer.organizationId,
      userId: viewer.userId,
    });
    const token = createChatAttachmentUploadToken();
    const now = Date.now();
    const uploadTarget = await createUploadTargetWithMode(ctx, {
      contentType: args.mimeType,
      fileName: args.fileName.trim(),
      fileSize: args.sizeBytes,
      sourceId: `pending:${token}`,
      sourceType: 'chat_attachment',
    });

    await ctx.runMutation(internal.agentChat.issueAttachmentUploadTokenInternal, {
      token,
      storageId: uploadTarget.storageId,
      userId: viewer.userId,
      organizationId: viewer.organizationId,
      sessionId: viewer.sessionId,
      expectedFileName: args.fileName.trim(),
      expectedMimeType: args.mimeType,
      expectedSizeBytes: args.sizeBytes,
      expectedSha256: args.sha256.toLowerCase(),
      expiresAt: now + CHAT_ATTACHMENT_UPLOAD_TOKEN_TTL_MS,
      createdAt: now,
    });

    return {
      uploadTarget,
      uploadToken: token,
    };
  },
});

export const listPersonas = query({
  args: {},
  returns: v.array(personaWithAccessValidator),
  handler: async (ctx): Promise<PersonaWithAccess[]> => {
    const viewer = await getCurrentChatContextOrNull(ctx);
    if (!viewer) {
      return [];
    }

    const { organizationId } = viewer;

    return await ctx.db
      .query('aiPersonas')
      .withIndex('by_organizationId_and_createdAt', (q) => q.eq('organizationId', organizationId))
      .collect()
      .then((personas) => personas.map((persona) => toPersonaWithAccess(persona, viewer)));
  },
});

export const setThreadPersona = mutation({
  args: {
    threadId: v.id('chatThreads'),
    personaId: v.optional(v.id('aiPersonas')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }
    if (!canManageThread(thread, viewer)) {
      throw new ConvexError('You do not have permission to update this thread.');
    }

    if (args.personaId) {
      const persona = await getPersonaForOrganization(ctx, args.personaId, viewer.organizationId);
      if (!persona) {
        throw new ConvexError('Persona not found.');
      }
    }

    await ctx.db.patch(args.threadId, {
      personaId: args.personaId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const renameThread = mutation({
  args: {
    threadId: v.id('chatThreads'),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }
    if (!canManageThread(thread, viewer)) {
      throw new ConvexError('You do not have permission to rename this thread.');
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
    return null;
  },
});

export const setThreadPinned = mutation({
  args: {
    threadId: v.id('chatThreads'),
    pinned: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }
    if (!canManageThread(thread, viewer)) {
      throw new ConvexError('You do not have permission to update this thread.');
    }
    if (thread.pinned === args.pinned) {
      return null;
    }

    await ctx.db.patch(args.threadId, {
      pinned: args.pinned,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.id('chatThreads'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const thread = await getThreadForViewer(ctx, args.threadId, viewer);
    if (!thread) {
      throw new ConvexError('Thread not found.');
    }
    if (!canManageThread(thread, viewer)) {
      throw new ConvexError('You do not have permission to delete this thread.');
    }

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: args.threadId,
      patch: {
        deletedAt: Date.now(),
        deletedByUserId: viewer.userId,
        updatedAt: Date.now(),
      },
    });
    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: 'chat_thread_deleted',
      userId: viewer.userId,
      actorUserId: viewer.userId,
      organizationId: viewer.organizationId,
      sessionId: viewer.sessionId,
      outcome: 'success',
      severity: 'warning',
      resourceType: 'chat_thread',
      resourceId: args.threadId,
      resourceLabel: thread.title,
      sourceSurface: 'chat.thread_delete',
      metadata: JSON.stringify({
        threadId: args.threadId,
        title: thread.title,
      }),
    });
    return null;
  },
});

export const createPersona = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
  },
  returns: v.id('aiPersonas'),
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
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await getCurrentChatContext(ctx);
    const { organizationId } = viewer;
    const persona = await getPersonaForOrganization(ctx, args.personaId, organizationId);
    if (!persona) {
      throw new ConvexError('Persona not found.');
    }
    if (!canManagePersona(persona, viewer)) {
      throw new ConvexError('You do not have permission to update this persona.');
    }

    await ctx.db.patch(args.personaId, {
      name: args.name.trim(),
      prompt: args.prompt.trim(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const clearThreadsForPersonaBatchInternal = internalMutation({
  args: {
    limit: v.number(),
    organizationId: v.string(),
    personaId: v.id('aiPersonas'),
    updatedAt: v.number(),
  },
  returns: v.object({
    isDone: v.boolean(),
    updatedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query('chatThreads')
      .withIndex('by_organizationId_and_personaId', (q) =>
        q.eq('organizationId', args.organizationId).eq('personaId', args.personaId),
      )
      .take(args.limit);

    await Promise.all(
      threads.map((thread) =>
        ctx.db.patch(thread._id, {
          personaId: undefined,
          updatedAt: args.updatedAt,
        }),
      ),
    );

    return {
      isDone: threads.length < args.limit,
      updatedCount: threads.length,
    };
  },
});

export const deletePersonaInternal = internalMutation({
  args: {
    personaId: v.id('aiPersonas'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.personaId);
    return null;
  },
});

async function deletePersonaInBatches(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    personaId: Id<'aiPersonas'>;
  },
) {
  while (true) {
    const result = await ctx.runMutation(internal.agentChat.clearThreadsForPersonaBatchInternal, {
      limit: PERSONA_THREAD_CLEANUP_BATCH_SIZE,
      organizationId: args.organizationId,
      personaId: args.personaId,
      updatedAt: Date.now(),
    });

    if (result.isDone) {
      return;
    }
  }
}

export const deletePersona = action({
  args: {
    personaId: v.id('aiPersonas'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await ctx.runQuery(internal.agentChat.getCurrentChatContextInternal, {});
    const { organizationId } = viewer;
    const persona = await ctx.runQuery(internal.agentChat.getPersonaByIdInternal, {
      organizationId,
      personaId: args.personaId,
    });
    if (!persona) {
      throw new ConvexError('Persona not found.');
    }
    if (!canManagePersona(persona, viewer)) {
      throw new ConvexError('You do not have permission to delete this persona.');
    }

    await deletePersonaInBatches(ctx, {
      organizationId,
      personaId: args.personaId,
    });
    await ctx.runMutation(internal.agentChat.deletePersonaInternal, {
      personaId: args.personaId,
    });
    return null;
  },
});
