import type { ChatMessage, ChatMessagePart, ChatUsage } from '~/features/chat/types';

type AgentUIPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'file';
      mediaType: string;
      filename?: string;
      url: string;
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

function isSourceUrlPart(
  part: AgentUIPart,
): part is Extract<AgentUIPart, { type: 'source-url' }> {
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
  const inputTokens = typeof value.promptTokens === 'number'
    ? value.promptTokens
    : typeof value.inputTokens === 'number'
      ? value.inputTokens
      : undefined;
  const outputTokens = typeof value.completionTokens === 'number'
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
    const errorMessage = typeof metadata?.error === 'string'
      ? metadata.error
      : typeof metadata?.errorMessage === 'string'
        ? metadata.errorMessage
        : undefined;
    const clientMessageId = typeof metadata?.clientMessageId === 'string'
      ? metadata.clientMessageId
      : undefined;

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
        metadata: message.metadata,
      },
    ];
  });
}
