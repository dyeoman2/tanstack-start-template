export type AllowedFileKind = 'document' | 'image' | 'pdf';

export type StorageInspectionStatus = 'FAILED' | 'PASSED' | 'REJECTED';

export type StorageInspectionReason =
  | 'checksum_mismatch'
  | 'file_signature_mismatch'
  | 'inspection_error'
  | 'office_macro_enabled'
  | 'office_password_protected'
  | 'pdf_active_content'
  | 'pdf_embedded_files'
  | 'pdf_encrypted'
  | 'pdf_javascript'
  | 'pdf_launch_action'
  | 'pdf_malformed'
  | 'pdf_open_action'
  | 'pdf_rich_media'
  | 'pdf_xfa'
  | 'size_limit_exceeded'
  | 'unsupported_type';

export type StorageInspectionResult = {
  details?: string;
  engine: 's3-intake-policy';
  inspectedAt: number;
  reason?: StorageInspectionReason;
  status: StorageInspectionStatus;
};

export type StorageInspectionPolicy = {
  allowedKinds: AllowedFileKind[];
  maxBytes: number;
};

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

const MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const PDF_TOKEN_WINDOW_BYTES = 16 * 1024;
const TEXT_SIGNATURE_WINDOW_BYTES = 512;

const OOXML_MIME_TYPES = new Set([
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
]);

const OOXML_EXTENSIONS = new Set([
  '.docm',
  '.docx',
  '.dotm',
  '.dotx',
  '.potm',
  '.potx',
  '.ppsm',
  '.ppsx',
  '.pptm',
  '.pptx',
  '.xlam',
  '.xlsm',
  '.xlsx',
  '.xltm',
  '.xltx',
]);

const OOXML_MACRO_EXTENSIONS = new Set([
  '.docm',
  '.dotm',
  '.potm',
  '.ppsm',
  '.pptm',
  '.xlam',
  '.xlsm',
  '.xltm',
]);
const OLE_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);
const OLE_EXTENSIONS = new Set(['.doc', '.ppt', '.xls']);

type DocumentFormat = 'csv' | 'ole' | 'ooxml' | 'plain_text' | 'unknown';

function startsWithSignature(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

function startsWithAnySignature(bytes: Uint8Array, signatures: number[][]) {
  return signatures.some((signature) => startsWithSignature(bytes, signature));
}

function normalizeMimeType(mimeType: string) {
  return mimeType.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function getFileExtension(fileName: string) {
  const normalizedFileName = fileName.trim().toLowerCase();
  const extensionIndex = normalizedFileName.lastIndexOf('.');
  return extensionIndex >= 0 ? normalizedFileName.slice(extensionIndex) : '';
}

function looksLikeUtf8Text(bytes: Uint8Array) {
  if (bytes.length === 0) {
    return true;
  }

  let printable = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      return false;
    }
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) {
      printable += 1;
    }
  }

  return printable / bytes.length >= 0.9;
}

function resolveDocumentFormat(mimeType: string, fileName: string): DocumentFormat {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const extension = getFileExtension(fileName);

  if (normalizedMimeType === 'text/csv' || extension === '.csv') {
    return 'csv';
  }

  if (normalizedMimeType === 'text/plain' || extension === '.txt') {
    return 'plain_text';
  }

  if (OOXML_MIME_TYPES.has(normalizedMimeType) || OOXML_EXTENSIONS.has(extension)) {
    return 'ooxml';
  }

  if (OLE_MIME_TYPES.has(normalizedMimeType) || OLE_EXTENSIONS.has(extension)) {
    return 'ole';
  }

  return 'unknown';
}

function resolveKnownKind(mimeType: string, fileName: string): AllowedFileKind | null {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const normalizedFileName = fileName.trim().toLowerCase();

  if (normalizedMimeType === 'application/pdf' || normalizedFileName.endsWith('.pdf')) {
    return 'pdf';
  }

  if (
    normalizedMimeType === 'image/png' ||
    normalizedMimeType === 'image/jpeg' ||
    normalizedMimeType === 'image/gif' ||
    normalizedMimeType === 'image/webp' ||
    normalizedFileName.endsWith('.png') ||
    normalizedFileName.endsWith('.jpg') ||
    normalizedFileName.endsWith('.jpeg') ||
    normalizedFileName.endsWith('.gif') ||
    normalizedFileName.endsWith('.webp')
  ) {
    return 'image';
  }

  if (resolveDocumentFormat(mimeType, fileName) !== 'unknown') {
    return 'document';
  }

  return null;
}

function signatureMatches(bytes: Uint8Array, mimeType: string, fileName: string) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const normalizedFileName = fileName.trim().toLowerCase();

  if (normalizedMimeType === 'application/pdf' || normalizedFileName.endsWith('.pdf')) {
    return startsWithSignature(bytes, PDF_SIGNATURE);
  }

  if (normalizedMimeType === 'image/png' || normalizedFileName.endsWith('.png')) {
    return startsWithSignature(bytes, PNG_SIGNATURE);
  }

  if (
    normalizedMimeType === 'image/jpeg' ||
    normalizedFileName.endsWith('.jpg') ||
    normalizedFileName.endsWith('.jpeg')
  ) {
    return startsWithSignature(bytes, JPEG_SIGNATURE);
  }

  if (normalizedMimeType === 'image/gif' || normalizedFileName.endsWith('.gif')) {
    return startsWithSignature(bytes, GIF_SIGNATURE);
  }

  if (normalizedMimeType === 'image/webp' || normalizedFileName.endsWith('.webp')) {
    return startsWithSignature(bytes, WEBP_SIGNATURE);
  }

  const documentFormat = resolveDocumentFormat(mimeType, fileName);
  if (documentFormat === 'plain_text' || documentFormat === 'csv') {
    return looksLikeUtf8Text(bytes.slice(0, TEXT_SIGNATURE_WINDOW_BYTES));
  }

  if (documentFormat === 'ooxml') {
    return startsWithAnySignature(bytes, ZIP_SIGNATURES);
  }

  if (documentFormat === 'ole') {
    return startsWithSignature(bytes, OLE_SIGNATURE);
  }

  return false;
}

function decodePdfWindow(bytes: Uint8Array) {
  const head = bytes.slice(0, Math.min(bytes.length, PDF_TOKEN_WINDOW_BYTES));
  const tail = bytes.slice(Math.max(0, bytes.length - PDF_TOKEN_WINDOW_BYTES));
  const decoder = new TextDecoder('latin1');
  return {
    head: decoder.decode(head),
    tail: decoder.decode(tail),
    text: decoder.decode(bytes),
  };
}

function rejectInspection(details: string, inspectedAt: number, reason: StorageInspectionReason) {
  return {
    details,
    engine: 's3-intake-policy' as const,
    inspectedAt,
    reason,
    status: 'REJECTED' as const,
  };
}

function decodeBinaryText(bytes: Uint8Array) {
  return new TextDecoder('latin1').decode(bytes);
}

function containsToken(binaryText: string, token: string) {
  return binaryText.includes(token);
}

function containsCaseInsensitiveToken(binaryText: string, token: string) {
  return binaryText.toLowerCase().includes(token.toLowerCase());
}

function isMacroEnabledOoxml(mimeType: string, fileName: string, binaryText: string) {
  return (
    OOXML_MACRO_EXTENSIONS.has(getFileExtension(fileName)) ||
    normalizeMimeType(mimeType).includes('macroenabled.12') ||
    containsCaseInsensitiveToken(binaryText, 'vbaProject.bin') ||
    containsCaseInsensitiveToken(binaryText, 'macroEnabled.12')
  );
}

function isPasswordProtectedOfficeDocument(binaryText: string) {
  return (
    containsToken(binaryText, 'EncryptedPackage') || containsToken(binaryText, 'EncryptionInfo')
  );
}

function inspectOoxmlDocument(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  inspectedAt: number,
): StorageInspectionResult | null {
  const binaryText = decodeBinaryText(bytes);

  if (
    !containsToken(binaryText, '[Content_Types].xml') ||
    (!containsToken(binaryText, 'word/') &&
      !containsToken(binaryText, 'xl/') &&
      !containsToken(binaryText, 'ppt/'))
  ) {
    return rejectInspection(
      'Unsupported or malformed OOXML package structure.',
      inspectedAt,
      'unsupported_type',
    );
  }

  if (isPasswordProtectedOfficeDocument(binaryText)) {
    return rejectInspection(
      'Password-protected Office documents are not allowed.',
      inspectedAt,
      'office_password_protected',
    );
  }

  if (isMacroEnabledOoxml(mimeType, fileName, binaryText)) {
    return rejectInspection(
      'Macro-enabled Office documents are not allowed.',
      inspectedAt,
      'office_macro_enabled',
    );
  }

  return null;
}

function inspectOleDocument(bytes: Uint8Array, inspectedAt: number): StorageInspectionResult {
  const binaryText = decodeBinaryText(bytes);

  if (isPasswordProtectedOfficeDocument(binaryText)) {
    return rejectInspection(
      'Password-protected Office documents are not allowed.',
      inspectedAt,
      'office_password_protected',
    );
  }

  if (
    containsToken(binaryText, 'Macros') ||
    containsToken(binaryText, 'VBA') ||
    containsToken(binaryText, '_VBA_PROJECT') ||
    containsToken(binaryText, 'PROJECTwm')
  ) {
    return rejectInspection(
      'Macro-enabled Office documents are not allowed.',
      inspectedAt,
      'office_macro_enabled',
    );
  }

  return rejectInspection(
    'Legacy OLE compound Office documents are not supported.',
    inspectedAt,
    'unsupported_type',
  );
}

function inspectDocumentStructure(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  inspectedAt: number,
): StorageInspectionResult | null {
  const documentFormat = resolveDocumentFormat(mimeType, fileName);

  if (documentFormat === 'ooxml') {
    return inspectOoxmlDocument(bytes, fileName, mimeType, inspectedAt);
  }

  if (documentFormat === 'ole') {
    return inspectOleDocument(bytes, inspectedAt);
  }

  return null;
}

function inspectPdfStructure(
  bytes: Uint8Array,
  inspectedAt: number,
): StorageInspectionResult | null {
  const { head, tail, text } = decodePdfWindow(bytes);

  if (!head.startsWith('%PDF-')) {
    return rejectInspection('PDF header is missing or malformed.', inspectedAt, 'pdf_malformed');
  }

  if (!tail.includes('%%EOF')) {
    return rejectInspection('PDF EOF marker is missing.', inspectedAt, 'pdf_malformed');
  }

  if (/\/Encrypt\b/u.test(text)) {
    return rejectInspection('Encrypted PDFs are not allowed.', inspectedAt, 'pdf_encrypted');
  }

  if (/\/EmbeddedFile\b|\/Filespec\b/u.test(text)) {
    return rejectInspection(
      'PDF embedded files are not allowed.',
      inspectedAt,
      'pdf_embedded_files',
    );
  }

  if (/\/JS\b|\/JavaScript\b/u.test(text)) {
    return rejectInspection('PDF JavaScript is not allowed.', inspectedAt, 'pdf_javascript');
  }

  if (/\/Launch\b/u.test(text)) {
    return rejectInspection(
      'PDF launch actions are not allowed.',
      inspectedAt,
      'pdf_launch_action',
    );
  }

  if (/\/OpenAction\b/u.test(text)) {
    return rejectInspection('PDF open actions are not allowed.', inspectedAt, 'pdf_open_action');
  }

  if (/\/XFA\b/u.test(text)) {
    return rejectInspection('PDF XFA forms are not allowed.', inspectedAt, 'pdf_xfa');
  }

  if (/\/RichMedia\b/u.test(text)) {
    return rejectInspection('PDF rich media is not allowed.', inspectedAt, 'pdf_rich_media');
  }

  if (/\/SubmitForm\b|\/ImportData\b|\/Sound\b|\/Movie\b/u.test(text)) {
    return rejectInspection(
      'PDF active content is not allowed.',
      inspectedAt,
      'pdf_active_content',
    );
  }

  return null;
}

async function computeSha256Hex(bytes: Uint8Array) {
  const digestInput = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

export function resolveStorageInspectionPolicy(args: {
  defaultMaxBytes: number;
  sourceType: string;
}): StorageInspectionPolicy {
  if (args.sourceType === 'security_control_evidence') {
    return {
      allowedKinds: ['document', 'image', 'pdf'],
      maxBytes: MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES,
    };
  }

  return {
    allowedKinds: ['document', 'image', 'pdf'],
    maxBytes: args.defaultMaxBytes,
  };
}

export async function inspectStorageUploadBytes(args: {
  allowedKinds: AllowedFileKind[];
  bytes: Uint8Array;
  fileName: string;
  maxBytes: number;
  mimeType: string;
  sha256Hex?: string;
}): Promise<StorageInspectionResult> {
  const inspectedAt = Date.now();

  try {
    if (args.bytes.byteLength > args.maxBytes) {
      const sizeMB = (args.bytes.byteLength / (1024 * 1024)).toFixed(2);
      return rejectInspection(
        `File size (${sizeMB}MB) exceeds the maximum allowed size of ${(
          args.maxBytes /
          (1024 * 1024)
        ).toFixed(0)}MB.`,
        inspectedAt,
        'size_limit_exceeded',
      );
    }

    const knownKind = resolveKnownKind(args.mimeType, args.fileName);
    if (!knownKind || !args.allowedKinds.includes(knownKind)) {
      return {
        details: 'File type is not allowed for this workflow.',
        engine: 's3-intake-policy',
        inspectedAt,
        reason: 'unsupported_type',
        status: 'REJECTED',
      };
    }

    if (!signatureMatches(args.bytes.slice(0, 16), args.mimeType, args.fileName)) {
      return {
        details: 'File signature does not match the declared type.',
        engine: 's3-intake-policy',
        inspectedAt,
        reason: 'file_signature_mismatch',
        status: 'REJECTED',
      };
    }

    if (args.sha256Hex) {
      const uploadedSha256Hex = await computeSha256Hex(args.bytes);
      if (uploadedSha256Hex !== args.sha256Hex.trim().toLowerCase()) {
        return {
          details: 'Uploaded file checksum does not match the authorized upload.',
          engine: 's3-intake-policy',
          inspectedAt,
          reason: 'checksum_mismatch',
          status: 'REJECTED',
        };
      }
    }

    if (knownKind === 'pdf') {
      const pdfResult = inspectPdfStructure(args.bytes, inspectedAt);
      if (pdfResult) {
        return pdfResult;
      }
    }

    if (knownKind === 'document') {
      const documentResult = inspectDocumentStructure(
        args.bytes,
        args.fileName,
        args.mimeType,
        inspectedAt,
      );
      if (documentResult) {
        return documentResult;
      }
    }

    return {
      engine: 's3-intake-policy',
      inspectedAt,
      status: 'PASSED',
    };
  } catch (error) {
    return {
      details: error instanceof Error ? error.message : 'Storage inspection failed.',
      engine: 's3-intake-policy',
      inspectedAt,
      reason: 'inspection_error',
      status: 'FAILED',
    };
  }
}
