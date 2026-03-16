import { inspectFile } from './file-inspection.server';

export type DocumentScanResult = {
  details?: string;
  engine: 'builtin-file-inspection';
  scannedAt: number;
  status: 'clean' | 'quarantined';
};

export async function verifyDocumentSignature(blob: Blob, mimeType: string, fileName: string) {
  const inspection = await inspectFile({
    allowedKinds: ['document', 'image', 'pdf'],
    blob,
    fileName,
    mimeType,
  });

  return inspection.status === 'accepted';
}

export async function scanDocumentBlob(args: {
  blob: Blob;
  fileName: string;
  mimeType: string;
}): Promise<DocumentScanResult> {
  const inspection = await inspectFile({
    allowedKinds: ['document', 'image', 'pdf'],
    blob: args.blob,
    fileName: args.fileName,
    mimeType: args.mimeType,
  });

  if (inspection.status !== 'accepted') {
    return {
      details: inspection.details,
      engine: inspection.engine,
      scannedAt: inspection.inspectedAt,
      status: 'quarantined',
    };
  }

  return {
    engine: inspection.engine,
    scannedAt: inspection.inspectedAt,
    status: 'clean',
  };
}
