'use node';

import { getStorageRuntimeConfig } from '../../src/lib/server/env.server';
import type {
  DocumentParseQueueMessage,
  StorageBucketKind,
  StorageInspectionQueueMessage,
  StorageServiceDownloadUrlRequest,
  StorageServiceEnqueueResponse,
  StorageServicePresignedUrlResponse,
  StorageServiceUploadTargetRequest,
} from '../../src/lib/shared/storage-service-contract';
import { requestStorageBrokerJson } from './storageBrokerClient';

export function getRequiredStorageEncryptionHeaders(
  kind: StorageBucketKind,
): Record<string, string> {
  const config = getStorageRuntimeConfig().storageBuckets[kind];
  if (!config.kmsKeyArn) {
    throw new Error(`AWS_S3_${kind.toUpperCase()}_KMS_KEY_ARN environment variable is required.`);
  }

  return {
    'x-amz-server-side-encryption': 'aws:kms',
    'x-amz-server-side-encryption-aws-kms-key-id': config.kmsKeyArn,
  };
}

export async function createQuarantineUploadPresignedUrl(args: StorageServiceUploadTargetRequest) {
  return await requestStorageBrokerJson<StorageServicePresignedUrlResponse>({
    body: args,
    path: '/internal/storage/upload-target',
    tier: 'edge',
  });
}

export async function createDownloadPresignedStorageUrl(args: StorageServiceDownloadUrlRequest) {
  return await requestStorageBrokerJson<StorageServicePresignedUrlResponse>({
    body: args,
    path: '/internal/storage/download-url',
    tier: 'edge',
  });
}

export async function enqueueStorageInspectionTask(args: StorageInspectionQueueMessage) {
  return await requestStorageBrokerJson<StorageServiceEnqueueResponse>({
    body: args,
    path: '/internal/storage/enqueue-inspection',
    tier: 'edge',
  });
}

export async function enqueueDocumentParseTask(args: DocumentParseQueueMessage) {
  return await requestStorageBrokerJson<StorageServiceEnqueueResponse>({
    body: args,
    path: '/internal/storage/enqueue-document-parse',
    tier: 'edge',
  });
}
