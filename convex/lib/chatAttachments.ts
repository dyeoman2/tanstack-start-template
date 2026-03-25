import type { ParseResult } from 'papaparse';

const CANVAS_MODULE_NAME = '@napi-rs/canvas';
const PDF_PARSE_MODULE_NAME = 'pdf-parse';
const DOCUMENT_PROMPT_SUMMARY_CHARS = 600;
const DOCUMENT_PROMPT_TEXT_LIMIT = 6_000;
export const MAX_CHAT_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

const IMAGE_EXTENSION_TO_MIME = new Map<string, string>([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const DOCUMENT_EXTENSION_TO_MIME = new Map<string, string>([
  ['.csv', 'text/csv'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
]);

const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream']);

export type SupportedChatAttachmentKind = 'image' | 'document';

export type ValidatedChatAttachment = {
  kind: SupportedChatAttachmentKind;
  mimeType: string;
  normalizedName: string;
  sizeBytes: number;
};

function getLowercaseExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const extensionIndex = normalized.lastIndexOf('.');
  return extensionIndex === -1 ? '' : normalized.slice(extensionIndex);
}

function inferMimeTypeFromExtension(fileName: string) {
  const extension = getLowercaseExtension(fileName);
  return (
    IMAGE_EXTENSION_TO_MIME.get(extension) ?? DOCUMENT_EXTENSION_TO_MIME.get(extension) ?? null
  );
}

function isSupportedImageMimeType(mimeType: string) {
  return Array.from(IMAGE_EXTENSION_TO_MIME.values()).includes(mimeType);
}

function isSupportedDocumentMimeType(mimeType: string) {
  return Array.from(DOCUMENT_EXTENSION_TO_MIME.values()).includes(mimeType);
}

export function validateChatAttachmentUpload(args: {
  blobSize: number;
  blobType: string;
  fileName: string;
  claimedMimeType?: string;
}) {
  const normalizedName = args.fileName.trim();
  if (!normalizedName) {
    throw new Error('Attachment name is required.');
  }

  const sizeBytes = args.blobSize;
  if (sizeBytes <= 0) {
    throw new Error('Attachment is empty.');
  }

  if (sizeBytes > MAX_CHAT_ATTACHMENT_SIZE_BYTES) {
    throw new Error('Attachment exceeds the 10MB server-side limit.');
  }

  const blobType = args.blobType.trim().toLowerCase();
  const claimedMimeType = args.claimedMimeType?.trim().toLowerCase() ?? '';
  const inferredMimeType = inferMimeTypeFromExtension(normalizedName);
  const actualMimeType = !GENERIC_MIME_TYPES.has(blobType) ? blobType : '';
  const providedMimeType = !GENERIC_MIME_TYPES.has(claimedMimeType) ? claimedMimeType : '';
  const resolvedMimeType = actualMimeType || providedMimeType || inferredMimeType;

  if (!resolvedMimeType) {
    throw new Error('Unsupported attachment type.');
  }

  if (isSupportedImageMimeType(resolvedMimeType)) {
    return {
      kind: 'image' as const,
      mimeType: resolvedMimeType,
      normalizedName,
      sizeBytes,
    } satisfies ValidatedChatAttachment;
  }

  if (isSupportedDocumentMimeType(resolvedMimeType)) {
    return {
      kind: 'document' as const,
      mimeType: resolvedMimeType,
      normalizedName,
      sizeBytes,
    } satisfies ValidatedChatAttachment;
  }

  throw new Error('Unsupported attachment type.');
}

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

function looksLikeCsv(mimeType: string, fileName: string) {
  return mimeType === 'text/csv' || fileName.endsWith('.csv');
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
