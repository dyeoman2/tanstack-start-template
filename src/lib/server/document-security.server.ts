export type DocumentScanResult = {
  details?: string;
  engine: 'local-signature-scan';
  scannedAt: number;
  status: 'clean' | 'quarantined';
};

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

export async function verifyDocumentSignature(blob: Blob, mimeType: string, fileName: string) {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const normalizedFileName = fileName.trim().toLowerCase();
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());

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

export async function scanDocumentBlob(args: {
  blob: Blob;
  fileName: string;
  mimeType: string;
}): Promise<DocumentScanResult> {
  const signatureMatches = await verifyDocumentSignature(args.blob, args.mimeType, args.fileName);

  if (!signatureMatches) {
    return {
      details: 'File signature does not match the declared type.',
      engine: 'local-signature-scan',
      scannedAt: Date.now(),
      status: 'quarantined',
    };
  }

  return {
    engine: 'local-signature-scan',
    scannedAt: Date.now(),
    status: 'clean',
  };
}
