import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getQuarantineObjectMock } = vi.hoisted(() => ({
  getQuarantineObjectMock: vi.fn(),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: vi.fn(() => ({
    documentParseJsonResultMaxBytes: 2048,
    documentParseTextResultMaxBytes: 1024,
    parserResultStagingPrefix: 'quarantine/parser-results/',
  })),
}));

vi.mock('./lib/storageS3', () => ({
  deleteStorageObject: vi.fn(async () => undefined),
  getQuarantineObject: getQuarantineObjectMock,
}));

import { validateDocumentParseResult } from './documentParseResults';

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('validateDocumentParseResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts valid staged chat text results from quarantine', async () => {
    const body = 'parsed document text';
    getQuarantineObjectMock.mockResolvedValue({
      Body: new Blob([body], { type: 'text/plain' }),
      ContentType: 'text/plain',
    });

    await expect(
      validateDocumentParseResult({
        parseKind: 'chat_document_extract',
        resultChecksumSha256: sha256Hex(body),
        resultContentType: 'text/plain',
        resultKey: 'quarantine/parser-results/chat_document_extract/file-1.txt',
        resultSizeBytes: Buffer.byteLength(body),
        storageId: 'file-1',
      }),
    ).resolves.toMatchObject({
      parseKind: 'chat_document_extract',
      resultKey: 'quarantine/parser-results/chat_document_extract/file-1.txt',
      text: body,
    });
  });

  it('rejects staged results that do not use the deterministic key', async () => {
    await expect(
      validateDocumentParseResult({
        parseKind: 'chat_document_extract',
        resultChecksumSha256: sha256Hex('text'),
        resultContentType: 'text/plain',
        resultKey: 'quarantine/parser-results/chat_document_extract/other-file.txt',
        resultSizeBytes: 4,
        storageId: 'file-1',
      }),
    ).rejects.toThrow('expected staging key');

    expect(getQuarantineObjectMock).not.toHaveBeenCalled();
  });

  it('rejects malformed PDF JSON even when the checksum matches', async () => {
    const malformedBody = JSON.stringify({
      content: 'hello',
      images: [{ dataUrl: 'data:', height: 10, pageNumber: 1, width: 10 }],
      pages: 1,
    });
    getQuarantineObjectMock.mockResolvedValue({
      Body: new Blob([malformedBody], { type: 'application/json' }),
      ContentType: 'application/json',
    });

    await expect(
      validateDocumentParseResult({
        imageCount: 1,
        pageCount: 1,
        parseKind: 'pdf_parse',
        resultChecksumSha256: sha256Hex(malformedBody),
        resultContentType: 'application/json',
        resultKey: 'quarantine/parser-results/pdf_parse/file-1.json',
        resultSizeBytes: Buffer.byteLength(malformedBody),
        storageId: 'file-1',
      }),
    ).rejects.toThrow('unexpected fields');
  });
});
