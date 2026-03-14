import type { ChatMessage, ChatMessagePart, ChatUsage } from '~/features/chat/types';

type AgentUIPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'attachment';
      attachmentId: string;
      kind: 'image' | 'document';
      name: string;
      mimeType: string;
      status: 'pending' | 'ready' | 'error';
      previewUrl?: string | null;
      promptSummary: string;
      errorMessage?: string;
    }
  | {
      type: 'document';
      name: string;
      content: string;
      mimeType: string;
      images?: unknown[];
    }
  | {
      type: 'file';
      mediaType: string;
      filename?: string;
      url: string;
    }
  | {
      type: 'image';
      image: string;
      mimeType?: string;
      name?: string;
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
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type AgentUIMessageLike = {
  id: string;
  _creationTime: number;
  order: number;
  stepOrder: number;
  role: string;
  status: string;
  parts: AgentUIPart[];
  text?: string;
  metadata?: unknown;
};

function isTextPart(part: AgentUIPart): part is Extract<AgentUIPart, { type: 'text' }> {
  return part.type === 'text' && typeof part.text === 'string';
}

function isFilePart(part: AgentUIPart): part is Extract<AgentUIPart, { type: 'file' }> {
  return (
    part.type === 'file' &&
    typeof part.mediaType === 'string' &&
    typeof part.url === 'string' &&
    (part.filename === undefined || typeof part.filename === 'string')
  );
}

function isAttachmentPart(part: AgentUIPart): part is Extract<AgentUIPart, { type: 'attachment' }> {
  return (
    part.type === 'attachment' &&
    typeof part.attachmentId === 'string' &&
    (part.kind === 'image' || part.kind === 'document') &&
    typeof part.name === 'string' &&
    typeof part.mimeType === 'string' &&
    (part.status === 'pending' || part.status === 'ready' || part.status === 'error') &&
    typeof part.promptSummary === 'string'
  );
}

function isDocumentPart(part: AgentUIPart): part is Extract<AgentUIPart, { type: 'document' }> {
  return (
    part.type === 'document' &&
    typeof part.name === 'string' &&
    typeof part.content === 'string' &&
    typeof part.mimeType === 'string'
  );
}

function isImagePart(part: AgentUIPart): part is Extract<AgentUIPart, { type: 'image' }> {
  return (
    part.type === 'image' &&
    typeof part.image === 'string' &&
    (part.mimeType === undefined || typeof part.mimeType === 'string') &&
    (part.name === undefined || typeof part.name === 'string')
  );
}

function isSourceUrlPart(part: AgentUIPart): part is Extract<AgentUIPart, { type: 'source-url' }> {
  return (
    part.type === 'source-url' &&
    typeof part.sourceId === 'string' &&
    typeof part.url === 'string' &&
    (part.title === undefined || typeof part.title === 'string')
  );
}

function isSourceDocumentPart(
  part: AgentUIPart,
): part is Extract<AgentUIPart, { type: 'source-document' }> {
  return (
    part.type === 'source-document' &&
    typeof part.sourceId === 'string' &&
    typeof part.mediaType === 'string' &&
    typeof part.title === 'string' &&
    (part.filename === undefined || typeof part.filename === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toChatParts(parts: AgentUIPart[], fallbackText?: string): ChatMessagePart[] {
  const mapped = parts.flatMap((part): ChatMessagePart[] => {
    if (isTextPart(part)) {
      return [{ type: 'text', text: part.text }];
    }

    if (isFilePart(part)) {
      return [
        {
          type: 'file',
          mediaType: part.mediaType,
          filename: part.filename,
          url: part.url,
        },
      ];
    }

    if (isAttachmentPart(part)) {
      return [
        {
          type: 'attachment',
          attachmentId: part.attachmentId as never,
          kind: part.kind,
          name: part.name,
          mimeType: part.mimeType,
          status: part.status,
          previewUrl: part.previewUrl,
          promptSummary: part.promptSummary,
          errorMessage: part.errorMessage,
        },
      ];
    }

    if (isDocumentPart(part)) {
      return [
        {
          type: 'document',
          name: part.name,
          content: part.content,
          mimeType: part.mimeType,
          images: Array.isArray(part.images) ? (part.images as never) : undefined,
        },
      ];
    }

    if (isImagePart(part)) {
      return [
        {
          type: 'image',
          image: part.image,
          mimeType: part.mimeType,
          name: part.name,
        },
      ];
    }

    if (isSourceUrlPart(part)) {
      return [
        {
          type: 'source-url',
          sourceId: part.sourceId,
          url: part.url,
          title: part.title,
        },
      ];
    }

    if (isSourceDocumentPart(part)) {
      return [
        {
          type: 'source-document',
          sourceId: part.sourceId,
          mediaType: part.mediaType,
          title: part.title,
          filename: part.filename,
        },
      ];
    }

    return [];
  });

  if (mapped.length > 0 || !fallbackText) {
    return mapped;
  }

  return [{ type: 'text', text: fallbackText }];
}

function toChatStatus(status: string): ChatMessage['status'] {
  switch (status) {
    case 'streaming':
      return 'streaming';
    case 'failed':
      return 'error';
    case 'pending':
      return 'pending';
    default:
      return 'complete';
  }
}

function toUsage(value: unknown): ChatUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const totalTokens = typeof value.totalTokens === 'number' ? value.totalTokens : undefined;
  const inputTokens =
    typeof value.promptTokens === 'number'
      ? value.promptTokens
      : typeof value.inputTokens === 'number'
        ? value.inputTokens
        : undefined;
  const outputTokens =
    typeof value.completionTokens === 'number'
      ? value.completionTokens
      : typeof value.outputTokens === 'number'
        ? value.outputTokens
        : undefined;

  if (totalTokens === undefined && inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  return {
    totalTokens,
    inputTokens,
    outputTokens,
  };
}

function getMetadataField(metadata: unknown, key: string) {
  if (!isRecord(metadata)) {
    return undefined;
  }

  return metadata[key];
}

export function mapAgentMessagesToChatMessages(
  threadId: string,
  messages: AgentUIMessageLike[],
): ChatMessage[] {
  return messages.flatMap((message): ChatMessage[] => {
    if (message.role !== 'assistant' && message.role !== 'user') {
      return [];
    }

    const metadata = isRecord(message.metadata) ? message.metadata : undefined;
    const model = typeof metadata?.model === 'string' ? metadata.model : undefined;
    const provider = typeof metadata?.provider === 'string' ? metadata.provider : undefined;
    const errorMessage =
      typeof metadata?.error === 'string'
        ? metadata.error
        : typeof metadata?.errorMessage === 'string'
          ? metadata.errorMessage
          : undefined;
    const clientMessageId =
      typeof metadata?.clientMessageId === 'string' ? metadata.clientMessageId : undefined;
    const authorUserId =
      typeof metadata?.authorUserId === 'string' ? metadata.authorUserId : undefined;
    const authorName = typeof metadata?.authorName === 'string' ? metadata.authorName : undefined;
    const canEdit = typeof metadata?.canEdit === 'boolean' ? metadata.canEdit : undefined;

    return [
      {
        _id: message.id,
        threadId,
        order: message.order,
        stepOrder: message.stepOrder,
        role: message.role,
        parts: toChatParts(message.parts, message.text),
        status: toChatStatus(message.status),
        provider,
        model,
        usage: toUsage(getMetadataField(message.metadata, 'usage')),
        errorMessage,
        createdAt: message._creationTime,
        updatedAt: message._creationTime,
        clientMessageId,
        authorUserId,
        authorName,
        canEdit,
        metadata: message.metadata,
      },
    ];
  });
}
