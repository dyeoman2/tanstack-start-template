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

function makeOoxmlPackage(entries: string[]) {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...makeBytes(entries.join('\n'))]);
}

function makeOleCompoundDocument(extra = '') {
  return new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...makeBytes(extra)]);
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

  it('rejects xlsx documents as unsupported', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeOoxmlPackage(['[Content_Types].xml', 'xl/workbook.xml']),
      fileName: 'report.xlsx',
      maxBytes: 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(result.status).toBe('PASSED');
  });

  it('rejects macro-enabled OOXML documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeOoxmlPackage(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']),
      fileName: 'report.docm',
      maxBytes: 1024,
      mimeType: 'application/vnd.ms-word.document.macroEnabled.12',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('office_macro_enabled');
  });

  it('rejects password-protected OOXML documents', async () => {
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document'],
      bytes: makeOoxmlPackage(['[Content_Types].xml', 'word/document.xml', 'EncryptionInfo']),
      fileName: 'report.docx',
      maxBytes: 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('office_password_protected');
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
  it('keeps the default regulated upload boundary narrow', () => {
    expect(
      resolveStorageInspectionPolicy({
        defaultMaxBytes: 10 * 1024 * 1024,
        sourceType: 'chat_attachment',
      }),
    ).toEqual({
      allowedKinds: ['document', 'image', 'pdf'],
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
      allowedKinds: ['document', 'image', 'pdf'],
      maxBytes: 25 * 1024 * 1024,
    });
  });
});
