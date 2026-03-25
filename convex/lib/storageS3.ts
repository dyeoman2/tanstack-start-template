'use node';

import { Buffer } from 'node:buffer';
import { getStorageRuntimeConfig } from '../../src/lib/server/env.server';
import { buildInternalServiceAuthorizationHeader } from '../../src/lib/server/internal-service-auth';
import type {
  StorageBucketKind,
  StorageServiceDeleteObjectRequest,
  StorageServiceDownloadUrlRequest,
  StorageServiceListObjectVersionsRequest,
  StorageServiceListObjectVersionsResponse,
  StorageServiceListObjectsRequest,
  StorageServiceListObjectsResponse,
  StorageServicePresignedUrlResponse,
  StorageServicePutObjectRequest,
  StorageServicePutObjectResponse,
  StorageServiceReadObjectRequest,
  StorageServiceUploadTargetRequest,
} from '../../src/lib/shared/storage-service-contract';

type CleanupObjectResponse = {
  Body: Blob;
  ContentType?: string;
  VersionId?: string | null;
};

function getRequiredService(kind: 'broker' | 'worker') {
  const service = getStorageRuntimeConfig().services[kind];
  if (!service.baseUrl || !service.sharedSecret) {
    throw new Error(`Storage ${kind} service is not configured for S3 operations.`);
  }
  return {
    baseUrl: service.baseUrl,
    sharedSecret: service.sharedSecret,
  };
}

function buildUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`;
}

async function requestJson<TResponse>(args: {
  body: unknown;
  path: string;
  service: 'broker' | 'worker';
}) {
  const service = getRequiredService(args.service);
  const response = await fetch(buildUrl(service.baseUrl, args.path), {
    method: 'POST',
    headers: {
      Authorization: buildInternalServiceAuthorizationHeader(service.sharedSecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

async function requestObjectRead(args: {
  body: StorageServiceReadObjectRequest;
  path: string;
  service: 'broker' | 'worker';
}): Promise<CleanupObjectResponse> {
  const service = getRequiredService(args.service);
  const response = await fetch(buildUrl(service.baseUrl, args.path), {
    method: 'POST',
    headers: {
      Authorization: buildInternalServiceAuthorizationHeader(service.sharedSecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.body),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return {
    Body: new Blob([await response.arrayBuffer()], {
      type: response.headers.get('content-type') ?? 'application/octet-stream',
    }),
    ContentType: response.headers.get('content-type') ?? undefined,
    VersionId: response.headers.get('x-storage-version-id'),
  };
}

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
  return await requestJson<StorageServicePresignedUrlResponse>({
    body: args,
    path: '/internal/storage/upload-target',
    service: 'broker',
  });
}

export async function createDownloadPresignedStorageUrl(args: StorageServiceDownloadUrlRequest) {
  return await requestJson<StorageServicePresignedUrlResponse>({
    body: args,
    path: '/internal/storage/download-url',
    service: 'broker',
  });
}

async function putObject(
  path: string,
  args: {
    body: Uint8Array;
    contentType: string;
    key: string;
  },
) {
  const requestBody: StorageServicePutObjectRequest = {
    bodyBase64: Buffer.from(args.body).toString('base64'),
    contentType: args.contentType,
    key: args.key,
  };
  const result = await requestJson<StorageServicePutObjectResponse>({
    body: requestBody,
    path,
    service: 'worker',
  });
  return {
    VersionId: result.versionId ?? undefined,
  };
}

export async function putMirrorObject(args: {
  body: Uint8Array;
  contentType: string;
  key: string;
}) {
  return await putObject('/internal/storage/mirror', args);
}

export async function putCleanObject(args: { body: Uint8Array; contentType: string; key: string }) {
  return await putObject('/internal/storage/clean-put', args);
}

export async function promoteQuarantineObject(args: {
  contentType?: string;
  destinationKey: string;
  sourceKey: string;
}) {
  const result = await requestJson<StorageServicePutObjectResponse>({
    body: args,
    path: '/internal/storage/promote',
    service: 'worker',
  });
  return {
    VersionId: result.versionId ?? undefined,
  };
}

export async function rejectQuarantineObject(args: {
  contentType?: string;
  destinationKey: string;
  sourceKey: string;
}) {
  const result = await requestJson<StorageServicePutObjectResponse>({
    body: args,
    path: '/internal/storage/reject',
    service: 'worker',
  });
  return {
    VersionId: result.versionId ?? undefined,
  };
}

export async function deleteStorageObject(args: StorageServiceDeleteObjectRequest) {
  await requestJson<{ ok: true }>({
    body: {
      operation: 'deleteObject',
      ...args,
    },
    path: '/internal/storage/cleanup',
    service: 'worker',
  });
}

export async function listStorageObjects(args: StorageServiceListObjectsRequest) {
  const result = await requestJson<StorageServiceListObjectsResponse>({
    body: {
      operation: 'listObjects',
      ...args,
    },
    path: '/internal/storage/cleanup',
    service: 'worker',
  });
  return {
    Contents: result.contents.map((entry) => ({
      Key: entry.key,
      LastModified: entry.lastModified === null ? undefined : new Date(entry.lastModified),
    })),
  };
}

export async function listStorageObjectVersions(args: StorageServiceListObjectVersionsRequest) {
  const result = await requestJson<StorageServiceListObjectVersionsResponse>({
    body: {
      operation: 'listObjectVersions',
      ...args,
    },
    path: '/internal/storage/cleanup',
    service: 'worker',
  });
  return {
    Versions: result.versions.map((entry) => ({
      IsLatest: entry.isLatest,
      Key: entry.key ?? undefined,
      LastModified: entry.lastModified === null ? undefined : new Date(entry.lastModified),
      VersionId: entry.versionId ?? undefined,
    })),
  };
}

export async function getQuarantineObject(args: { key: string }) {
  return await requestObjectRead({
    body: {
      bucketKind: 'quarantine',
      key: args.key,
    },
    path: '/internal/storage/object-read',
    service: 'worker',
  });
}

export async function getCleanObject(args: { key: string }) {
  return await requestObjectRead({
    body: {
      bucketKind: 'clean',
      key: args.key,
    },
    path: '/internal/storage/object-read',
    service: 'broker',
  });
}

export async function getMirrorObject(args: { key: string }) {
  return await requestObjectRead({
    body: {
      bucketKind: 'mirror',
      key: args.key,
    },
    path: '/internal/storage/object-read',
    service: 'broker',
  });
}
