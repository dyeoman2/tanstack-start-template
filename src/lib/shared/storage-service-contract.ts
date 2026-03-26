export type StorageBucketKind = 'clean' | 'mirror' | 'quarantine' | 'rejected';
export type DocumentParseKind = 'chat_document_extract' | 'pdf_parse';

export type StorageServiceConfig = {
  baseUrl: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  sessionToken: string | null;
};

export type StorageServiceObjectRecord = {
  key: string;
  lastModified: number | null;
};

export type StorageServiceUploadTargetRequest = {
  contentType?: string;
  expiresInSeconds?: number;
  headers?: Record<string, string>;
  key: string;
};

export type StorageServiceDownloadUrlRequest = {
  bucketKind: 'clean' | 'mirror';
  expiresInSeconds?: number;
  key: string;
};

export type StorageServicePresignedUrlResponse = {
  bucket: string;
  expiresAt: number;
  url: string;
};

export type StorageServiceCopyObjectRequest = {
  contentType?: string;
  destinationKey: string;
  sourceKey: string;
};

export type StorageServicePutObjectRequest = {
  bodyBase64: string;
  contentType: string;
  key: string;
};

export type StorageServicePutObjectResponse = {
  versionId: string | null;
};

export type StorageServiceDeleteObjectRequest = {
  bucketKind: StorageBucketKind;
  key: string;
  versionId?: string;
};

export type StorageServiceReadObjectRequest = {
  bucketKind: StorageBucketKind;
  key: string;
};

export type StorageServiceListObjectsRequest = {
  bucketKind: StorageBucketKind;
  continuationToken?: string;
  maxKeys?: number;
  prefix: string;
};

export type StorageServiceListObjectsResponse = {
  contents: StorageServiceObjectRecord[];
};

export type StorageServiceListObjectVersionsRequest = {
  bucketKind: StorageBucketKind;
  key: string;
};

export type StorageServiceListObjectVersionsResponse = {
  versions: Array<{
    isLatest: boolean;
    key: string | null;
    lastModified: number | null;
    versionId: string | null;
  }>;
};

export type StorageServiceReadObjectResponseHeaders = {
  contentType: string;
  versionId: string | null;
};

export type StorageInspectionQueueMessage = {
  kind: 'storage_inspection';
  storageId: string;
  bucket: string;
  key: string;
  fileName: string;
  maxBytes: number;
  mimeType: string;
  organizationId?: string | null;
  sha256Hex?: string;
  sourceType: string;
};

export type DocumentParseQueueMessage = {
  kind: 'document_parse';
  parseKind: DocumentParseKind;
  storageId: string;
  fileName: string;
  mimeType: string;
  canonicalKey: string;
  organizationId?: string | null;
  sourceType: string;
};

export type StorageQueueMessage = DocumentParseQueueMessage | StorageInspectionQueueMessage;

export type StorageServiceEnqueueResponse = {
  accepted: true;
};

export type StorageInspectionResultCallbackRequest = {
  type: 'inspection_result';
  storageId: string;
  details?: string;
  engine: string;
  reason?:
    | 'archive_encrypted'
    | 'archive_suspicious_structure'
    | 'checksum_mismatch'
    | 'file_signature_mismatch'
    | 'inspection_error'
    | 'office_macro_enabled'
    | 'office_password_protected'
    | 'ooxml_embedded_content'
    | 'ooxml_external_relationship'
    | 'ooxml_malformed'
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
  scannedAt: number;
  status: 'FAILED' | 'PASSED' | 'REJECTED';
};

export type StorageDecisionResultCallbackRequest = {
  type: 'decision_result';
  action: 'promote' | 'reject';
  storageId: string;
  errorMessage?: string;
  promotedBucket?: string;
  promotedKey?: string;
  promotedVersionId?: string | null;
  rejectedBucket?: string;
  rejectedKey?: string;
  rejectedVersionId?: string | null;
  status: 'FAILED' | 'PROMOTED' | 'REJECTED';
};

export type DocumentParseResultCallbackRequest = {
  type: 'document_result';
  parseKind: DocumentParseKind;
  storageId: string;
  errorMessage?: string;
  pageCount?: number;
  imageCount?: number;
  parserVersion: string;
  resultChecksumSha256?: string;
  resultContentType?: string;
  resultKey?: string;
  resultSizeBytes?: number;
  status: 'FAILED' | 'SUCCEEDED';
};

export type StorageServiceGuardDutyCallbackRequest =
  | {
      type: 'guardduty_finding';
      bucket: string;
      findingId: string;
      key: string;
      scannedAt: number;
      status: 'CLEAN' | 'INFECTED';
      versionId?: string;
    }
  | {
      type: 'promotion_result';
      bucket: string;
      failureReason?: string;
      findingId: string;
      promotedBucket?: string;
      promotedKey?: string;
      promotedVersionId?: string;
      quarantineKey: string;
      scannedAt: number;
      status: 'PROMOTED' | 'PROMOTION_FAILED';
    };

export type StorageServiceInspectionCallbackRequest = {
  bucket: string;
  key: string;
};

const DOCUMENT_PARSE_RESULT_EXTENSION_BY_KIND = {
  chat_document_extract: 'txt',
  pdf_parse: 'json',
} as const satisfies Record<DocumentParseKind, string>;

const DOCUMENT_PARSE_RESULT_CONTENT_TYPE_BY_KIND = {
  chat_document_extract: 'text/plain',
  pdf_parse: 'application/json',
} as const satisfies Record<DocumentParseKind, string>;

function normalizeStorageKeyPrefix(prefix: string) {
  const trimmed = prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed.length > 0 ? `${trimmed}/` : '';
}

export function getDocumentParseResultExtension(parseKind: DocumentParseKind) {
  return DOCUMENT_PARSE_RESULT_EXTENSION_BY_KIND[parseKind];
}

export function getDocumentParseResultContentType(parseKind: DocumentParseKind) {
  return DOCUMENT_PARSE_RESULT_CONTENT_TYPE_BY_KIND[parseKind];
}

export function buildDocumentParseResultStagingKey(
  prefix: string,
  parseKind: DocumentParseKind,
  storageId: string,
) {
  return `${normalizeStorageKeyPrefix(prefix)}${parseKind}/${storageId}.${getDocumentParseResultExtension(parseKind)}`;
}
