import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, parsePdfBlobMock, sendMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  parsePdfBlobMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: function GetObjectCommand(input: unknown) {
    return { commandName: 'GetObjectCommand', input };
  },
  PutObjectCommand: function PutObjectCommand(input: unknown) {
    return { commandName: 'PutObjectCommand', input };
  },
  S3Client: class S3Client {
    send = sendMock;
  },
}));

vi.mock('../lib/server/storage-service-env', () => ({
  getDocumentParserWorkerRuntimeConfig: vi.fn(() => ({
    awsRegion: 'us-west-1',
    callbackBaseUrl: 'https://example.test',
    callbackSecret: 'callback-secret',
    documentParseJsonResultMaxBytes: 2048,
    documentParseTextResultMaxBytes: 1024,
    stagingPrefix: 'quarantine/parser-results/',
    storageBuckets: {
      clean: { bucket: 'clean-bucket', kmsKeyArn: 'clean-kms' },
      mirror: { bucket: 'mirror-bucket', kmsKeyArn: 'mirror-kms' },
      quarantine: { bucket: 'quarantine-bucket', kmsKeyArn: 'quarantine-kms' },
      rejected: { bucket: 'rejected-bucket', kmsKeyArn: 'rejected-kms' },
    },
  })),
}));

vi.mock('../lib/server/pdf-parse.server', () => ({
  parsePdfBlob: parsePdfBlobMock,
}));

vi.mock('../lib/server/storage-webhook-signature', () => ({
  createStorageWebhookSignature: vi.fn(async () => 'signed'),
}));

import { handler } from '../../infra/aws-cdk/runtime/document-parse-worker';

describe('document parse worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as Response);
    parsePdfBlobMock.mockResolvedValue({
      content: 'parsed text',
      images: [],
      pages: 2,
    });
    sendMock.mockImplementation(
      async (command: { commandName: string; input: Record<string, unknown> }) => {
        if (command.commandName === 'GetObjectCommand') {
          return {
            Body: new Blob(['pdf-binary'], { type: 'application/pdf' }),
          };
        }
        return {};
      },
    );
  });

  it('writes staged PDF results into quarantine with deterministic metadata', async () => {
    await handler({
      Records: [
        {
          body: JSON.stringify({
            canonicalKey: 'clean/org/org_123/chat_attachment/file-1',
            fileName: 'report.pdf',
            kind: 'document_parse',
            mimeType: 'application/pdf',
            parseKind: 'pdf_parse',
            storageId: 'file-1',
            sourceType: 'pdf_parse_result',
          }),
        },
      ],
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: 'PutObjectCommand',
        input: expect.objectContaining({
          Bucket: 'quarantine-bucket',
          ContentType: 'application/json',
          Key: 'quarantine/parser-results/pdf_parse/file-1.json',
          SSEKMSKeyId: 'quarantine-kms',
        }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/document-result',
      expect.objectContaining({
        body: expect.stringContaining(
          '"resultKey":"quarantine/parser-results/pdf_parse/file-1.json"',
        ),
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/document-result',
      expect.objectContaining({
        body: expect.stringContaining('"resultChecksumSha256":"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/document-result',
      expect.objectContaining({
        body: expect.stringContaining('"resultSizeBytes":'),
      }),
    );
  });

  it('fails closed for unsupported chat document types', async () => {
    sendMock.mockImplementationOnce(async () => ({
      Body: new Blob(['office-binary'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    }));

    await handler({
      Records: [
        {
          body: JSON.stringify({
            canonicalKey: 'clean/org/org_123/chat_attachment/file-2',
            fileName: 'report.docx',
            kind: 'document_parse',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            parseKind: 'chat_document_extract',
            storageId: 'file-2',
            sourceType: 'chat_attachment',
          }),
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/document-result',
      expect.objectContaining({
        body: expect.stringContaining('"status":"FAILED"'),
        method: 'POST',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/document-result',
      expect.objectContaining({
        body: expect.stringContaining('Unsupported document type for chat extraction.'),
      }),
    );
  });
});
