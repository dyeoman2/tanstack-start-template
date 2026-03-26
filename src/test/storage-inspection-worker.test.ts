import { deflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, sendMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: function GetObjectCommand(input: unknown) {
    return { commandName: 'GetObjectCommand', input };
  },
  S3Client: class S3Client {
    send = sendMock;
  },
}));

vi.mock('../lib/server/storage-service-env', () => ({
  getStorageInspectionWorkerRuntimeConfig: vi.fn(() => ({
    awsRegion: 'us-west-1',
    callbackBaseUrl: 'https://example.test',
    callbackSecret: 'callback-secret',
    defaultMaxBytes: 10 * 1024 * 1024,
  })),
}));

vi.mock('../lib/server/storage-webhook-signature', () => ({
  createStorageWebhookSignature: vi.fn(async () => 'signed'),
}));

import { handler } from '../../infra/aws-cdk/runtime/storage-inspection-worker';

function crc32(bytes: Uint8Array) {
  let value = -1;

  for (const byte of bytes) {
    value ^= byte;
    for (let index = 0; index < 8; index += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }

  return (value ^ -1) >>> 0;
}

function makeZip(
  entries: Array<{
    compress?: boolean;
    content: string | Uint8Array;
    name: string;
  }>,
) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name);
    const contentBuffer =
      typeof entry.content === 'string' ? Buffer.from(entry.content) : Buffer.from(entry.content);
    const compressedBuffer = entry.compress ? deflateRawSync(contentBuffer) : contentBuffer;
    const compressionMethod = entry.compress ? 8 : 0;
    const crc = crc32(contentBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBuffer, compressedBuffer);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + compressedBuffer.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);

  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]));
}

function makeDocxPackage(withExternalRelationship: boolean) {
  return makeZip([
    {
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
      name: '[Content_Types].xml',
    },
    {
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
      name: '_rels/.rels',
    },
    {
      content:
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      name: 'word/document.xml',
    },
    ...(withExternalRelationship
      ? [
          {
            content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/payload" TargetMode="External"/>
</Relationships>`,
            name: 'word/_rels/document.xml.rels',
          },
        ]
      : []),
  ]);
}

describe('storage inspection worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as typeof fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '',
    } as Response);
  });

  it('keeps chat attachment office uploads blocked by the narrow profile', async () => {
    sendMock.mockResolvedValueOnce({
      Body: new Blob([makeDocxPackage(false)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    });

    await handler({
      Records: [
        {
          body: JSON.stringify({
            bucket: 'quarantine-bucket',
            fileName: 'report.docx',
            key: 'quarantine/org/org_123/chat_attachment/file-1',
            kind: 'storage_inspection',
            maxBytes: 1024 * 1024,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sourceType: 'chat_attachment',
            storageId: 'file-1',
          }),
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/inspection-result',
      expect.objectContaining({
        body: expect.stringContaining('"reason":"unsupported_type"'),
        method: 'POST',
      }),
    );
  });

  it('returns structural OOXML reasons for the regulated intake profile', async () => {
    sendMock.mockResolvedValueOnce({
      Body: new Blob([makeDocxPackage(true)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    });

    await handler({
      Records: [
        {
          body: JSON.stringify({
            bucket: 'quarantine-bucket',
            fileName: 'report.docx',
            key: 'quarantine/org/org_123/regulated_document_intake/file-2',
            kind: 'storage_inspection',
            maxBytes: 1024 * 1024,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sourceType: 'regulated_document_intake',
            storageId: 'file-2',
          }),
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/internal/storage/inspection-result',
      expect.objectContaining({
        body: expect.stringContaining('"reason":"ooxml_external_relationship"'),
        method: 'POST',
      }),
    );
  });
});
