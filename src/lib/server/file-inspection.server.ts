export type FileInspectionStatus = 'accepted' | 'inspection_failed' | 'quarantined' | 'rejected';

export type FileInspectionResult = {
  details?: string;
  engine: 'builtin-file-inspection';
  inspectedAt: number;
  reason:
    | 'file_signature_mismatch'
    | 'inspection_error'
    | 'size_limit_exceeded'
    | 'unsupported_type';
  status: FileInspectionStatus;
};

type AllowedFileKind = 'document' | 'image' | 'pdf';

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46];

function startsWithSignature(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
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
    normalizedMimeType === 'application/json' ||
    normalizedMimeType === 'text/markdown' ||
    normalizedMimeType === 'text/plain' ||
    normalizedMimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    normalizedFileName.endsWith('.csv') ||
    normalizedFileName.endsWith('.json') ||
    normalizedFileName.endsWith('.md') ||
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

  return true;
}

export async function inspectFile(args: {
  allowedKinds: AllowedFileKind[];
  blob: Blob;
  fileName: string;
  maxBytes?: number;
  mimeType: string;
}): Promise<FileInspectionResult> {
  const inspectedAt = Date.now();

  try {
    if (args.maxBytes !== undefined && args.blob.size > args.maxBytes) {
      const sizeMB = (args.blob.size / (1024 * 1024)).toFixed(2);
      return {
        details: `File size (${sizeMB}MB) exceeds the maximum allowed size of ${(
          args.maxBytes / (1024 * 1024)
        ).toFixed(0)}MB.`,
        engine: 'builtin-file-inspection',
        inspectedAt,
        reason: 'size_limit_exceeded',
        status: 'rejected',
      };
    }

    const knownKind = resolveKnownKind(args.mimeType, args.fileName);
    if (!knownKind || !args.allowedKinds.includes(knownKind)) {
      return {
        details: 'File type is not allowed for this workflow.',
        engine: 'builtin-file-inspection',
        inspectedAt,
        reason: 'unsupported_type',
        status: 'rejected',
      };
    }

    const bytes = new Uint8Array(await args.blob.slice(0, 16).arrayBuffer());
    if (!signatureMatches(bytes, args.mimeType, args.fileName)) {
      return {
        details: 'File signature does not match the declared type.',
        engine: 'builtin-file-inspection',
        inspectedAt,
        reason: 'file_signature_mismatch',
        status: 'quarantined',
      };
    }

    return {
      engine: 'builtin-file-inspection',
      inspectedAt,
      reason: 'unsupported_type',
      status: 'accepted',
    };
  } catch (error) {
    return {
      details: error instanceof Error ? error.message : 'File inspection failed.',
      engine: 'builtin-file-inspection',
      inspectedAt,
      reason: 'inspection_error',
      status: 'inspection_failed',
    };
  }
}
