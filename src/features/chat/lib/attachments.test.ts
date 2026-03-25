import { describe, expect, it } from 'vitest';
import { isDocumentFile } from '~/features/chat/lib/attachments';

describe('chat attachments', () => {
  it('accepts text documents', () => {
    const file = new File(['content'], 'notes.txt', {
      type: 'text/plain',
    });

    expect(isDocumentFile(file)).toBe(true);
  });

  it('rejects xlsx spreadsheets', () => {
    const file = new File(['content'], 'report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(isDocumentFile(file)).toBe(false);
  });
});
