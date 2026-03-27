'use node';

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import {
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { getAuditArchiveRuntimeConfig } from '../../src/lib/server/env.server';

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

type CachedCredentials = {
  credentials: AwsCredentials;
  expiresAt: number;
};

const ASSUME_ROLE_REFRESH_WINDOW_MS = 60 * 1000;
export const AUDIT_ARCHIVE_METRIC_NAMESPACE = 'TanStackStart/AuditArchive';

let cachedClient: S3Client | null = null;
let cachedCloudWatchClient: CloudWatchClient | null = null;
let cachedStsClient: STSClient | null = null;
let cachedCredentialsPromise: Promise<CachedCredentials> | null = null;

function getRequiredArchiveConfig(): {
  awsRegion: string;
  bucket: string;
  kmsKeyArn: string;
  prefix: string;
  roleArn: string;
} {
  const config = getAuditArchiveRuntimeConfig();
  if (!config.awsRegion || !config.bucket || !config.kmsKeyArn || !config.roleArn) {
    throw new Error('Audit archive runtime config is incomplete.');
  }
  return {
    awsRegion: config.awsRegion,
    bucket: config.bucket,
    kmsKeyArn: config.kmsKeyArn,
    prefix: config.prefix,
    roleArn: config.roleArn,
  };
}

function getStsClient() {
  const { awsRegion } = getRequiredArchiveConfig();
  if (cachedStsClient) {
    return cachedStsClient;
  }

  cachedStsClient = new STSClient({ region: awsRegion });
  return cachedStsClient;
}

async function getArchiveCredentials(): Promise<AwsCredentials> {
  const cached = cachedCredentialsPromise;
  if (cached) {
    const result = await cached;
    if (result.expiresAt > Date.now() + ASSUME_ROLE_REFRESH_WINDOW_MS) {
      return result.credentials;
    }
    cachedCredentialsPromise = null;
  }

  const config = getRequiredArchiveConfig();
  const roleArn = config.roleArn;
  const assumePromise = (async (): Promise<CachedCredentials> => {
    const response = await getStsClient().send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `audit-archive-${Date.now()}`,
      }),
    );
    if (!response.Credentials) {
      throw new Error('AWS STS AssumeRole returned no credentials for audit archive.');
    }

    return {
      credentials: {
        accessKeyId: response.Credentials.AccessKeyId ?? '',
        secretAccessKey: response.Credentials.SecretAccessKey ?? '',
        sessionToken: response.Credentials.SessionToken,
      },
      expiresAt: response.Credentials.Expiration
        ? response.Credentials.Expiration.getTime()
        : Date.now() + 15 * 60 * 1000,
    };
  })();

  cachedCredentialsPromise = assumePromise;
  try {
    return (await assumePromise).credentials;
  } catch (error) {
    cachedCredentialsPromise = null;
    throw error;
  }
}

function getAuditArchiveClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const { awsRegion } = getRequiredArchiveConfig();
  cachedClient = new S3Client({
    credentials: async () => await getArchiveCredentials(),
    region: awsRegion,
  });
  return cachedClient;
}

function getAuditArchiveCloudWatchClient() {
  if (cachedCloudWatchClient) {
    return cachedCloudWatchClient;
  }

  const { awsRegion } = getRequiredArchiveConfig();
  cachedCloudWatchClient = new CloudWatchClient({
    credentials: async () => await getArchiveCredentials(),
    region: awsRegion,
  });
  return cachedCloudWatchClient;
}

export async function headAuditArchiveObject(args: { key: string }) {
  const { bucket } = getRequiredArchiveConfig();
  return await getAuditArchiveClient().send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: args.key,
    }),
  );
}

export async function getAuditArchiveObjectMetadata(args: { key: string }) {
  const object = await headAuditArchiveObject(args);
  return {
    bucket: getRequiredArchiveConfig().bucket,
    eTag: object.ETag ?? null,
    key: args.key,
    lastModified: object.LastModified?.getTime() ?? null,
    versionId: object.VersionId ?? null,
  };
}

export async function getAuditArchiveObjectBytes(args: { key: string }) {
  const { bucket } = getRequiredArchiveConfig();
  const response = await getAuditArchiveClient().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: args.key,
    }),
  );
  if (!response.Body) {
    throw new Error(`Audit archive object body missing for ${args.key}.`);
  }

  return await response.Body.transformToByteArray();
}

export async function putAuditArchiveObject(args: {
  body: Uint8Array;
  contentEncoding?: string;
  contentType: string;
  key: string;
}) {
  const { bucket, kmsKeyArn } = getRequiredArchiveConfig();
  return await getAuditArchiveClient().send(
    new PutObjectCommand({
      Body: args.body,
      Bucket: bucket,
      ContentEncoding: args.contentEncoding,
      ContentType: args.contentType,
      Key: args.key,
      SSEKMSKeyId: kmsKeyArn,
      ServerSideEncryption: 'aws:kms',
    }),
  );
}

export type AuditArchiveObjectLockStatus = {
  enabled: boolean;
  mode: string | null;
  retentionDays: number | null;
};

export async function verifyAuditArchiveBucketObjectLock(): Promise<AuditArchiveObjectLockStatus> {
  const { bucket } = getRequiredArchiveConfig();
  const response = await getAuditArchiveClient().send(
    new GetObjectLockConfigurationCommand({ Bucket: bucket }),
  );

  const rule = response.ObjectLockConfiguration?.Rule?.DefaultRetention;
  const enabled =
    response.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled' && rule !== undefined;

  return {
    enabled,
    mode: rule?.Mode ?? null,
    retentionDays: rule?.Days ?? null,
  };
}

export async function putAuditArchiveMetricData(args: {
  bucketName: string;
  metrics: Array<{
    metricName: string;
    unit: 'Count' | 'None';
    value: number;
  }>;
}) {
  if (args.metrics.length === 0) {
    return;
  }

  await getAuditArchiveCloudWatchClient().send(
    new PutMetricDataCommand({
      MetricData: args.metrics.map((metric) => ({
        Dimensions: [{ Name: 'BucketName', Value: args.bucketName }],
        MetricName: metric.metricName,
        Timestamp: new Date(),
        Unit: metric.unit,
        Value: metric.value,
      })),
      Namespace: AUDIT_ARCHIVE_METRIC_NAMESPACE,
    }),
  );
}
