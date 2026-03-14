import { beforeEach, describe, expect, it, vi } from 'vitest';

const readSheetNamesMock = vi.fn();
const readXlsxFileMock = vi.fn();

vi.mock('read-excel-file/browser', () => ({
  default: readXlsxFileMock,
  readSheetNames: readSheetNamesMock,
}));

import { parseFile } from '~/features/chat/lib/file-parser';

describe('file parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses xlsx files into the existing text format', async () => {
    readSheetNamesMock.mockResolvedValue(['Summary', 'Totals']);
    readXlsxFileMock.mockImplementation(async (_file: File, options?: { sheet?: string }) => {
      if (options?.sheet === 'Summary') {
        return [
          ['Name', 'Active', 'Created'],
          ['Alice', true, new Date('2026-03-13T00:00:00.000Z')],
        ];
      }

      return [
        ['Metric', 'Value'],
        ['Count', 3],
      ];
    });

    const file = new File(['spreadsheet'], 'report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseFile(file)).resolves.toEqual({
      name: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: `[Excel File: report.xlsx]

Sheet: Summary
--------------------------------------------------
Name | Active | Created
--------------------------------------------------
Alice | true | 2026-03-13T00:00:00.000Z

Sheet: Totals
--------------------------------------------------
Metric | Value
--------------------------------------------------
Count | 3
`,
    });
  });

  it('rejects spreadsheets larger than 10MB', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseFile(file)).rejects.toThrow(
      'File size (10.00MB) exceeds the maximum allowed size of 10MB',
    );
    expect(readSheetNamesMock).not.toHaveBeenCalled();
  });

  it('rejects spreadsheets with too many sheets', async () => {
    readSheetNamesMock.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => `Sheet ${index}`),
    );

    const file = new File(['spreadsheet'], 'wide.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseFile(file)).rejects.toThrow(
      'Spreadsheet has too many sheets. Maximum allowed is 10.',
    );
    expect(readXlsxFileMock).not.toHaveBeenCalled();
  });

  it('rejects spreadsheets with too many rows across sheets', async () => {
    readSheetNamesMock.mockResolvedValue(['Summary']);
    readXlsxFileMock.mockResolvedValue(Array.from({ length: 5_001 }, () => ['cell']));

    const file = new File(['spreadsheet'], 'rows.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(parseFile(file)).rejects.toThrow(
      'Spreadsheet has too many rows. Maximum allowed is 5000.',
    );
  });
});
