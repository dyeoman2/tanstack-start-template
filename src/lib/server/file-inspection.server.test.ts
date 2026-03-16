import { describe, expect, it } from 'vitest';
import { inspectFile } from './file-inspection.server';

function makeBlob(bytes: number[], type: string) {
  return new Blob([Uint8Array.from(bytes)], { type });
}

describe('inspectFile', () => {
  it('accepts valid PDFs for PDF-only workflows', async () => {
    const result = await inspectFile({
      allowedKinds: ['pdf'],
      blob: makeBlob([0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf'),
      fileName: 'report.pdf',
      maxBytes: 1024,
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('accepted');
    expect(result.engine).toBe('builtin-file-inspection');
  });

  it('quarantines files whose signature does not match the declared type', async () => {
    const result = await inspectFile({
      allowedKinds: ['pdf'],
      blob: makeBlob([0x47, 0x49, 0x46, 0x38], 'application/pdf'),
      fileName: 'not-a-pdf.pdf',
      maxBytes: 1024,
      mimeType: 'application/pdf',
    });

    expect(result.status).toBe('quarantined');
    expect(result.reason).toBe('file_signature_mismatch');
  });

  it('rejects unsupported file kinds for the workflow', async () => {
    const result = await inspectFile({
      allowedKinds: ['pdf'],
      blob: makeBlob([0x74, 0x65, 0x78, 0x74], 'text/plain'),
      fileName: 'notes.txt',
      maxBytes: 1024,
      mimeType: 'text/plain',
    });

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('unsupported_type');
  });

  it('rejects files larger than the configured limit', async () => {
    const result = await inspectFile({
      allowedKinds: ['document'],
      blob: makeBlob(new Array(32).fill(0x61), 'text/plain'),
      fileName: 'large.txt',
      maxBytes: 16,
      mimeType: 'text/plain',
    });

    expect(result.status).toBe('rejected');
    expect(result.reason).toBe('size_limit_exceeded');
  });
});
