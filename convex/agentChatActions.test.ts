import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const buildAttachmentPromptSummaryMock = vi.fn();
const deleteStoredFileWithModeMock = vi.fn();
const enforceChatAttachmentProcessingRateLimitOrThrowMock = vi.fn();
const finalizeUploadWithModeMock = vi.fn();
const getFileStorageBackendModeMock = vi.fn();
const inspectFileMock = vi.fn();
const recordUserAuditEventMock = vi.fn();
const resolveFileUrlWithModeMock = vi.fn();
const storeDerivedFileWithModeMock = vi.fn();
const validateChatAttachmentUploadMock = vi.fn();
const validateDocumentParseResultMock = vi.fn();

vi.mock('@convex-dev/agent', () => ({
  getFile: vi.fn(),
  serializeMessage: vi.fn(),
  storeFile: vi.fn(),
}));

vi.mock('./_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));

vi.mock('./_generated/api', () => ({
  components: {},
  internal: {
    agentChat: {
      consumeAttachmentUploadTokenInternal:
        'internal.agentChat.consumeAttachmentUploadTokenInternal',
      createAttachmentInternal: 'internal.agentChat.createAttachmentInternal',
      getAttachmentByIdInternal: 'internal.agentChat.getAttachmentByIdInternal',
      getAttachmentByStorageIdInternal: 'internal.agentChat.getAttachmentByStorageIdInternal',
      getCurrentChatContextInternal: 'internal.agentChat.getCurrentChatContextInternal',
      updateAttachmentInternal: 'internal.agentChat.updateAttachmentInternal',
    },
    agentChatActions: {
      processPendingChatAttachmentInternal:
        'internal.agentChatActions.processPendingChatAttachmentInternal',
    },
    organizationManagement: {
      getOrganizationPoliciesInternal:
        'internal.organizationManagement.getOrganizationPoliciesInternal',
    },
    securityOps: {
      recordDocumentScanEventInternal: 'internal.securityOps.recordDocumentScanEventInternal',
    },
  },
}));

vi.mock('../src/lib/server/env.server', () => ({
  getFileStorageBackendMode: getFileStorageBackendModeMock,
}));

vi.mock('../src/lib/server/file-inspection.server', () => ({
  inspectFile: inspectFileMock,
}));

vi.mock('../src/lib/server/security-config.server', () => ({
  getRetentionPolicyConfig: () => ({
    attachmentUrlTtlMinutes: 5,
    quarantineRetentionDays: 7,
  }),
}));

vi.mock('./lib/chatAgentRuntime', () => ({
  buildChatRequestConfig: vi.fn(),
  getBaseChatAgent: vi.fn(() => ({
    createThread: vi.fn(),
  })),
}));

vi.mock('./lib/chatAttachments', () => ({
  buildAttachmentPromptSummary: buildAttachmentPromptSummaryMock,
  clipDocumentPromptText: (value: string) => value,
  validateChatAttachmentUpload: validateChatAttachmentUploadMock,
}));

vi.mock('./lib/chatRateLimits', () => ({
  enforceChatAttachmentProcessingRateLimitOrThrow:
    enforceChatAttachmentProcessingRateLimitOrThrowMock,
}));

vi.mock('./lib/auditEmitters', () => ({
  recordSystemAuditEvent: vi.fn(),
  recordUserAuditEvent: recordUserAuditEventMock,
}));

vi.mock('./lib/storageS3', () => ({
  enqueueDocumentParseTask: vi.fn(),
  getCleanObject: vi.fn(),
}));

vi.mock('./storagePlatform', () => ({
  deleteStoredFileWithMode: deleteStoredFileWithModeMock,
  finalizeUploadWithMode: finalizeUploadWithModeMock,
  resolveFileUrlWithMode: resolveFileUrlWithModeMock,
  storeDerivedFileWithMode: storeDerivedFileWithModeMock,
}));

vi.mock('./storageReadiness', () => ({
  getStorageReadiness: vi.fn(),
}));

vi.mock('./documentParseResults', () => ({
  deleteStagedDocumentParseResult: vi.fn(),
  validateDocumentParseResult: validateDocumentParseResultMock,
}));

let applyChatDocumentParseResultInternalHandler: (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;
let createChatAttachmentFromUploadHandler: (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;
let isValidContinuationPromptMessage: typeof import('./agentChatActions').isValidContinuationPromptMessage;

beforeAll(async () => {
  const module = await import('./agentChatActions');
  applyChatDocumentParseResultInternalHandler = (module.applyChatDocumentParseResultInternal as any)
    .handler;
  createChatAttachmentFromUploadHandler = (module.createChatAttachmentFromUpload as any).handler;
  ({ isValidContinuationPromptMessage } = module);
});

describe('isValidContinuationPromptMessage', () => {
  it('accepts user prompts that belong to the expected thread', () => {
    expect(
      isValidContinuationPromptMessage(
        {
          _id: 'msg-1',
          threadId: 'thread-1',
          order: 1,
          stepOrder: 0,
          status: 'success',
          message: {
            role: 'user',
            content: 'Continue this response',
          },
        },
        'thread-1',
      ),
    ).toBe(true);
  });

  it('rejects prompts from a different thread', () => {
    expect(
      isValidContinuationPromptMessage(
        {
          _id: 'msg-1',
          threadId: 'thread-2',
          order: 1,
          stepOrder: 0,
          status: 'success',
          message: {
            role: 'user',
            content: 'Continue this response',
          },
        },
        'thread-1',
      ),
    ).toBe(false);
  });

  it('rejects non-user messages even if the thread matches', () => {
    expect(
      isValidContinuationPromptMessage(
        {
          _id: 'msg-1',
          threadId: 'thread-1',
          order: 1,
          stepOrder: 0,
          status: 'success',
          message: {
            role: 'assistant',
            content: 'Answer',
          },
        },
        'thread-1',
      ),
    ).toBe(false);
  });
});

describe('retention metadata in chat attachment flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));
    getFileStorageBackendModeMock.mockReturnValue('s3-primary');
    buildAttachmentPromptSummaryMock.mockReturnValue('Prompt summary');
    validateChatAttachmentUploadMock.mockReturnValue({
      kind: 'document',
      mimeType: 'application/pdf',
      normalizedName: 'lab-report.pdf',
      sizeBytes: 256,
    });
    finalizeUploadWithModeMock.mockResolvedValue(undefined);
    resolveFileUrlWithModeMock.mockResolvedValue({
      storageId: 'storage-1',
      url: null,
    });
    recordUserAuditEventMock.mockResolvedValue(undefined);
    enforceChatAttachmentProcessingRateLimitOrThrowMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assigns purgeEligibleAt to accepted uploaded attachments', async () => {
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.agentChat.consumeAttachmentUploadTokenInternal':
          return {
            expectedFileName: 'lab-report.pdf',
            expectedMimeType: 'application/pdf',
            expectedSha256: 'sha256',
            expectedSizeBytes: 256,
            storageId: 'storage-1',
          };
        case 'internal.agentChat.createAttachmentInternal':
          expect(args).toMatchObject({
            organizationId: 'org-1',
            status: 'pending_scan',
            storageId: 'storage-1',
            userId: 'user-1',
          });
          return 'attachment-1';
        case 'internal.securityOps.recordDocumentScanEventInternal':
          return null;
        case 'internal.agentChat.updateAttachmentInternal':
          expect(args).toMatchObject({
            attachmentId: 'attachment-1',
            patch: {
              purgeEligibleAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
              updatedAt: Date.now(),
            },
          });
          return null;
        default:
          throw new Error(`Unexpected runMutation ref: ${ref}`);
      }
    });
    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.agentChat.getCurrentChatContextInternal':
          expect(args).toEqual({});
          return {
            organizationId: 'org-1',
            sessionId: 'session-1',
            userId: 'user-1',
          };
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 30,
          };
        case 'internal.agentChat.getAttachmentByIdInternal':
          return {
            _id: 'attachment-1',
            kind: 'document',
            name: 'lab-report.pdf',
            organizationId: 'org-1',
            promptSummary: 'Prompt summary',
            status: 'ready',
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runAction = vi.fn(async () => null);

    await createChatAttachmentFromUploadHandler(
      {
        runAction,
        runMutation,
        runQuery,
        storage: {
          get: vi.fn(),
        },
      } as never,
      {
        storageId: 'storage-1',
        uploadToken: 'upload-token',
        name: 'lab-report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 256,
      },
    );

    expect(runMutation).toHaveBeenCalledWith('internal.agentChat.updateAttachmentInternal', {
      attachmentId: 'attachment-1',
      patch: {
        purgeEligibleAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now(),
      },
    });
  });

  it('inherits the earlier purge deadline when storing extracted text', async () => {
    validateDocumentParseResultMock.mockResolvedValue({
      blob: new Blob(['extracted text'], { type: 'text/plain' }),
      parseKind: 'chat_document_extract',
      resultKey: 'result-key',
      text: 'Extracted text',
    });
    storeDerivedFileWithModeMock.mockResolvedValue({
      storageId: 'derived-text-1',
    });
    deleteStoredFileWithModeMock.mockResolvedValue(undefined);

    const existingPurgeEligibleAt = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.agentChat.getAttachmentByStorageIdInternal':
          expect(args).toMatchObject({
            storageId: 'storage-1',
          });
          return {
            _id: 'attachment-1',
            extractedTextStorageId: null,
            kind: 'document',
            name: 'lab-report.pdf',
            organizationId: 'org-1',
            purgeEligibleAt: existingPurgeEligibleAt,
            storageId: 'storage-1',
          };
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 30,
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      if (ref !== 'internal.agentChat.updateAttachmentInternal') {
        throw new Error(`Unexpected runMutation ref: ${ref}`);
      }
      expect(args).toMatchObject({
        attachmentId: 'attachment-1',
        patch: expect.objectContaining({
          extractedTextStorageId: 'derived-text-1',
          purgeEligibleAt: existingPurgeEligibleAt,
          status: 'ready',
        }),
      });
      return null;
    });

    await applyChatDocumentParseResultInternalHandler(
      {
        runMutation,
        runQuery,
      } as never,
      {
        parserVersion: 'parser-v1',
        storageId: 'storage-1',
        resultKey: 'result-key',
        resultChecksumSha256: 'sha256',
        resultContentType: 'text/plain',
        resultSizeBytes: 12,
        status: 'SUCCEEDED',
      },
    );

    expect(storeDerivedFileWithModeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        parentStorageId: 'storage-1',
        sourceId: 'attachment-1',
        sourceType: 'chat_attachment_extracted_text',
      }),
    );
  });
});
