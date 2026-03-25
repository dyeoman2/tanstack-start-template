import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFile } from '~/features/chat/lib/file-parser';

describe('file parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses csv files into the existing text format', async () => {
    const file = new File(['name,count\nAlice,3\n'], 'report.csv', {
      type: 'text/csv',
    });

    await expect(parseFile(file)).resolves.toEqual({
      name: 'report.csv',
      mimeType: 'text/csv',
      content: `[CSV File: report.csv]

name | count
--------------------------------------------------
Alice | 3

`,
    });
  });

  it('rejects xlsx files as unsupported', async () => {
    const file = new File(['spreadsheet'], 'rows.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseFile(file)).rejects.toThrow(
      'Unsupported file type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});
