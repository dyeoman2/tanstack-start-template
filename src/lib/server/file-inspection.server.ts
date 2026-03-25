import type { AllowedFileKind, StorageInspectionReason } from './storage-inspection-policy';
import { inspectStorageUploadBytes } from './storage-inspection-policy';

export type FileInspectionStatus = 'accepted' | 'inspection_failed' | 'quarantined' | 'rejected';

export type FileInspectionResult = {
  details?: string;
  engine: 'builtin-file-inspection';
  inspectedAt: number;
  reason: StorageInspectionReason | 'unsupported_type';
  status: FileInspectionStatus;
};

export async function inspectFile(args: {
  allowedKinds: AllowedFileKind[];
  blob: Blob;
  fileName: string;
  maxBytes?: number;
  sha256Hex?: string;
  mimeType: string;
}): Promise<FileInspectionResult> {
  const result = await inspectStorageUploadBytes({
    allowedKinds: args.allowedKinds,
    bytes: new Uint8Array(await args.blob.arrayBuffer()),
    fileName: args.fileName,
    maxBytes: args.maxBytes ?? Number.MAX_SAFE_INTEGER,
    mimeType: args.mimeType,
    sha256Hex: args.sha256Hex,
  });

  if (result.status === 'PASSED') {
    return {
      engine: 'builtin-file-inspection',
      inspectedAt: result.inspectedAt,
      reason: 'unsupported_type',
      status: 'accepted',
    };
  }

  if (result.status === 'FAILED') {
    return {
      details: result.details,
      engine: 'builtin-file-inspection',
      inspectedAt: result.inspectedAt,
      reason: result.reason ?? 'inspection_error',
      status: 'inspection_failed',
    };
  }

  return {
    details: result.details,
    engine: 'builtin-file-inspection',
    inspectedAt: result.inspectedAt,
    reason: result.reason ?? 'inspection_error',
    status: result.reason === 'file_signature_mismatch' ? 'quarantined' : 'rejected',
  };
}
