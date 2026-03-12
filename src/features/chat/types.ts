import type { Id } from '@convex/_generated/dataModel';

export type ParsedPdfImage = {
  pageNumber: number;
  name: string;
  width: number;
  height: number;
  dataUrl: string;
};

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
  | ChatSourceUrlPart
  | ChatSourceDocumentPart;

export type ChatMessageStatus = 'pending' | 'complete' | 'error';

export type ChatRole = 'assistant' | 'user';

export type ChatThread = {
  _id: Id<'aiThreads'>;
  title: string;
  pinned: boolean;
  personaId?: Id<'aiPersonas'>;
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

export type ComposerPayload = {
  text: string;
  parts: ChatMessagePart[];
};
