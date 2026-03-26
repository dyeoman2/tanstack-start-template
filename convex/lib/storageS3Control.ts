'use node';

import type {
  StorageServiceDeleteObjectRequest,
  StorageServiceListObjectVersionsRequest,
  StorageServiceListObjectVersionsResponse,
  StorageServiceListObjectsRequest,
  StorageServiceListObjectsResponse,
  StorageServicePutObjectRequest,
  StorageServicePutObjectResponse,
} from '../../src/lib/shared/storage-service-contract';
import { requestStorageBrokerJson, requestStorageBrokerObjectRead } from './storageBrokerClient';

export async function putMirrorObject(args: {
  body: Uint8Array;
  contentType: string;
  key: string;
}) {
  const requestBody: StorageServicePutObjectRequest = {
    bodyBase64: Buffer.from(args.body).toString('base64'),
    contentType: args.contentType,
    key: args.key,
  };
  const result = await requestStorageBrokerJson<StorageServicePutObjectResponse>({
    body: requestBody,
    path: '/internal/storage/mirror-put',
    tier: 'control',
  });
  return {
    VersionId: result.versionId ?? undefined,
  };
}

export async function putCleanObject(args: { body: Uint8Array; contentType: string; key: string }) {
  const requestBody: StorageServicePutObjectRequest = {
    bodyBase64: Buffer.from(args.body).toString('base64'),
    contentType: args.contentType,
    key: args.key,
  };
  const result = await requestStorageBrokerJson<StorageServicePutObjectResponse>({
    body: requestBody,
    path: '/internal/storage/clean-put',
    tier: 'control',
  });
  return {
    VersionId: result.versionId ?? undefined,
  };
}

export async function promoteQuarantineObject(args: {
  contentType?: string;
  destinationKey: string;
  sourceKey: string;
}) {
  const result = await requestStorageBrokerJson<StorageServicePutObjectResponse>({
    body: args,
    path: '/internal/storage/promote',
    tier: 'control',
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
  const result = await requestStorageBrokerJson<StorageServicePutObjectResponse>({
    body: args,
    path: '/internal/storage/reject',
    tier: 'control',
  });
  return {
    VersionId: result.versionId ?? undefined,
  };
}

export async function deleteStorageObject(args: StorageServiceDeleteObjectRequest) {
  await requestStorageBrokerJson<{ ok: true }>({
    body: args,
    path: '/internal/storage/cleanup',
    tier: 'control',
  });
}

export async function listStorageObjects(args: StorageServiceListObjectsRequest) {
  const result = await requestStorageBrokerJson<StorageServiceListObjectsResponse>({
    body: args,
    path: '/internal/storage/list',
    tier: 'control',
  });
  return {
    Contents: result.contents.map((entry) => ({
      Key: entry.key,
      LastModified: entry.lastModified === null ? undefined : new Date(entry.lastModified),
    })),
  };
}

export async function listStorageObjectVersions(args: StorageServiceListObjectVersionsRequest) {
  const result = await requestStorageBrokerJson<StorageServiceListObjectVersionsResponse>({
    body: args,
    path: '/internal/storage/list-object-versions',
    tier: 'control',
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
  return await requestStorageBrokerObjectRead({
    body: {
      bucketKind: 'quarantine',
      key: args.key,
    },
    path: '/internal/storage/object-read',
    tier: 'control',
  });
}

export async function getCleanObject(args: { key: string }) {
  return await requestStorageBrokerObjectRead({
    body: {
      bucketKind: 'clean',
      key: args.key,
    },
    path: '/internal/storage/object-read',
    tier: 'control',
  });
}

export async function getMirrorObject(args: { key: string }) {
  return await requestStorageBrokerObjectRead({
    body: {
      bucketKind: 'mirror',
      key: args.key,
    },
    path: '/internal/storage/object-read',
    tier: 'control',
  });
}
