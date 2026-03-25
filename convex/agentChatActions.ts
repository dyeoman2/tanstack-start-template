'use node';

import { getFile, serializeMessage, storeFile } from '@convex-dev/agent';
import type { ModelMessage } from 'ai';
import { ConvexError, v } from 'convex/values';
import { getFileStorageBackendMode } from '../src/lib/server/env.server';
import { inspectFile } from '../src/lib/server/file-inspection.server';
import { getRetentionPolicyConfig } from '../src/lib/server/security-config.server';
import {
  type ChatModelCatalogEntry,
  DEFAULT_CHAT_MODEL_ID,
  getChatModelCatalogEntry,
} from '../src/lib/shared/chat-models';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { type ActionCtx, action, internalAction, type MutationCtx } from './_generated/server';
import {
  type ChatAttachmentDoc,
  type ChatRunFailureKind,
  type ChatThreadDoc,
  classifyChatRunFailure,
  deriveThreadTitle,
} from './lib/agentChat';
import { buildChatRequestConfig, getBaseChatAgent } from './lib/chatAgentRuntime';
import {
  buildAttachmentPromptSummary,
  extractDocumentText,
  validateChatAttachmentUpload,
} from './lib/chatAttachments';
import { enforceChatAttachmentProcessingRateLimitOrThrow } from './lib/chatRateLimits';
import { chatAttachmentWithPreviewValidator } from './lib/returnValidators';
import { recordSystemAuditEvent, recordUserAuditEvent } from './lib/auditEmitters';
import { getCleanObject } from './lib/storageS3';
import {
  finalizeUploadWithMode,
  resolveFileUrlWithMode,
  storeDerivedFileWithMode,
} from './storagePlatform';
import { getStorageReadiness } from './storageReadiness';

type ChatDataCtx =
  | Pick<ActionCtx, 'runQuery' | 'runMutation'>
  | Pick<MutationCtx, 'runQuery' | 'runMutation'>;

export type AuthenticatedChatContext = {
  userId: string;
  organizationId: string;
  sessionId: string;
  isSiteAdmin: boolean;
  currentUserName: string;
};

type ChatAttachmentWithPreview = Doc<'chatAttachments'> & {
  previewUrl: string | null;
};

export type AgentMessageDoc = {
  _id: string;
  threadId: string;
  order: number;
  stepOrder: number;
  status: string;
  error?: string;
  fileIds?: string[];
  metadata?: unknown;
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

type StreamTextResult = {
  order: number;
  text: Promise<string> | string;
  sources: Promise<unknown[] | undefined> | unknown[] | undefined;
  consumeStream: () => Promise<void>;
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

async function computeBlobSha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Buffer.from(digest).toString('hex');
}

async function toBlob(body: unknown, mimeType: string) {
  if (!body) {
    throw new Error('Uploaded file body was empty.');
  }

  if (body instanceof Blob) {
    return body;
  }

  if (typeof body === 'string') {
    return new Blob([body], { type: mimeType });
  }

  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return new Blob([copy.buffer], {
      type: mimeType,
    });
  }

  if (body instanceof ArrayBuffer) {
    return new Blob([new Uint8Array(body)], { type: mimeType });
  }

  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer], {
      type: mimeType,
    });
  }

  if (typeof body === 'object' && body !== null && 'transformToString' in body) {
    const text = await (body as { transformToString: () => Promise<string> }).transformToString();
    return new Blob([text], { type: mimeType });
  }

  throw new Error('Uploaded file body could not be converted to a blob.');
}

async function loadAttachmentProcessingBlob(
  ctx: ActionCtx,
  args: {
    attachment: ChatAttachmentDoc;
    lifecycle: Doc<'storageLifecycle'>;
  },
) {
  if (args.attachment.rawStorageId) {
    const blob = await ctx.storage.get(args.attachment.rawStorageId);
    if (blob) {
      return blob;
    }
  }

  if (args.lifecycle.backendMode === 's3-primary') {
    if (!args.lifecycle.canonicalBucket || !args.lifecycle.canonicalKey) {
      throw new ConvexError('Stored file does not have an S3 backing object.');
    }

    const object = await getCleanObject({ key: args.lifecycle.canonicalKey });
    return await toBlob(object.Body, args.attachment.mimeType);
  }

  const blob = await ctx.storage.get(args.attachment.storageId as Id<'_storage'>);
  if (!blob) {
    throw new ConvexError('Uploaded file was not found.');
  }

  return blob;
}

async function getAssistantMessageForOrder(ctx: ChatDataCtx, agentThreadId: string, order: number) {
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

async function getStreamIdForOrder(ctx: ChatDataCtx, agentThreadId: string, order: number) {
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
          part?.type === 'source' && part.sourceType === 'url' && typeof part.url === 'string'
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

async function getAgentMessageById(ctx: ChatDataCtx, messageId: string) {
  const [message] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
    messageIds: [messageId],
  })) as Array<AgentMessageDoc | null>;

  return message;
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
  return (await ctx.runQuery(
    internal.agentChat.getCurrentChatContextInternal,
    {},
  )) as AuthenticatedChatContext;
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
    const existingThread = (await ctx.runQuery(
      internal.agentChat.getThreadForOrganizationInternal,
      {
        threadId: args.threadId,
        organizationId: args.organizationId,
      },
    )) as ChatThreadDoc | null;

    if (!existingThread) {
      throw new ConvexError('Thread not found.');
    }

    return {
      thread: existingThread,
      created: false as const,
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
  const { threadId: agentThreadId } = await getBaseChatAgent().createThread(ctx, {
    userId: args.userId,
    title,
  });
  const threadId = (await ctx.runMutation(internal.agentChat.createThreadShellInternal, {
    ownerUserId: args.userId,
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
    ownerUserId: args.userId,
    organizationId: args.organizationId,
    agentThreadId,
    title,
    pinned: false,
    visibility: 'private',
    personaId: args.personaId,
    model: args.model,
    titleManuallyEdited: false,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  };

  return {
    thread,
    created: true as const,
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

export function isValidContinuationPromptMessage(
  message: AgentMessageDoc | null,
  expectedThreadId: string,
): message is AgentMessageDoc {
  return message?.threadId === expectedThreadId && message.message?.role === 'user';
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
    failureKind?: ChatRunFailureKind;
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
  const assistantMessage = run.activeAssistantMessageId
    ? await getAgentMessageById(ctx, run.activeAssistantMessageId)
    : null;

  if (run.activeAssistantMessageId) {
    if (args.status === 'aborted') {
      if (partialText) {
        const serialized = await serializeMessage(ctx, components.agent, {
          role: 'assistant',
          content: partialText,
        });
        await ctx.runMutation(components.agent.messages.updateMessage, {
          messageId: run.activeAssistantMessageId,
          patch: {
            message: serialized.message,
            status: 'success',
            model: run.model,
            provider: run.provider,
          },
        });
      } else if (assistantMessage?._id) {
        await ctx.runMutation(components.agent.messages.deleteByIds, {
          messageIds: [assistantMessage._id],
        });
      }
    } else if (partialText) {
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
      failureKind: args.status === 'error' ? (args.failureKind ?? 'unknown') : null,
      ...(args.status === 'aborted' && !partialText ? { activeAssistantMessageId: null } : {}),
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

async function reconcileAbortedRunArtifacts(
  ctx: ChatDataCtx,
  args: {
    run: Doc<'chatRuns'>;
    assistantMessage: AgentMessageDoc | null;
    streamId: string | null;
  },
) {
  const partialText = (
    await getStreamPartialText(ctx, {
      agentThreadId: args.run.agentThreadId,
      agentStreamId: args.streamId ?? undefined,
    })
  ).trim();

  if (args.assistantMessage?._id) {
    if (partialText) {
      const serialized = await serializeMessage(ctx, components.agent, {
        role: 'assistant',
        content: partialText,
      });
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: args.assistantMessage._id,
        patch: {
          message: serialized.message,
          status: 'success',
          model: args.run.model,
          provider: args.run.provider,
        },
      });
    } else {
      await ctx.runMutation(components.agent.messages.deleteByIds, {
        messageIds: [args.assistantMessage._id],
      });
    }
  }

  await ctx.runMutation(internal.agentChat.patchRunInternal, {
    runId: args.run._id,
    patch: {
      agentStreamId: null,
      ...(args.assistantMessage?._id && partialText
        ? { activeAssistantMessageId: args.assistantMessage._id }
        : { activeAssistantMessageId: null }),
    },
  });

  if (args.streamId) {
    await ctx.runMutation(components.agent.streams.abort, {
      streamId: args.streamId,
      reason: args.run.errorMessage ?? 'Stopped by user.',
    });
  }
}

export const createChatAttachmentFromUpload = action({
  args: {
    storageId: v.string(),
    uploadToken: v.string(),
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  returns: chatAttachmentWithPreviewValidator,
  handler: async (ctx, args): Promise<ChatAttachmentWithPreview> => {
    const { userId, organizationId, sessionId } = await getAuthenticatedContext(ctx);
    await enforceChatAttachmentProcessingRateLimitOrThrow(ctx, {
      organizationId,
      userId,
    });
    const uploadTokenRecord = await ctx.runMutation(
      internal.agentChat.consumeAttachmentUploadTokenInternal,
      {
        token: args.uploadToken,
        userId,
        organizationId,
        sessionId,
      },
    );

    if (!uploadTokenRecord) {
      throw new ConvexError('Attachment upload token is invalid or expired.');
    }

    if (
      uploadTokenRecord.expectedFileName !== args.name.trim() ||
      uploadTokenRecord.expectedMimeType !== args.mimeType ||
      uploadTokenRecord.expectedSizeBytes !== args.sizeBytes ||
      (uploadTokenRecord.storageId && uploadTokenRecord.storageId !== args.storageId)
    ) {
      throw new ConvexError('Attachment metadata does not match the authorized upload.');
    }

    const backendMode = getFileStorageBackendMode();
    const blob =
      backendMode === 's3-primary' ? null : await ctx.storage.get(args.storageId as Id<'_storage'>);
    if (!blob) {
      if (backendMode !== 's3-primary') {
        throw new Error('Uploaded file was not found.');
      }
    }

    if (blob) {
      const uploadedSha256 = await computeBlobSha256Hex(blob);
      if (uploadedSha256 !== uploadTokenRecord.expectedSha256) {
        throw new ConvexError('Uploaded file does not match the authorized upload.');
      }
    }

    const validatedAttachment = validateChatAttachmentUpload({
      blobSize: blob?.size ?? args.sizeBytes,
      blobType: blob?.type ?? args.mimeType,
      fileName: args.name,
      claimedMimeType: args.mimeType,
    });
    const kind = validatedAttachment.kind;
    const now = Date.now();
    const initialSummary = buildAttachmentPromptSummary({
      kind,
      name: validatedAttachment.normalizedName,
    });
    const attachmentId = (await ctx.runMutation(internal.agentChat.createAttachmentInternal, {
      threadId: undefined,
      agentMessageId: undefined,
      userId,
      organizationId,
      storageId: args.storageId,
      kind,
      name: validatedAttachment.normalizedName,
      mimeType: validatedAttachment.mimeType,
      sizeBytes: validatedAttachment.sizeBytes,
      rawStorageId: backendMode === 's3-primary' ? undefined : (args.storageId as Id<'_storage'>),
      extractedTextStorageId: undefined,
      agentFileId: undefined,
      promptSummary: initialSummary,
      status: 'pending_scan',
      errorMessage: undefined,
      createdAt: now,
    })) as Id<'chatAttachments'>;

    await recordUserAuditEvent(ctx, {
      actorUserId: userId,
      emitter: 'chat.attachment',
      eventType: 'chat_attachment_uploaded',
      metadata: JSON.stringify({
        attachmentId,
        kind,
        mimeType: validatedAttachment.mimeType,
        sizeBytes: validatedAttachment.sizeBytes,
      }),
      organizationId,
      outcome: 'success',
      resourceId: attachmentId,
      resourceLabel: validatedAttachment.normalizedName,
      resourceType: 'chat_attachment',
      sessionId,
      severity: 'info',
      sourceSurface: 'chat.attachment_upload',
      userId,
    });

    const allowedKinds = kind === 'image' ? (['image'] as const) : (['document', 'pdf'] as const);
    const inspectionResult = blob
      ? await inspectFile({
          allowedKinds: [...allowedKinds],
          blob,
          fileName: validatedAttachment.normalizedName,
          maxBytes: validatedAttachment.sizeBytes,
          mimeType: validatedAttachment.mimeType,
        })
      : {
          details: undefined,
          engine: 'builtin-file-inspection' as const,
          inspectedAt: Date.now(),
          reason: 'unsupported_type' as const,
          status: 'accepted' as const,
        };

    await ctx.runMutation(internal.securityOps.recordDocumentScanEventInternal, {
      attachmentId,
      details: inspectionResult.details ?? null,
      fileName: validatedAttachment.normalizedName,
      mimeType: validatedAttachment.mimeType,
      organizationId,
      requestedByUserId: userId,
      resultStatus: inspectionResult.status,
      scannedAt: inspectionResult.inspectedAt,
      scannerEngine: inspectionResult.engine,
    });

    if (inspectionResult.status === 'quarantined') {
      const quarantineUntil =
        now + getRetentionPolicyConfig().quarantineRetentionDays * 24 * 60 * 60 * 1000;
      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId,
        patch: {
          errorMessage:
            inspectionResult.details ?? 'Attachment quarantined during file inspection.',
          purgeEligibleAt: quarantineUntil,
          status: 'quarantined',
          updatedAt: Date.now(),
        },
      });
      await recordUserAuditEvent(ctx, {
        actorUserId: userId,
        emitter: 'chat.attachment',
        eventType: 'chat_attachment_quarantined',
        metadata: JSON.stringify({
          attachmentId,
          reason: inspectionResult.details ?? 'file_signature_mismatch',
        }),
        organizationId,
        outcome: 'failure',
        resourceId: attachmentId,
        resourceLabel: validatedAttachment.normalizedName,
        resourceType: 'chat_attachment',
        sessionId,
        severity: 'warning',
        sourceSurface: 'chat.attachment_inspection',
        userId,
      });
      throw new ConvexError(
        inspectionResult.details ?? 'Attachment quarantined during file inspection.',
      );
    }

    if (inspectionResult.status !== 'accepted') {
      const errorMessage =
        inspectionResult.details ?? 'Attachment rejected during file inspection.';
      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId,
        patch: {
          status: 'rejected',
          errorMessage,
          updatedAt: Date.now(),
        },
      });
      await recordUserAuditEvent(ctx, {
        actorUserId: userId,
        emitter: 'chat.attachment',
        eventType: 'chat_attachment_scan_failed',
        metadata: JSON.stringify({
          attachmentId,
          error: errorMessage,
          inspectionStatus: inspectionResult.status,
        }),
        organizationId,
        outcome: 'failure',
        resourceId: attachmentId,
        resourceLabel: validatedAttachment.normalizedName,
        resourceType: 'chat_attachment',
        sessionId,
        severity: 'warning',
        sourceSurface: 'chat.attachment_inspection',
        userId,
      });
      throw new ConvexError(errorMessage);
    }

    try {
      await recordUserAuditEvent(ctx, {
        actorUserId: userId,
        emitter: 'chat.attachment',
        eventType: 'chat_attachment_scan_passed',
        metadata: JSON.stringify({
          attachmentId,
          mimeType: validatedAttachment.mimeType,
          inspectionEngine: inspectionResult.engine,
        }),
        organizationId,
        outcome: 'success',
        resourceId: attachmentId,
        resourceLabel: validatedAttachment.normalizedName,
        resourceType: 'chat_attachment',
        sessionId,
        severity: 'info',
        sourceSurface: 'chat.attachment_inspection',
        userId,
      });

      await finalizeUploadWithMode(ctx, {
        backendMode,
        fileName: validatedAttachment.normalizedName,
        fileSize: validatedAttachment.sizeBytes,
        mimeType: validatedAttachment.mimeType,
        organizationId,
        sha256Hex: uploadTokenRecord.expectedSha256,
        sourceId: attachmentId,
        sourceType: 'chat_attachment',
        storageId: args.storageId,
      });

      await ctx.runAction(internal.agentChatActions.processPendingChatAttachmentInternal, {
        storageId: args.storageId,
      });

      const attachment = (await ctx.runQuery(internal.agentChat.getAttachmentByIdInternal, {
        attachmentId,
        organizationId,
      })) as ChatAttachmentDoc | null;

      if (!attachment) {
        throw new Error('Attachment was not found after processing.');
      }

      const resolvedUrl: { storageId: string; url: string | null } = await resolveFileUrlWithMode(
        ctx,
        {
          storageId: args.storageId,
        },
      );

      if (kind === 'image') {
        await recordUserAuditEvent(ctx, {
          actorUserId: userId,
          emitter: 'chat.attachment',
          eventType: 'attachment_access_url_issued',
          metadata: JSON.stringify({
            attachmentId,
            expiresInMinutes: getRetentionPolicyConfig().attachmentUrlTtlMinutes,
            purpose: 'image_preview',
          }),
          organizationId,
          outcome: 'success',
          resourceId: attachmentId,
          resourceLabel: validatedAttachment.normalizedName,
          resourceType: 'chat_attachment',
          sessionId,
          severity: 'info',
          sourceSurface: 'chat.attachment_preview',
          userId,
        });
      }

      return {
        ...attachment,
        previewUrl:
          attachment.kind === 'image' && attachment.status === 'ready' ? resolvedUrl.url : null,
      };
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }

      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId,
        patch: {
          status: 'rejected',
          errorMessage: error instanceof Error ? error.message : 'Failed to process attachment.',
          updatedAt: Date.now(),
        },
      });
      await recordUserAuditEvent(ctx, {
        actorUserId: userId,
        emitter: 'chat.attachment',
        eventType: 'chat_attachment_scan_failed',
        metadata: JSON.stringify({
          attachmentId,
          error: error instanceof Error ? error.message : 'Failed to process attachment.',
        }),
        organizationId,
        outcome: 'failure',
        resourceId: attachmentId,
        resourceLabel: validatedAttachment.normalizedName,
        resourceType: 'chat_attachment',
        sessionId,
        severity: 'warning',
        sourceSurface: 'chat.attachment_processing',
        userId,
      });

      throw error;
    }
  },
});

export const processPendingChatAttachmentInternal = internalAction({
  args: {
    storageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attachment = (await ctx.runQuery(internal.agentChat.getAttachmentByStorageIdInternal, {
      storageId: args.storageId,
    })) as ChatAttachmentDoc | null;
    if (!attachment || attachment.status !== 'pending_scan') {
      return null;
    }

    const lifecycle = (await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
      storageId: args.storageId,
    })) as Doc<'storageLifecycle'> | null;
    const readiness = getStorageReadiness(lifecycle);
    if (!lifecycle || !readiness.readable) {
      return null;
    }

    try {
      const blob = await loadAttachmentProcessingBlob(ctx, {
        attachment,
        lifecycle,
      });
      const stored = await storeFile(ctx, components.agent, blob, {
        filename: attachment.name,
      });
      let extractedTextStorageId: string | undefined;

      if (attachment.kind === 'document') {
        const extractedText = await extractDocumentText(blob, attachment.name, attachment.mimeType);
        const derivedTextFile = await storeDerivedFileWithMode(ctx, {
          blob: new Blob([extractedText], { type: 'text/plain' }),
          fileName: `${attachment.name}.extracted.txt`,
          mimeType: 'text/plain',
          organizationId: attachment.organizationId,
          parentStorageId: attachment.storageId,
          sourceId: attachment._id,
          sourceType: 'chat_attachment_extracted_text',
        });
        extractedTextStorageId = derivedTextFile.storageId;
      }

      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId: attachment._id,
        patch: {
          extractedTextStorageId: extractedTextStorageId ?? null,
          agentFileId: stored.file.fileId,
          errorMessage: null,
          promptSummary: buildAttachmentPromptSummary({
            kind: attachment.kind,
            name: attachment.name,
          }),
          status: 'ready',
          updatedAt: Date.now(),
        },
      });
    } catch (error) {
      await ctx.runMutation(internal.agentChat.updateAttachmentInternal, {
        attachmentId: attachment._id,
        patch: {
          errorMessage:
            error instanceof Error ? error.message : 'Failed to finalize attachment processing.',
          status: 'error',
          updatedAt: Date.now(),
        },
      });
    }

    return null;
  },
});

export const runChatGenerationInternal = internalAction({
  args: {
    runId: v.id('chatRuns'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
      runId: args.runId,
    })) as Doc<'chatRuns'> | null;

    if (!run || run.status !== 'streaming' || !run.promptMessageId) {
      return null;
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
          failureKind: 'unknown',
        },
      });
      return null;
    }

    try {
      const activeModels = (await ctx.runQuery(
        internal.chatModels.listActiveChatModelsInternal,
        {},
      )) as ChatModelCatalogEntry[];
      const selectedModel = getChatModelCatalogEntry(
        activeModels,
        run.model ?? DEFAULT_CHAT_MODEL_ID,
      );
      const requestConfig = buildChatRequestConfig({
        model: selectedModel,
        instructions: await resolveSystemPrompt(ctx, thread.organizationId, thread.personaId),
        useWebSearch: run.useWebSearch,
      });
      const threadTarget = {
        threadId: run.agentThreadId,
        userId: run.initiatedByUserId,
      };
      const streamOptions = {
        saveStreamDeltas: {
          chunking: 'word' as const,
          throttleMs: 250,
          returnImmediately: true as const,
        },
      };
      const streamArgs = {
        promptMessageId: run.promptMessageId,
        model: requestConfig.model,
        system: requestConfig.system,
        providerOptions: requestConfig.providerOptions,
        stopWhen: requestConfig.stopWhen as unknown,
      };
      const result = await (
        getBaseChatAgent().streamText as unknown as (
          ctx: ActionCtx,
          thread: typeof threadTarget,
          args: typeof streamArgs,
          options: typeof streamOptions,
        ) => Promise<StreamTextResult>
      )(ctx, threadTarget, streamArgs, streamOptions);

      if (result.order === undefined) {
        throw new Error('Streaming response did not return a message order.');
      }

      const [assistantMessage, streamId, currentRun] = await Promise.all([
        getAssistantMessageForOrder(ctx, run.agentThreadId, result.order),
        getStreamIdForOrder(ctx, run.agentThreadId, result.order),
        ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
          runId: args.runId,
        }) as Promise<Doc<'chatRuns'> | null>,
      ]);

      if (!currentRun) {
        return null;
      }

      if (currentRun.status !== 'streaming') {
        if (currentRun.status === 'aborted') {
          await reconcileAbortedRunArtifacts(ctx, {
            run: currentRun,
            assistantMessage,
            streamId,
          });
        } else if (streamId) {
          await ctx.runMutation(components.agent.streams.abort, {
            streamId,
            reason: currentRun.errorMessage ?? 'Run already finalized.',
          });
        }

        return;
      }

      await ctx.runMutation(internal.agentChat.patchRunInternal, {
        runId: args.runId,
        patch: {
          activeAssistantMessageId:
            assistantMessage?._id ?? currentRun.activeAssistantMessageId ?? null,
          agentStreamId: streamId ?? currentRun.agentStreamId ?? null,
        },
      });

      await result.consumeStream();
      await result.text;
      const allSources = dedupeSources(mapOpenRouterSources(await result.sources));

      const finalizedRun = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
        runId: args.runId,
      })) as Doc<'chatRuns'> | null;
      if (!finalizedRun || finalizedRun.status !== 'streaming') {
        return null;
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
          failureKind: null,
          ...(assistantMessage?._id ? { activeAssistantMessageId: assistantMessage._id } : {}),
        },
      });
      await recordSystemAuditEvent(ctx, {
        emitter: 'chat.run_worker',
        eventType: 'chat_run_completed',
        initiatedByUserId: run.initiatedByUserId,
        metadata: JSON.stringify({
          runId: args.runId,
          model: run.model ?? null,
          provider: run.provider ?? null,
          useWebSearch: run.useWebSearch,
        }),
        organizationId: run.organizationId,
        outcome: 'success',
        resourceId: args.runId,
        resourceLabel: run.model ?? 'chat run',
        resourceType: 'chat_run',
        severity: 'info',
        sourceSurface: 'chat.run_generation',
        userId: run.initiatedByUserId,
      });
      if (run.useWebSearch) {
        await recordSystemAuditEvent(ctx, {
          emitter: 'chat.run_worker',
          eventType: 'chat_web_search_used',
          initiatedByUserId: run.initiatedByUserId,
          metadata: JSON.stringify({
            runId: args.runId,
            model: run.model ?? null,
          }),
          organizationId: run.organizationId,
          outcome: 'success',
          resourceId: args.runId,
          resourceLabel: run.model ?? 'chat run',
          resourceType: 'chat_run',
          severity: 'info',
          sourceSurface: 'chat.web_search',
          userId: run.initiatedByUserId,
        });
      }
      await recordSystemAuditEvent(ctx, {
        emitter: 'chat.run_worker',
        eventType: 'outbound_vendor_access_used',
        initiatedByUserId: run.initiatedByUserId,
        metadata: JSON.stringify({
          runId: args.runId,
          useWebSearch: run.useWebSearch,
          vendor: 'openrouter',
        }),
        organizationId: run.organizationId,
        outcome: 'success',
        resourceId: 'openrouter',
        resourceLabel: 'OpenRouter',
        resourceType: 'vendor',
        severity: 'info',
        sourceSurface: 'chat.run_generation',
        userId: run.initiatedByUserId,
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
        return null;
      }

      await abortRunWithReason(ctx, {
        run: latestRun,
        reason: error instanceof Error ? error.message : 'Streaming failed.',
        status: 'error',
        failureKind: classifyChatRunFailure(error),
      });
      await recordSystemAuditEvent(ctx, {
        emitter: 'chat.run_worker',
        eventType: 'chat_run_failed',
        initiatedByUserId: latestRun.initiatedByUserId,
        metadata: JSON.stringify({
          runId: args.runId,
          reason: error instanceof Error ? error.message : 'Streaming failed.',
          failureKind: classifyChatRunFailure(error),
          model: latestRun.model ?? null,
        }),
        organizationId: latestRun.organizationId,
        outcome: 'failure',
        resourceId: args.runId,
        resourceLabel: latestRun.model ?? 'chat run',
        resourceType: 'chat_run',
        severity: 'warning',
        sourceSurface: 'chat.run_generation',
        userId: latestRun.initiatedByUserId,
      });
      if (error instanceof Error && error.name === 'VendorBoundaryError') {
        await recordSystemAuditEvent(ctx, {
          emitter: 'chat.run_worker',
          eventType: 'outbound_vendor_access_denied',
          initiatedByUserId: latestRun.initiatedByUserId,
          metadata: JSON.stringify({
            reason: error.message,
            runId: args.runId,
            vendor: 'openrouter',
          }),
          organizationId: latestRun.organizationId,
          outcome: 'failure',
          resourceId: 'openrouter',
          resourceLabel: 'OpenRouter',
          resourceType: 'vendor',
          severity: 'warning',
          sourceSurface: 'chat.run_generation',
          userId: latestRun.initiatedByUserId,
        });
      }
    }

    return null;
  },
});

export const stopRun = action({
  args: {
    threadId: v.optional(v.id('chatThreads')),
    runId: v.optional(v.id('chatRuns')),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const viewer = await getAuthenticatedContext(ctx);
    let run: Doc<'chatRuns'> | null = null;
    let thread: ChatThreadDoc | null = null;

    if (args.threadId) {
      thread = (await ctx.runQuery(internal.agentChat.getThreadForOrganizationInternal, {
        threadId: args.threadId,
        organizationId: viewer.organizationId,
      })) as ChatThreadDoc | null;
      if (!thread) {
        return true;
      }

      run = (await ctx.runQuery(internal.agentChat.getLatestActiveRunForThreadInternal, {
        threadId: thread._id,
      })) as Doc<'chatRuns'> | null;
    } else if (args.runId) {
      run = (await ctx.runQuery(internal.agentChat.getRunByIdInternal, {
        runId: args.runId,
        organizationId: viewer.organizationId,
      })) as Doc<'chatRuns'> | null;
      if (run) {
        thread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
          threadId: run.threadId,
        })) as ChatThreadDoc | null;
      }
    }

    if (!run) {
      return true;
    }
    if (!thread || thread.organizationId !== viewer.organizationId) {
      return true;
    }
    if (!viewer.isSiteAdmin && run.initiatedByUserId !== viewer.userId) {
      throw new ConvexError('You do not have permission to stop this run.');
    }

    return await abortRunWithReason(ctx, {
      run,
      reason: 'Stopped by user.',
      status: 'aborted',
    });
  },
});
