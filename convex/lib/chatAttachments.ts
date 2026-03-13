import type { ParseResult } from 'papaparse';
import type { Row } from 'read-excel-file/universal';

const CANVAS_MODULE_NAME = '@napi-rs/canvas';
const PDF_PARSE_MODULE_NAME = 'pdf-parse';
const DOCUMENT_PROMPT_SUMMARY_CHARS = 600;
const DOCUMENT_PROMPT_TEXT_LIMIT = 6_000;

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

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

async function ensurePdfParserConfigured() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    const { DOMMatrix, DOMPoint, DOMRect } = await import(CANVAS_MODULE_NAME);
    const globalWithDom = globalThis as Record<string, unknown>;

    globalWithDom.DOMMatrix = DOMMatrix;
    globalWithDom.DOMPoint = DOMPoint;
    globalWithDom.DOMRect = DOMRect;
  }

  const { PDFParse } = await import(PDF_PARSE_MODULE_NAME);
  return PDFParse;
}

async function parsePdf(blob: Blob, fileName: string) {
  const PDFParse = await ensurePdfParserConfigured();
  const buffer = Buffer.from(await blob.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  await parser.destroy();

  return `[PDF File: ${fileName}]\n\nPages: ${textResult.total}\n\n${textResult.text}`;
}

async function parseCsv(blob: Blob, fileName: string) {
  const Papa = await import('papaparse');
  const csvText = await blob.text();

  return await new Promise<string>((resolve, reject) => {
    Papa.parse<unknown[]>(csvText, {
      worker: false,
      complete: (results: ParseResult<unknown[]>) => {
        let content = `[CSV File: ${fileName}]\n\n`;
        if (results.data && results.data.length > 0) {
          content += formatRowsAsTable(results.data as unknown[][]);
        }

        resolve(content);
      },
      error: (error: Error) => reject(error),
    });
  });
}

async function parseExcel(blob: Blob, fileName: string) {
  const [{ default: readXlsxFile, readSheetNames }] = await Promise.all([
    import('read-excel-file/universal'),
  ]);
  const sheetNames = await readSheetNames(blob);

  let content = `[Excel File: ${fileName}]\n\n`;

  for (const [index, sheetName] of sheetNames.entries()) {
    const rows = await readXlsxFile(blob, { sheet: sheetName });
    const normalizedRows = rows.map((row: Row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) {
          return '';
        }

        if (cell instanceof Date) {
          return cell.toISOString();
        }

        return String(cell);
      }),
    );

    content += `Sheet: ${sheetName}\n`;
    content += `${'-'.repeat(50)}\n`;
    content += formatRowsAsTable(normalizedRows);

    if (index < sheetNames.length - 1) {
      content += '\n';
    }
  }

  return content;
}

function looksLikeCsv(mimeType: string, fileName: string) {
  return mimeType === 'text/csv' || fileName.endsWith('.csv');
}

function looksLikeExcel(mimeType: string, fileName: string) {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    fileName.endsWith('.xlsx')
  );
}

function looksLikePdf(mimeType: string, fileName: string) {
  return mimeType === 'application/pdf' || fileName.endsWith('.pdf');
}

export async function extractDocumentText(blob: Blob, fileName: string, mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase();
  const normalizedFileName = fileName.toLowerCase();

  if (looksLikePdf(normalizedMimeType, normalizedFileName)) {
    return await parsePdf(blob, fileName);
  }

  if (looksLikeCsv(normalizedMimeType, normalizedFileName)) {
    return await parseCsv(blob, fileName);
  }

  if (looksLikeExcel(normalizedMimeType, normalizedFileName)) {
    return await parseExcel(blob, fileName);
  }

  return await blob.text();
}

export async function blobToDataUrl(blob: Blob, fallbackMimeType: string) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const mimeType = blob.type || fallbackMimeType || 'application/octet-stream';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const encoded = match[2] || '';
  const buffer = Buffer.from(encoded, 'base64');
  return new Blob([buffer], { type: mimeType });
}

export function buildAttachmentPromptSummary(args: {
  kind: 'image' | 'document';
  name: string;
  text?: string;
}) {
  if (args.kind === 'image') {
    return `Image attachment: ${args.name}`;
  }

  const normalizedText = normalizeWhitespace(args.text ?? '');
  if (!normalizedText) {
    return `Document attachment: ${args.name}`;
  }

  const snippet = normalizedText.slice(0, DOCUMENT_PROMPT_SUMMARY_CHARS);
  return `[Document: ${args.name}]\n\n${snippet}`;
}

export function clipDocumentPromptText(text: string, remainingBudget = DOCUMENT_PROMPT_TEXT_LIMIT) {
  return normalizeWhitespace(text).slice(0, Math.max(0, remainingBudget));
}
