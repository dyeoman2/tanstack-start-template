import type { ParseResult } from 'papaparse';
import type { ParsedPdfImage } from '~/features/chat/types';

const MAX_PDF_SIZE = 10 * 1024 * 1024;

function formatRowsAsTable(rows: unknown[][], addSeparatorAfterHeader = true) {
  let content = '';

  rows.forEach((row, index) => {
    if (!Array.isArray(row)) {
      return;
    }

    content += `${row.join(' | ')}\n`;
    if (addSeparatorAfterHeader && index === 0) {
      content += `${'-'.repeat(50)}\n`;
    }
  });

  return content;
}

export interface ParsedFile {
  name: string;
  content: string;
  mimeType: string;
  images?: ParsedPdfImage[];
}

export async function parsePDF(file: File): Promise<ParsedFile> {
  if (file.size > MAX_PDF_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(`File size (${sizeMB}MB) exceeds the maximum allowed size of 10MB`);
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/parse-pdf', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: string };
    throw new Error(error.error || 'Failed to parse PDF');
  }

  const data = (await response.json()) as {
    content: string;
    pages: number;
    images?: ParsedPdfImage[];
  };

  let content = `[PDF File: ${file.name}]\n\nPages: ${data.pages}\n\n`;

  if (data.images?.length) {
    content += `Images found: ${data.images.length}\n\n`;
  }

  content += data.content;

  return {
    name: file.name,
    content,
    mimeType: file.type,
    images: data.images || [],
  };
}

export async function parseTXT(file: File): Promise<ParsedFile> {
  return {
    name: file.name,
    content: await file.text(),
    mimeType: file.type,
  };
}

export async function parseCSV(file: File): Promise<ParsedFile> {
  const Papa = await import('papaparse');
  const csvText = await file.text();

  return await new Promise((resolve, reject) => {
    Papa.parse<unknown[]>(csvText, {
      worker: false,
      complete: (results: ParseResult<unknown[]>) => {
        let content = `[CSV File: ${file.name}]\n\n`;
        if (results.data && results.data.length > 0) {
          content += formatRowsAsTable(results.data as unknown[][]);
        }

        resolve({
          name: file.name,
          content,
          mimeType: file.type,
        });
      },
      error: (error: Error) => reject(error),
    });
  });
}

export async function parseExcel(file: File): Promise<ParsedFile> {
  const [arrayBuffer, XLSX] = await Promise.all([file.arrayBuffer(), import('xlsx')]);
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  let content = `[Excel File: ${file.name}]\n\n`;

  workbook.SheetNames.forEach((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

    content += `Sheet: ${sheetName}\n`;
    content += `${'-'.repeat(50)}\n`;
    content += formatRowsAsTable(jsonData);

    if (index < workbook.SheetNames.length - 1) {
      content += '\n';
    }
  });

  return {
    name: file.name,
    content,
    mimeType: file.type,
  };
}

type FileParser = (file: File) => Promise<ParsedFile>;

const fileTypeParsers: Array<{ test: (type: string, name: string) => boolean; parse: FileParser }> =
  [
    {
      test: (type, name) => type === 'text/plain' || name.endsWith('.txt'),
      parse: parseTXT,
    },
    {
      test: (type, name) => type === 'text/csv' || name.endsWith('.csv'),
      parse: parseCSV,
    },
    {
      test: (type, name) =>
        type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        type === 'application/vnd.ms-excel' ||
        name.endsWith('.xlsx') ||
        name.endsWith('.xls'),
      parse: parseExcel,
    },
    {
      test: (type, name) => type === 'application/pdf' || name.endsWith('.pdf'),
      parse: parsePDF,
    },
  ];

export async function parseFile(file: File) {
  const fileType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  const parser = fileTypeParsers.find(({ test }) => test(fileType, fileName));
  if (!parser) {
    throw new Error(`Unsupported file type: ${fileType || fileName}`);
  }

  return await parser.parse(file);
}
