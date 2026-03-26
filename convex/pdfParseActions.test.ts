import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteStoredFileWithModeMock = vi.fn();
const recordSystemAuditEventMock = vi.fn();
const storeDerivedFileWithModeMock = vi.fn();
const validateDocumentParseResultMock = vi.fn();

vi.mock('./_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));

vi.mock('./_generated/api', () => ({
  components: {
    betterAuth: {},
  },
  internal: {
    organizationManagement: {
      getOrganizationPoliciesInternal:
        'internal.organizationManagement.getOrganizationPoliciesInternal',
    },
    pdfParse: {
      getPdfParseJobByStorageIdInternal: 'internal.pdfParse.getPdfParseJobByStorageIdInternal',
      upsertPdfParseJobInternal: 'internal.pdfParse.upsertPdfParseJobInternal',
    },
    storageLifecycle: {
      getByStorageIdInternal: 'internal.storageLifecycle.getByStorageIdInternal',
    },
  },
}));

vi.mock('./storagePlatform', () => ({
  deleteStoredFileWithMode: deleteStoredFileWithModeMock,
  loadStoredFileBlobWithMode: vi.fn(),
  storeDerivedFileWithMode: storeDerivedFileWithModeMock,
}));

vi.mock('./lib/storageS3', () => ({
  enqueueDocumentParseTask: vi.fn(),
}));

vi.mock('./storageReadiness', () => ({
  getStorageReadiness: vi.fn(),
}));

vi.mock('./lib/auditEmitters', () => ({
  recordSystemAuditEvent: recordSystemAuditEventMock,
  recordUserAuditEvent: vi.fn(),
}));

vi.mock('./documentParseResults', () => ({
  deleteStagedDocumentParseResult: vi.fn(),
  validateDocumentParseResult: validateDocumentParseResultMock,
}));

let applyPdfParseDocumentResultInternalHandler: (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

beforeAll(async () => {
  const module = await import('./pdfParseActions');
  applyPdfParseDocumentResultInternalHandler = (module.applyPdfParseDocumentResultInternal as any)
    .handler;
});

describe('retention metadata in pdf parse results', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00.000Z'));
    validateDocumentParseResultMock.mockResolvedValue({
      blob: new Blob(['{"pages":1,"images":[]}'], { type: 'application/json' }),
      imageCount: 0,
      pageCount: 1,
      parseKind: 'pdf_parse',
      parsed: {
        images: [],
        pages: 1,
      },
      resultKey: 'result-key',
    });
    storeDerivedFileWithModeMock.mockResolvedValue({
      storageId: 'parsed-result-1',
    });
    deleteStoredFileWithModeMock.mockResolvedValue(undefined);
    recordSystemAuditEventMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('assigns purgeEligibleAt when a parsed result file is stored', async () => {
    const runQuery = vi.fn(async (ref: string, args?: Record<string, unknown>) => {
      switch (ref) {
        case 'internal.pdfParse.getPdfParseJobByStorageIdInternal':
          expect(args).toEqual({
            storageId: 'source-storage-1',
          });
          return {
            _id: 'pdf-job-1',
            completedAt: null,
            dispatchAttempts: 1,
            dispatchErrorMessage: null,
            errorMessage: null,
            organizationId: 'org-1',
            parserVersion: null,
            processingStartedAt: 1_710_000_000_000,
            purgeEligibleAt: null,
            requestedByUserId: 'user-1',
            resultStorageId: null,
            status: 'processing',
            storageId: 'source-storage-1',
            updatedAt: 1_710_000_000_000,
          };
        case 'internal.organizationManagement.getOrganizationPoliciesInternal':
          return {
            dataRetentionDays: 45,
          };
        case 'internal.storageLifecycle.getByStorageIdInternal':
          return {
            organizationId: 'org-1',
            originalFileName: 'lab-report.pdf',
          };
        default:
          throw new Error(`Unexpected runQuery ref: ${ref}`);
      }
    });
    const runMutation = vi.fn(async (ref: string, args: Record<string, unknown>) => {
      if (ref !== 'internal.pdfParse.upsertPdfParseJobInternal') {
        throw new Error(`Unexpected runMutation ref: ${ref}`);
      }
      expect(args).toMatchObject({
        organizationId: 'org-1',
        purgeEligibleAt: Date.now() + 45 * 24 * 60 * 60 * 1000,
        requestedByUserId: 'user-1',
        resultStorageId: 'parsed-result-1',
        status: 'ready',
        storageId: 'source-storage-1',
      });
      return 'pdf-job-1';
    });

    await applyPdfParseDocumentResultInternalHandler(
      {
        runMutation,
        runQuery,
      } as never,
      {
        imageCount: 0,
        pageCount: 1,
        parserVersion: 'parser-v1',
        resultChecksumSha256: 'sha256',
        resultContentType: 'application/json',
        resultKey: 'result-key',
        resultSizeBytes: 24,
        status: 'SUCCEEDED',
        storageId: 'source-storage-1',
      },
    );

    expect(storeDerivedFileWithModeMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        parentStorageId: 'source-storage-1',
        sourceId: 'source-storage-1',
        sourceType: 'pdf_parse_result',
      }),
    );
  });
});
