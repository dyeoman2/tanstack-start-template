export type AllowedFileKind = 'document' | 'image' | 'pdf';

export type StorageInspectionStatus = 'FAILED' | 'PASSED' | 'REJECTED';

export type StorageInspectionReason =
  | 'checksum_mismatch'
  | 'file_signature_mismatch'
  | 'inspection_error'
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
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const MAX_SECURITY_EVIDENCE_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const PDF_TOKEN_WINDOW_BYTES = 16 * 1024;

function startsWithSignature(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
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

function resolveKnownKind(mimeType: string, fileName: string): AllowedFileKind | null {
  const normalizedMimeType = mimeType.trim().toLowerCase();
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

  if (
    normalizedMimeType === 'text/csv' ||
    normalizedMimeType === 'text/plain' ||
    normalizedMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    normalizedFileName.endsWith('.csv') ||
    normalizedFileName.endsWith('.txt') ||
    normalizedFileName.endsWith('.xlsx')
  ) {
    return 'document';
  }

  return null;
}

function signatureMatches(bytes: Uint8Array, mimeType: string, fileName: string) {
  const normalizedMimeType = mimeType.trim().toLowerCase();
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

  if (
    normalizedMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    normalizedFileName.endsWith('.xlsx')
  ) {
    return startsWithSignature(bytes, ZIP_SIGNATURE);
  }

  if (normalizedMimeType === 'text/plain' || normalizedMimeType === 'text/csv') {
    return looksLikeUtf8Text(bytes.slice(0, 512));
  }

  return true;
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

function rejectPdf(details: string, inspectedAt: number, reason: StorageInspectionReason) {
  return {
    details,
    engine: 's3-intake-policy' as const,
    inspectedAt,
    reason,
    status: 'REJECTED' as const,
  };
}

function inspectPdfStructure(
  bytes: Uint8Array,
  inspectedAt: number,
): StorageInspectionResult | null {
  const { head, tail, text } = decodePdfWindow(bytes);

  if (!head.startsWith('%PDF-')) {
    return rejectPdf('PDF header is missing or malformed.', inspectedAt, 'pdf_malformed');
  }

  if (!tail.includes('%%EOF')) {
    return rejectPdf('PDF EOF marker is missing.', inspectedAt, 'pdf_malformed');
  }

  if (/\/Encrypt\b/u.test(text)) {
    return rejectPdf('Encrypted PDFs are not allowed.', inspectedAt, 'pdf_encrypted');
  }

  if (/\/EmbeddedFile\b|\/Filespec\b/u.test(text)) {
    return rejectPdf('PDF embedded files are not allowed.', inspectedAt, 'pdf_embedded_files');
  }

  if (/\/JS\b|\/JavaScript\b/u.test(text)) {
    return rejectPdf('PDF JavaScript is not allowed.', inspectedAt, 'pdf_javascript');
  }

  if (/\/Launch\b/u.test(text)) {
    return rejectPdf('PDF launch actions are not allowed.', inspectedAt, 'pdf_launch_action');
  }

  if (/\/OpenAction\b/u.test(text)) {
    return rejectPdf('PDF open actions are not allowed.', inspectedAt, 'pdf_open_action');
  }

  if (/\/XFA\b/u.test(text)) {
    return rejectPdf('PDF XFA forms are not allowed.', inspectedAt, 'pdf_xfa');
  }

  if (/\/RichMedia\b/u.test(text)) {
    return rejectPdf('PDF rich media is not allowed.', inspectedAt, 'pdf_rich_media');
  }

  if (/\/SubmitForm\b|\/ImportData\b|\/Sound\b|\/Movie\b/u.test(text)) {
    return rejectPdf('PDF active content is not allowed.', inspectedAt, 'pdf_active_content');
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
      return rejectPdf(
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
