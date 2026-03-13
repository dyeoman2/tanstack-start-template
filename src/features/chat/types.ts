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
  attachmentId: Id<'aiAttachments'>;
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
  | ChatImagePart
  | ChatDocumentPart
  | ChatAttachmentPart
  | ChatSourceUrlPart
  | ChatSourceDocumentPart;

export type ChatComposerPart = ChatTextPart | ChatImagePart | ChatDocumentPart;

export type ChatMessageStatus = 'pending' | 'complete' | 'error';

export type ChatRole = 'assistant' | 'user';

export type ChatThread = {
  _id: Id<'aiThreads'>;
  title: string;
  pinned: boolean;
  personaId?: Id<'aiPersonas'>;
  model?: string;
  titleManuallyEdited: boolean;
  contextSummary?: string;
  contextSummaryThroughMessageId?: Id<'aiMessages'>;
  contextSummaryUpdatedAt?: number;
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

export type ChatMessage = {
  _id: Id<'aiMessages'>;
  threadId: Id<'aiThreads'>;
  role: ChatRole;
  parts: ChatMessagePart[];
  status: ChatMessageStatus;
  provider?: string;
  model?: string;
  usage?: {
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  clientMessageId?: string;
};

export type ChatMessageDraft = {
  _id: Id<'aiMessageDrafts'>;
  messageId: Id<'aiMessages'>;
  threadId: Id<'aiThreads'>;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatAttachment = {
  _id: Id<'aiAttachments'>;
  messageId?: Id<'aiMessages'>;
  threadId?: Id<'aiThreads'>;
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
