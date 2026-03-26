import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  inspectStorageUploadBytes,
  resolveStorageInspectionPolicy,
} from './storage-inspection-policy';

function makeBytes(content: string) {
  return new TextEncoder().encode(content);
}

function makePdf(extra = '') {
  return makeBytes(`%PDF-1.7
1 0 obj
<< /Type /Catalog >>
endobj
${extra}
startxref
0
%%EOF`);
}

function makeOleCompoundDocument(extra = '') {
  return new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...makeBytes(extra)]);
}

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
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]));
}

function makeDocxPackage(
  extraEntries: Array<{
    compress?: boolean;
    content: string | Uint8Array;
    name: string;
  }> = [],
) {
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
      content: `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
  </w:body>
</w:document>`,
      name: 'word/document.xml',
    },
    ...extraEntries,
  ]);
}

describe('inspectStorageUploadBytes', () => {
  it('passes a benign PDF', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['pdf'],
      bytes: makePdf(),
      fileName: 'report.pdf',
      maxBytes: 1024,
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('PASSED');
  });

  it('rejects mismatched file signatures', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['pdf'],
      bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]),
      fileName: 'report.pdf',
      maxBytes: 1024,
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('file_signature_mismatch');
  });

  it('rejects oversized files', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeBytes('hello world'),
      fileName: 'notes.txt',
      maxBytes: 4,
      mimeType: 'text/plain',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('size_limit_exceeded');
  });

  it('rejects unsupported file types', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['pdf'],
      bytes: makeBytes('hello'),
      fileName: 'notes.exe',
      maxBytes: 1024,
      mimeType: 'application/octet-stream',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('unsupported_type');
  });

  it('passes csv documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeBytes('name,count\nalpha,2\n'),
      fileName: 'report.csv',
      maxBytes: 1024,
      mimeType: 'text/csv',
    });

    expect(result.status).toBe('PASSED');
  });

  it('passes plain text documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeBytes('hello world'),
      fileName: 'notes.txt',
      maxBytes: 1024,
      mimeType: 'text/plain',
    });

    expect(result.status).toBe('PASSED');
  });

  it('passes png images', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['image'],
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]),
      fileName: 'scan.png',
      maxBytes: 1024,
      mimeType: 'image/png',
    });

    expect(result.status).toBe('PASSED');
  });

  it('passes structurally valid OOXML documents when the profile allows them', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage(),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('PASSED');
  });

  it('rejects macro-enabled OOXML documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage([
        {
          content: 'macro-bytes',
          name: 'word/vbaProject.bin',
        },
      ]),
      fileName: 'report.docm',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.ms-word.document.macroEnabled.12',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('office_macro_enabled');
  });

  it('rejects OOXML documents with external relationships', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage([
        {
          content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/payload" TargetMode="External"/>
</Relationships>`,
          name: 'word/_rels/document.xml.rels',
        },
      ]),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('ooxml_external_relationship');
  });

  it('rejects OOXML documents with embedded content', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage([
        {
          content: 'embedded-binary',
          name: 'word/embeddings/oleObject1.bin',
        },
      ]),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('ooxml_embedded_content');
  });

  it('rejects malformed OOXML documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeZip([
        {
          content: '<xml/>',
          name: '[Content_Types].xml',
        },
        {
          content: '<w:document/>',
          name: 'word/document.xml',
        },
      ]),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('ooxml_malformed');
  });

  it('rejects suspicious OOXML archive structures', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage([
        {
          compress: true,
          content: 'A'.repeat(300_000),
          name: 'word/huge.xml',
        },
      ]),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('archive_suspicious_structure');
  });

  it('rejects encrypted OOXML package markers', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['ooxml'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage([
        {
          content: 'encrypted-stream',
          name: 'EncryptionInfo',
        },
      ]),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('archive_encrypted');
  });

  it('rejects OOXML documents when the profile keeps document formats narrow', async () => {
    const result = await inspectStorageUploadBytes({
      allowedDocumentFormats: ['csv', 'plain_text'],
      allowedKinds: ['document'],
      bytes: makeDocxPackage(),
      fileName: 'report.docx',
      maxBytes: 1024 * 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('unsupported_type');
  });

  it('rejects legacy OLE Office documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeOleCompoundDocument('WordDocument'),
      fileName: 'report.doc',
      maxBytes: 1024,
      mimeType: 'application/msword',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('unsupported_type');
  });

  it('rejects macro-enabled OLE Office documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeOleCompoundDocument('Macros VBA _VBA_PROJECT'),
      fileName: 'report.xls',
      maxBytes: 1024,
      mimeType: 'application/vnd.ms-excel',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('office_macro_enabled');
  });

  it('rejects password-protected OLE Office documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeOleCompoundDocument('EncryptedPackage EncryptionInfo'),
      fileName: 'report.doc',
      maxBytes: 1024,
      mimeType: 'application/msword',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('office_password_protected');
  });

  it.each([
    ['pdf_encrypted', '/Encrypt'],
    ['pdf_embedded_files', '/EmbeddedFile'],
    ['pdf_javascript', '/JavaScript'],
    ['pdf_launch_action', '/Launch'],
    ['pdf_open_action', '/OpenAction'],
    ['pdf_xfa', '/XFA'],
    ['pdf_rich_media', '/RichMedia'],
  ] as const)('rejects %s markers', async (expectedReason, token) => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['pdf'],
      bytes: makePdf(token),
      fileName: 'report.pdf',
      maxBytes: 1024,
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe(expectedReason);
  });

  it('rejects malformed PDFs', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['pdf'],
      bytes: makeBytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'),
      fileName: 'report.pdf',
      maxBytes: 1024,
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('pdf_malformed');
  });

  it('rejects checksum mismatches when a checksum is supplied', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeBytes('hello world'),
      fileName: 'notes.txt',
      maxBytes: 1024,
      mimeType: 'text/plain',
      sha256Hex: '0'.repeat(64),
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('checksum_mismatch');
  });
});

describe('resolveStorageInspectionPolicy', () => {
  it('keeps the default upload boundary narrow', () => {
    expect(
      resolveStorageInspectionPolicy({
        defaultMaxBytes: 10 * 1024 * 1024,
        sourceType: 'chat_attachment',
      }),
    ).toEqual({
      allowedDocumentFormats: ['csv', 'plain_text'],
      allowedKinds: ['document', 'image', 'pdf'],
      intakeProfile: 'standard',
      maxBytes: 10 * 1024 * 1024,
    });
  });

  it('uses the evidence upload size limit for security control evidence', () => {
    expect(
      resolveStorageInspectionPolicy({
        defaultMaxBytes: 10 * 1024 * 1024,
        sourceType: 'security_control_evidence',
      }),
    ).toEqual({
      allowedDocumentFormats: ['csv', 'plain_text'],
      allowedKinds: ['document', 'image', 'pdf'],
      intakeProfile: 'standard',
      maxBytes: 25 * 1024 * 1024,
    });
  });

  it('prepares a separate regulated document profile without widening existing flows', () => {
    expect(
      resolveStorageInspectionPolicy({
        defaultMaxBytes: 10 * 1024 * 1024,
        sourceType: 'regulated_document_intake',
      }),
    ).toEqual({
      allowedDocumentFormats: ['csv', 'ooxml', 'plain_text'],
      allowedKinds: ['document', 'image', 'pdf'],
      intakeProfile: 'regulated_document',
      maxBytes: 10 * 1024 * 1024,
    });
  });
});
