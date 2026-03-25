import type { Id } from '@convex/_generated/dataModel';

export type ParsedPdfImage = {
  pageNumber: number;
  name: string;
  width: number;
  height: number;
  dataUrl: string;
};

export type ChatAttachmentKind = 'image' | 'document';
export type ChatAttachmentStatus =
  | 'pending'
  | 'pending_scan'
  | 'processing'
  | 'quarantined'
  | 'ready'
  | 'error'
  | 'rejected';

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
export type ChatRunFailureKind =
  | 'provider_policy'
  | 'provider_unavailable'
  | 'tool_error'
  | 'unknown';

export type ChatThread = {
  _id: Id<'chatThreads'>;
  agentThreadId: string;
  title: string;
  pinned: boolean;
  personaId?: Id<'aiPersonas'>;
  model?: string;
  titleManuallyEdited: boolean;
  deletedAt?: number;
  deletedByUserId?: string;
  purgeEligibleAt?: number;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  canManage: boolean;
};

export type ChatPersona = {
  _id: Id<'aiPersonas'>;
  name: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  canManage: boolean;
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
  authorUserId?: string;
  authorName?: string;
  canEdit?: boolean;
  metadata?: unknown;
};

export type ChatAttachment = {
  _id: Id<'chatAttachments'>;
  threadId?: Id<'chatThreads'>;
  agentMessageId?: string;
  storageId: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  promptSummary: string;
  status: ChatAttachmentStatus;
  previewUrl?: string | null;
  errorMessage?: string;
  deletedAt?: number;
  deletedByUserId?: string;
  purgeEligibleAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type ChatLatestRunState = {
  runId: Id<'chatRuns'>;
  status: 'idle' | 'streaming' | 'complete' | 'aborted' | 'error';
  canStop: boolean;
  errorMessage?: string;
  failureKind?: ChatRunFailureKind;
  endedAt?: number;
  promptMessageId?: string;
};
