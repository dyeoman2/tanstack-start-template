'use node';

import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import {
  buildDocumentParseResultStagingKey,
  getDocumentParseResultContentType,
  type DocumentParseKind,
} from '../src/lib/shared/storage-service-contract';
import { deleteStorageObject, getQuarantineObject } from './lib/storageS3';

type ParsedPdfImage = {
  dataUrl: string;
  height: number;
  name: string;
  pageNumber: number;
  width: number;
};

type ParsedPdfResult = {
  content: string;
  images: ParsedPdfImage[];
  pages: number;
};

export type ValidatedDocumentParseResult =
  | {
      blob: Blob;
      parseKind: 'chat_document_extract';
      resultKey: string;
      text: string;
    }
  | {
      blob: Blob;
      parseKind: 'pdf_parse';
      parsed: ParsedPdfResult;
      resultKey: string;
    };

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput.buffer);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

function normalizeContentType(value: string | undefined) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function assertFiniteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function assertString(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expectedKeys: string[], label: string) {
  const actualKeys = Object.keys(record).sort();
  const normalizedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== normalizedExpected.length ||
    actualKeys.some((key, index) => key !== normalizedExpected[index])
  ) {
    throw new Error(`${label} contains unexpected fields.`);
  }
}

function decodeUtf8(bytes: Uint8Array, label: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8 text.`);
  }
}

function parseValidatedPdfResult(text: string): ParsedPdfResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('PDF parse result is not valid JSON.');
  }

  const record = assertRecord(parsed, 'PDF parse result');
  assertExactKeys(record, ['content', 'images', 'pages'], 'PDF parse result');

  const content = assertString(record.content, 'PDF parse result content');
  const pages = assertFiniteNumber(record.pages, 'PDF parse result pages');
  if (!Number.isInteger(pages) || pages < 0) {
    throw new Error('PDF parse result pages must be a non-negative integer.');
  }

  if (!Array.isArray(record.images)) {
    throw new Error('PDF parse result images must be an array.');
  }

  const images = record.images.map((image, index) => {
    const entry = assertRecord(image, `PDF parse result image ${index}`);
    assertExactKeys(
      entry,
      ['dataUrl', 'height', 'name', 'pageNumber', 'width'],
      `PDF parse result image ${index}`,
    );
    const dataUrl = assertString(entry.dataUrl, `PDF parse result image ${index} dataUrl`);
    const height = assertFiniteNumber(entry.height, `PDF parse result image ${index} height`);
    const name = assertString(entry.name, `PDF parse result image ${index} name`);
    const pageNumber = assertFiniteNumber(
      entry.pageNumber,
      `PDF parse result image ${index} pageNumber`,
    );
    const width = assertFiniteNumber(entry.width, `PDF parse result image ${index} width`);

    if (!Number.isInteger(height) || height < 0) {
      throw new Error(`PDF parse result image ${index} height must be a non-negative integer.`);
    }
    if (!Number.isInteger(pageNumber) || pageNumber < 0) {
      throw new Error(`PDF parse result image ${index} pageNumber must be a non-negative integer.`);
    }
    if (!Number.isInteger(width) || width < 0) {
      throw new Error(`PDF parse result image ${index} width must be a non-negative integer.`);
    }

    return {
      dataUrl,
      height,
      name,
      pageNumber,
      width,
    };
  });

  return {
    content,
    images,
    pages,
  };
}

function getDocumentParseResultMaxBytes(parseKind: DocumentParseKind) {
  const runtimeConfig = getStorageRuntimeConfig();
  return parseKind === 'pdf_parse'
    ? runtimeConfig.documentParseJsonResultMaxBytes
    : runtimeConfig.documentParseTextResultMaxBytes;
}

function getExpectedDocumentParseResultKey(parseKind: DocumentParseKind, storageId: string) {
  return buildDocumentParseResultStagingKey(
    getStorageRuntimeConfig().parserResultStagingPrefix,
    parseKind,
    storageId,
  );
}

export async function deleteStagedDocumentParseResult(args: {
  parseKind: DocumentParseKind;
  storageId: string;
}) {
  await deleteStorageObject({
    bucketKind: 'quarantine',
    key: getExpectedDocumentParseResultKey(args.parseKind, args.storageId),
  }).catch(() => undefined);
}

export async function validateDocumentParseResult(args: {
  imageCount?: number;
  pageCount?: number;
  parseKind: DocumentParseKind;
  resultChecksumSha256: string;
  resultContentType: string;
  resultKey: string;
  resultSizeBytes: number;
  storageId: string;
}): Promise<ValidatedDocumentParseResult> {
  const expectedKey = getExpectedDocumentParseResultKey(args.parseKind, args.storageId);
  if (args.resultKey !== expectedKey) {
    throw new Error('Document parse result key did not match the expected staging key.');
  }

  const expectedContentType = getDocumentParseResultContentType(args.parseKind);
  if (normalizeContentType(args.resultContentType) !== expectedContentType) {
    throw new Error('Document parse result content type did not match the expected parse kind.');
  }

  const maxBytes = getDocumentParseResultMaxBytes(args.parseKind);
  if (args.resultSizeBytes > maxBytes) {
    throw new Error('Document parse result exceeded the maximum allowed size.');
  }

  const stagedObject = await getQuarantineObject({ key: expectedKey });
  if (normalizeContentType(stagedObject.ContentType) !== expectedContentType) {
    throw new Error('Document parse staged object content type did not match the expected type.');
  }

  const bytes = new Uint8Array(await stagedObject.Body.arrayBuffer());
  if (bytes.byteLength !== args.resultSizeBytes) {
    throw new Error('Document parse result size did not match the callback metadata.');
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error('Document parse staged object exceeded the maximum allowed size.');
  }
  if ((await sha256Hex(bytes)) !== args.resultChecksumSha256) {
    throw new Error('Document parse result checksum did not match the callback metadata.');
  }

  const blob = new Blob([bytes], { type: expectedContentType });
  if (args.parseKind === 'chat_document_extract') {
    const text = decodeUtf8(bytes, 'Document parse text result');
    return {
      blob,
      parseKind: args.parseKind,
      resultKey: expectedKey,
      text,
    };
  }

  const text = decodeUtf8(bytes, 'PDF parse result');
  const parsed = parseValidatedPdfResult(text);
  if (args.pageCount !== undefined && parsed.pages !== args.pageCount) {
    throw new Error('PDF parse result page count did not match the callback metadata.');
  }
  if (args.imageCount !== undefined && parsed.images.length !== args.imageCount) {
    throw new Error('PDF parse result image count did not match the callback metadata.');
  }

  return {
    blob,
    parseKind: args.parseKind,
    parsed,
    resultKey: expectedKey,
  };
}
