import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_ATTACHMENT_SIZE_BYTES,
  validateChatAttachmentUpload,
} from './chatAttachments';

describe('validateChatAttachmentUpload', () => {
  it('accepts supported image uploads', () => {
    expect(
      validateChatAttachmentUpload({
        blobSize: 1024,
        blobType: 'image/png',
        fileName: 'diagram.png',
        claimedMimeType: 'image/png',
      }),
    ).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      normalizedName: 'diagram.png',
      sizeBytes: 1024,
    });
  });

  it('accepts supported document uploads via extension fallback', () => {
    expect(
      validateChatAttachmentUpload({
        blobSize: 2048,
        blobType: 'application/octet-stream',
        fileName: 'notes.pdf',
        claimedMimeType: '',
      }),
    ).toEqual({
      kind: 'document',
      mimeType: 'application/pdf',
      normalizedName: 'notes.pdf',
      sizeBytes: 2048,
    });
  });

  it('rejects oversized uploads', () => {
    expect(() =>
      validateChatAttachmentUpload({
        blobSize: MAX_CHAT_ATTACHMENT_SIZE_BYTES + 1,
        blobType: 'application/pdf',
        fileName: 'oversized.pdf',
        claimedMimeType: 'application/pdf',
      }),
    ).toThrow('Attachment exceeds the 10MB server-side limit.');
  });

  it('rejects unsupported file types', () => {
    expect(() =>
      validateChatAttachmentUpload({
        blobSize: 1024,
        blobType: 'application/x-msdownload',
        fileName: 'payload.exe',
        claimedMimeType: 'application/x-msdownload',
      }),
    ).toThrow('Unsupported attachment type.');
  });
});
