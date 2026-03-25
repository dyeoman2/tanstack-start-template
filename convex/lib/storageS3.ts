'use node';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getStorageRuntimeConfig } from '../../src/lib/server/env.server';

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

type S3EncryptionSettings = {
  kmsKeyArn: string;
  serverSideEncryption: 'aws:kms';
};

const PRESIGN_EXPIRY_SECONDS = 60 * 60;

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

export function getS3Client(config?: Partial<S3ClientConfig>) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.awsRegion) {
    throw new Error('AWS_REGION environment variable is required for S3 operations.');
  }

  return new S3Client({
    region: runtimeConfig.awsRegion,
    ...config,
  });
}

export function getRequiredS3EncryptionSettings(): S3EncryptionSettings {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.s3FilesKmsKeyArn) {
    throw new Error(
      'AWS_S3_FILES_KMS_KEY_ARN environment variable is required for S3-backed storage.',
    );
  }

  return {
    kmsKeyArn: runtimeConfig.s3FilesKmsKeyArn,
    serverSideEncryption: 'aws:kms',
  };
}

export function getRequiredS3EncryptionHeaders(): Record<string, string> {
  const settings = getRequiredS3EncryptionSettings();
  return {
    'x-amz-server-side-encryption': settings.serverSideEncryption,
    'x-amz-server-side-encryption-aws-kms-key-id': settings.kmsKeyArn,
  };
}

export async function createPresignedS3Url(args: {
  bucket: string;
  contentType?: string;
  expiresInSeconds?: number;
  headers?: Record<string, string>;
  key: string;
  method: 'GET' | 'PUT';
}) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.awsRegion) {
    throw new Error('AWS_REGION environment variable is required for S3 operations.');
  }

  const client = getS3Client();
  const credentials = await resolveCredentials(client);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const host = `${args.bucket}.s3.${runtimeConfig.awsRegion}.amazonaws.com`;
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
    'X-Amz-Credential': `${credentials.accessKeyId}/${dateStamp}/${runtimeConfig.awsRegion}/s3/aws4_request`,
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
    `${dateStamp}/${runtimeConfig.awsRegion}/s3/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(
    credentials.secretAccessKey,
    dateStamp,
    runtimeConfig.awsRegion,
  );
  const signature = Array.from(await hmac(signingKey, stringToSign), (part) =>
    part.toString(16).padStart(2, '0'),
  ).join('');

  const finalQuery = buildCanonicalQueryString({
    ...query,
    'X-Amz-Signature': signature,
  });

  return {
    expiresAt: now.getTime() + (args.expiresInSeconds ?? PRESIGN_EXPIRY_SECONDS) * 1000,
    url: `https://${host}${canonicalUri}?${finalQuery}`,
  };
}

export async function headS3Object(args: { bucket: string; key: string }) {
  const client = getS3Client();
  return await client.send(
    new HeadObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
    }),
  );
}

export async function putS3Object(args: {
  body: Uint8Array;
  bucket: string;
  contentType: string;
  key: string;
}) {
  const client = getS3Client();
  const encryption = getRequiredS3EncryptionSettings();
  return await client.send(
    new PutObjectCommand({
      Body: args.body,
      Bucket: args.bucket,
      ContentType: args.contentType,
      Key: args.key,
      SSEKMSKeyId: encryption.kmsKeyArn,
      ServerSideEncryption: encryption.serverSideEncryption,
    }),
  );
}

export async function copyS3Object(args: {
  bucket: string;
  contentType?: string;
  destinationKey: string;
  sourceBucket: string;
  sourceKey: string;
}) {
  const client = getS3Client();
  const encryption = getRequiredS3EncryptionSettings();
  return await client.send(
    new CopyObjectCommand({
      Bucket: args.bucket,
      ContentType: args.contentType,
      CopySource: encodeS3CopySource(args.sourceBucket, args.sourceKey),
      Key: args.destinationKey,
      MetadataDirective: args.contentType ? 'REPLACE' : 'COPY',
      SSEKMSKeyId: encryption.kmsKeyArn,
      ServerSideEncryption: encryption.serverSideEncryption,
    }),
  );
}

export async function deleteS3Object(args: { bucket: string; key: string; versionId?: string }) {
  const client = getS3Client();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: args.bucket,
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

export async function listS3Objects(args: {
  bucket: string;
  continuationToken?: string;
  maxKeys?: number;
  prefix: string;
}) {
  const client = getS3Client();
  return await client.send(
    new ListObjectsV2Command({
      Bucket: args.bucket,
      ContinuationToken: args.continuationToken,
      MaxKeys: args.maxKeys,
      Prefix: args.prefix,
    }),
  );
}

export async function listS3ObjectVersions(args: { bucket: string; key: string }) {
  const client = getS3Client();
  return await client.send(
    new ListObjectVersionsCommand({
      Bucket: args.bucket,
      MaxKeys: 10,
      Prefix: args.key,
    }),
  );
}

export async function getS3Object(args: { bucket: string; key: string }) {
  const client = getS3Client();
  return await client.send(
    new GetObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
    }),
  );
}
