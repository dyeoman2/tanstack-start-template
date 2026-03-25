export type StorageBucketKind = 'clean' | 'mirror' | 'quarantine' | 'rejected';

export type StorageServiceConfig = {
  baseUrl: string | null;
  sharedSecret: string | null;
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
