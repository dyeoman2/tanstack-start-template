'use node';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import type { StorageBucketKind } from '../shared/storage-service-contract';
import type { StorageBucketConfig, StorageCapability } from './storage-service-env';

type AwsCredentials = {
  accessKeyId: string;
  expiration?: Date;
  secretAccessKey: string;
  sessionToken?: string;
};

type S3EncryptionSettings = {
  kmsKeyArn: string;
  serverSideEncryption: 'aws:kms';
};

type CachedCredentials = {
  credentials: AwsCredentials;
  expiresAt: number;
};

type StorageAwsRuntimeConfig = {
  awsRegion: string;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
  storageRoleArns: Partial<Record<StorageCapability, string>>;
};

const PRESIGN_EXPIRY_SECONDS = 60 * 60;
const ASSUME_ROLE_REFRESH_WINDOW_MS = 60 * 1000;
const assumedCredentialsCache = new Map<string, Promise<CachedCredentials>>();
const capabilityClientCache = new Map<string, S3Client>();
const stsClientCache = new Map<string, STSClient>();

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeS3CopySource(bucket: string, key: string) {
  return `${bucket}/${key.split('/').map(encodeRfc3986).join('/')}`;
}

function toAmzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return `${iso.slice(0, 15)}Z`;
}

function toDateStamp(date: Date) {
  return toAmzDate(date).slice(0, 8);
}

async function hmac(key: Uint8Array | string, value: string) {
  const rawKey = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)),
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

async function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, 's3');
  return await hmac(serviceKey, 'aws4_request');
}

function buildCanonicalQueryString(query: Record<string, string>) {
  return Object.entries(query)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function buildCanonicalHeaders(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
}

function buildSignedHeaders(headers: Record<string, string>) {
  return Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort()
    .join(';');
}

function getRequiredCapabilityRoleArn(
  config: StorageAwsRuntimeConfig,
  capability: StorageCapability,
) {
  const roleArn = config.storageRoleArns[capability];
  if (!roleArn) {
    throw new Error(`Storage capability role ARN is required for ${capability}.`);
  }

  return roleArn;
}

function getRequiredBucketConfig(
  config: StorageAwsRuntimeConfig,
  kind: StorageBucketKind,
): { bucket: string } & S3EncryptionSettings {
  const bucketConfig = config.storageBuckets[kind];
  return {
    bucket: bucketConfig.bucket,
    kmsKeyArn: bucketConfig.kmsKeyArn,
    serverSideEncryption: 'aws:kms',
  };
}

function getCapabilityCacheKey(config: StorageAwsRuntimeConfig, capability: StorageCapability) {
  return `${config.awsRegion}:${getRequiredCapabilityRoleArn(config, capability)}`;
}

function getStsClient(config: StorageAwsRuntimeConfig) {
  const cached = stsClientCache.get(config.awsRegion);
  if (cached) {
    return cached;
  }

  const client = new STSClient({ region: config.awsRegion });
  stsClientCache.set(config.awsRegion, client);
  return client;
}

async function getAssumedCredentials(
  config: StorageAwsRuntimeConfig,
  capability: StorageCapability,
): Promise<AwsCredentials> {
  const cacheKey = getCapabilityCacheKey(config, capability);
  const cached = assumedCredentialsCache.get(cacheKey);
  if (cached) {
    const cachedResult = await cached;
    if (cachedResult.expiresAt > Date.now() + ASSUME_ROLE_REFRESH_WINDOW_MS) {
      return cachedResult.credentials;
    }
    assumedCredentialsCache.delete(cacheKey);
  }

  const assumePromise = (async (): Promise<CachedCredentials> => {
    const response = await getStsClient(config).send(
      new AssumeRoleCommand({
        RoleArn: getRequiredCapabilityRoleArn(config, capability),
        RoleSessionName: `storage-${capability}-${Date.now()}`,
      }),
    );
    if (!response.Credentials) {
      throw new Error(`AWS STS AssumeRole returned no credentials for ${capability}.`);
    }

    return {
      credentials: {
        accessKeyId: response.Credentials.AccessKeyId ?? '',
        expiration: response.Credentials.Expiration,
        secretAccessKey: response.Credentials.SecretAccessKey ?? '',
        sessionToken: response.Credentials.SessionToken,
      },
      expiresAt: response.Credentials.Expiration
        ? response.Credentials.Expiration.getTime()
        : Date.now() + 15 * 60 * 1000,
    };
  })();

  assumedCredentialsCache.set(cacheKey, assumePromise);
  try {
    return (await assumePromise).credentials;
  } catch (error) {
    assumedCredentialsCache.delete(cacheKey);
    throw error;
  }
}

async function resolveCredentials(client: S3Client): Promise<AwsCredentials> {
  const credentialsProvider = client.config.credentials;
  if (!credentialsProvider) {
    throw new Error('AWS credentials are not configured for S3 operations.');
  }

  const credentials =
    typeof credentialsProvider === 'function' ? await credentialsProvider() : credentialsProvider;

  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
  };
}

function getCapabilityClient(config: StorageAwsRuntimeConfig, capability: StorageCapability) {
  const cacheKey = getCapabilityCacheKey(config, capability);
  const cached = capabilityClientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new S3Client({
    credentials: async () => await getAssumedCredentials(config, capability),
    region: config.awsRegion,
  });
  capabilityClientCache.set(cacheKey, client);
  return client;
}

export function getRequiredStorageEncryptionHeaders(
  config: StorageAwsRuntimeConfig,
  kind: StorageBucketKind,
) {
  const settings = getRequiredBucketConfig(config, kind);
  return {
    'x-amz-server-side-encryption': settings.serverSideEncryption,
    'x-amz-server-side-encryption-aws-kms-key-id': settings.kmsKeyArn,
  };
}

async function createPresignedStorageUrl(
  config: StorageAwsRuntimeConfig,
  args: {
    bucketKind: StorageBucketKind;
    capability: StorageCapability;
    contentType?: string;
    expiresInSeconds?: number;
    headers?: Record<string, string>;
    key: string;
    method: 'GET' | 'PUT';
  },
) {
  const bucketConfig = getRequiredBucketConfig(config, args.bucketKind);
  const client = getCapabilityClient(config, args.capability);
  const credentials = await resolveCredentials(client);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const host = `${bucketConfig.bucket}.s3.${config.awsRegion}.amazonaws.com`;
  const canonicalUri = `/${args.key.split('/').map(encodeRfc3986).join('/')}`;
  const signedHeaders: Record<string, string> = {
    host,
    ...args.headers,
  };
  if (args.contentType) {
    signedHeaders['content-type'] = args.contentType;
  }
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${dateStamp}/${config.awsRegion}/s3/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(args.expiresInSeconds ?? PRESIGN_EXPIRY_SECONDS),
    'X-Amz-SignedHeaders': buildSignedHeaders(signedHeaders),
  };
  if (credentials.sessionToken) {
    query['X-Amz-Security-Token'] = credentials.sessionToken;
  }

  const canonicalRequest = [
    args.method,
    canonicalUri,
    buildCanonicalQueryString(query),
    buildCanonicalHeaders(signedHeaders),
    buildSignedHeaders(signedHeaders),
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${dateStamp}/${config.awsRegion}/s3/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(
    credentials.secretAccessKey,
    dateStamp,
    config.awsRegion,
  );
  const signature = Array.from(await hmac(signingKey, stringToSign), (part) =>
    part.toString(16).padStart(2, '0'),
  ).join('');

  const finalQuery = buildCanonicalQueryString({
    ...query,
    'X-Amz-Signature': signature,
  });

  return {
    bucket: bucketConfig.bucket,
    expiresAt: now.getTime() + (args.expiresInSeconds ?? PRESIGN_EXPIRY_SECONDS) * 1000,
    url: `https://${host}${canonicalUri}?${finalQuery}`,
  };
}

export async function createQuarantineUploadPresignedUrl(
  config: StorageAwsRuntimeConfig,
  args: {
    contentType?: string;
    expiresInSeconds?: number;
    headers?: Record<string, string>;
    key: string;
  },
) {
  return await createPresignedStorageUrl(config, {
    ...args,
    bucketKind: 'quarantine',
    capability: 'uploadPresign',
    method: 'PUT',
  });
}

export async function createDownloadPresignedStorageUrl(
  config: StorageAwsRuntimeConfig,
  args: {
    bucketKind: 'clean' | 'mirror';
    expiresInSeconds?: number;
    key: string;
  },
) {
  return await createPresignedStorageUrl(config, {
    bucketKind: args.bucketKind,
    capability: 'downloadPresign',
    expiresInSeconds: args.expiresInSeconds,
    key: args.key,
    method: 'GET',
  });
}

async function putStorageObject(
  config: StorageAwsRuntimeConfig,
  args: {
    body: Uint8Array;
    bucketKind: StorageBucketKind;
    capability: StorageCapability;
    contentType: string;
    key: string;
  },
) {
  const encryption = getRequiredBucketConfig(config, args.bucketKind);
  return await getCapabilityClient(config, args.capability).send(
    new PutObjectCommand({
      Body: args.body,
      Bucket: encryption.bucket,
      ContentType: args.contentType,
      Key: args.key,
      SSEKMSKeyId: encryption.kmsKeyArn,
      ServerSideEncryption: encryption.serverSideEncryption,
    }),
  );
}

export async function putMirrorObject(
  config: StorageAwsRuntimeConfig,
  args: {
    body: Uint8Array;
    contentType: string;
    key: string;
  },
) {
  return await putStorageObject(config, {
    ...args,
    bucketKind: 'mirror',
    capability: 'mirror',
  });
}

export async function putCleanObject(
  config: StorageAwsRuntimeConfig,
  args: {
    body: Uint8Array;
    contentType: string;
    key: string;
  },
) {
  return await putStorageObject(config, {
    ...args,
    bucketKind: 'clean',
    capability: 'promotion',
  });
}

async function copyStorageObject(
  config: StorageAwsRuntimeConfig,
  args: {
    capability: StorageCapability;
    contentType?: string;
    destinationBucketKind: StorageBucketKind;
    destinationKey: string;
    sourceBucketKind: StorageBucketKind;
    sourceKey: string;
  },
) {
  const destinationBucket = getRequiredBucketConfig(config, args.destinationBucketKind);
  const sourceBucket = getRequiredBucketConfig(config, args.sourceBucketKind);
  return await getCapabilityClient(config, args.capability).send(
    new CopyObjectCommand({
      Bucket: destinationBucket.bucket,
      ContentType: args.contentType,
      CopySource: encodeS3CopySource(sourceBucket.bucket, args.sourceKey),
      Key: args.destinationKey,
      MetadataDirective: args.contentType ? 'REPLACE' : 'COPY',
      SSEKMSKeyId: destinationBucket.kmsKeyArn,
      ServerSideEncryption: destinationBucket.serverSideEncryption,
    }),
  );
}

export async function promoteQuarantineObject(
  config: StorageAwsRuntimeConfig,
  args: {
    contentType?: string;
    destinationKey: string;
    sourceKey: string;
  },
) {
  return await copyStorageObject(config, {
    capability: 'promotion',
    contentType: args.contentType,
    destinationBucketKind: 'clean',
    destinationKey: args.destinationKey,
    sourceBucketKind: 'quarantine',
    sourceKey: args.sourceKey,
  });
}

export async function rejectQuarantineObject(
  config: StorageAwsRuntimeConfig,
  args: {
    contentType?: string;
    destinationKey: string;
    sourceKey: string;
  },
) {
  return await copyStorageObject(config, {
    capability: 'rejection',
    contentType: args.contentType,
    destinationBucketKind: 'rejected',
    destinationKey: args.destinationKey,
    sourceBucketKind: 'quarantine',
    sourceKey: args.sourceKey,
  });
}

export async function deleteStorageObject(
  config: StorageAwsRuntimeConfig,
  args: {
    bucketKind: StorageBucketKind;
    key: string;
    versionId?: string;
  },
) {
  const bucket = getRequiredBucketConfig(config, args.bucketKind);
  try {
    await getCapabilityClient(config, 'cleanup').send(
      new DeleteObjectCommand({
        Bucket: bucket.bucket,
        Key: args.key,
        VersionId: args.versionId,
      }),
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error.name === 'NoSuchKey' || error.name === 'NoSuchVersion' || error.name === 'NotFound')
    ) {
      return;
    }
    throw error;
  }
}

export async function listStorageObjects(
  config: StorageAwsRuntimeConfig,
  args: {
    bucketKind: StorageBucketKind;
    continuationToken?: string;
    maxKeys?: number;
    prefix: string;
  },
) {
  const bucket = getRequiredBucketConfig(config, args.bucketKind);
  return await getCapabilityClient(config, 'cleanup').send(
    new ListObjectsV2Command({
      Bucket: bucket.bucket,
      ContinuationToken: args.continuationToken,
      MaxKeys: args.maxKeys,
      Prefix: args.prefix,
    }),
  );
}

export async function listStorageObjectVersions(
  config: StorageAwsRuntimeConfig,
  args: {
    bucketKind: StorageBucketKind;
    key: string;
  },
) {
  const bucket = getRequiredBucketConfig(config, args.bucketKind);
  return await getCapabilityClient(config, 'cleanup').send(
    new ListObjectVersionsCommand({
      Bucket: bucket.bucket,
      MaxKeys: 10,
      Prefix: args.key,
    }),
  );
}

export async function getStorageObject(
  config: StorageAwsRuntimeConfig,
  args: {
    bucketKind: StorageBucketKind;
    capability: StorageCapability;
    key: string;
  },
) {
  const bucket = getRequiredBucketConfig(config, args.bucketKind);
  return await getCapabilityClient(config, args.capability).send(
    new GetObjectCommand({
      Bucket: bucket.bucket,
      Key: args.key,
    }),
  );
}
