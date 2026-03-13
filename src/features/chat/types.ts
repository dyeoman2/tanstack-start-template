import type { Id } from '@convex/_generated/dataModel';

export type ParsedPdfImage = {
  pageNumber: number;
  name: string;
  width: number;
  height: number;
  dataUrl: string;
};

export type ChatAttachmentKind = 'image' | 'document';
export type ChatAttachmentStatus = 'pending' | 'ready' | 'error';

export type ChatTextPart = {
  type: 'text';
  text: string;
};

export type ChatFilePart = {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
};

export type ChatImagePart = {
  type: 'image';
  image: string;
  mimeType?: string;
  name?: string;
};

export type ChatDocumentPart = {
  type: 'document';
  name: string;
  content: string;
  mimeType: string;
  images?: ParsedPdfImage[];
};

export type ChatAttachmentPart = {
  type: 'attachment';
  attachmentId: Id<'chatAttachments'>;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  status: ChatAttachmentStatus;
  previewUrl?: string | null;
  promptSummary: string;
  errorMessage?: string;
};

export type ChatSourceUrlPart = {
  type: 'source-url';
  sourceId: string;
  url: string;
  title?: string;
};

export type ChatSourceDocumentPart = {
  type: 'source-document';
  sourceId: string;
  mediaType: string;
  title: string;
  filename?: string;
};

export type ChatMessagePart =
  | ChatTextPart
  | ChatFilePart
  | ChatImagePart
  | ChatDocumentPart
  | ChatAttachmentPart
  | ChatSourceUrlPart
  | ChatSourceDocumentPart;

export type ChatComposerPart = ChatTextPart | ChatImagePart | ChatDocumentPart;

export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type ChatRole = 'assistant' | 'user';

export type ChatThread = {
  _id: Id<'chatThreads'>;
  agentThreadId: string;
  title: string;
  pinned: boolean;
  personaId?: Id<'aiPersonas'>;
  model?: string;
  titleManuallyEdited: boolean;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
};

export type ChatPersona = {
  _id: Id<'aiPersonas'>;
  name: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatUsage = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type ChatMessage = {
  _id: string;
  threadId: string;
  order: number;
  stepOrder: number;
  role: ChatRole;
  parts: ChatMessagePart[];
  status: ChatMessageStatus;
  provider?: string;
  model?: string;
  usage?: ChatUsage;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  clientMessageId?: string;
  metadata?: unknown;
};

export type ChatStreamRequest =
  | {
      mode?: 'send';
      threadId?: string;
      personaId?: string;
      model?: string;
      useWebSearch?: boolean;
      text: string;
      attachmentIds: Id<'chatAttachments'>[];
      clientMessageId?: string;
    }
  | {
      mode: 'edit';
      messageId: string;
      text: string;
      model?: string;
      useWebSearch?: boolean;
    }
  | {
      mode: 'retry';
      runId: string;
      model?: string;
      useWebSearch?: boolean;
    };

export type ChatActiveStreamStatus = 'streaming' | 'complete' | 'aborted' | 'error';

export type ChatActiveStream = {
  threadId: string;
  runId: string;
  assistantMessageId: string;
  streamId?: string;
  ownerSessionId: string;
  text: string;
  status: ChatActiveStreamStatus;
  errorMessage?: string;
  startedAt: number;
  request: ChatStreamRequest;
};

export type ChatAttachment = {
  _id: Id<'chatAttachments'>;
  threadId?: Id<'chatThreads'>;
  agentMessageId?: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  promptSummary: string;
  status: ChatAttachmentStatus;
  previewUrl?: string | null;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};
