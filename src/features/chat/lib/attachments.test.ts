import { describe, expect, it } from 'vitest';
import { isDocumentFile } from '~/features/chat/lib/attachments';

describe('chat attachments', () => {
  it('accepts modern Excel spreadsheets', () => {
    const file = new File(['content'], 'report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(isDocumentFile(file)).toBe(true);
  });

  it('rejects legacy Excel spreadsheets', () => {
    const file = new File(['content'], 'report.xls', {
      type: 'application/vnd.ms-excel',
    });

    expect(isDocumentFile(file)).toBe(false);
  });
});
