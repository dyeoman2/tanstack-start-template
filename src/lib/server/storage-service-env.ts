import { type StorageBucketKind } from '../shared/storage-service-contract';

export type StorageBucketConfig = {
  bucket: string;
  kmsKeyArn: string;
};

export type StorageCapability =
  | 'cleanup'
  | 'downloadPresign'
  | 'mirror'
  | 'promotion'
  | 'rejection'
  | 'uploadPresign';

export type StorageRoleConfig = Record<StorageCapability, string>;

export type StorageBrokerRuntimeConfig = {
  awsRegion: string;
  fileServeSigningSecret: string;
  serviceSharedSecret: string;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
  storageRoleArns: Pick<StorageRoleConfig, 'downloadPresign' | 'uploadPresign'>;
};

export type StorageWorkerRuntimeConfig = {
  awsRegion: string;
  convexCallbackBaseUrl: string;
  convexCallbackSharedSecret: string;
  guardDutyWebhookSharedSecret: string;
  inspectionWebhookSharedSecret: string;
  serviceSharedSecret: string;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
  storageRoleArns: Pick<StorageRoleConfig, 'cleanup' | 'mirror' | 'promotion' | 'rejection'>;
};

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value;
}

function assertNoLegacyWebhookSecret() {
  if (process.env.AWS_MALWARE_WEBHOOK_SHARED_SECRET?.trim()) {
    throw new Error(
      'AWS_MALWARE_WEBHOOK_SHARED_SECRET is no longer supported. Configure AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET and AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET instead.',
    );
  }
}

function readBucketConfig(kind: StorageBucketKind): StorageBucketConfig {
  return {
    bucket: readRequiredEnv(`AWS_S3_${kind.toUpperCase()}_BUCKET`),
    kmsKeyArn: readRequiredEnv(`AWS_S3_${kind.toUpperCase()}_KMS_KEY_ARN`),
  };
}

function readStorageRoleArn(capability: StorageCapability) {
  return readRequiredEnv(
    `AWS_STORAGE_ROLE_ARN_${capability.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()}`,
  );
}

export function getStorageBrokerRuntimeConfig(): StorageBrokerRuntimeConfig {
  assertNoLegacyWebhookSecret();
  return {
    awsRegion: readRequiredEnv('AWS_REGION'),
    fileServeSigningSecret: readRequiredEnv('AWS_FILE_SERVE_SIGNING_SECRET'),
    serviceSharedSecret: readRequiredEnv('STORAGE_BROKER_SHARED_SECRET'),
    storageBuckets: {
      clean: readBucketConfig('clean'),
      mirror: readBucketConfig('mirror'),
      quarantine: readBucketConfig('quarantine'),
      rejected: readBucketConfig('rejected'),
    },
    storageRoleArns: {
      downloadPresign: readStorageRoleArn('downloadPresign'),
      uploadPresign: readStorageRoleArn('uploadPresign'),
    },
  };
}

export function getStorageWorkerRuntimeConfig(): StorageWorkerRuntimeConfig {
  assertNoLegacyWebhookSecret();
  return {
    awsRegion: readRequiredEnv('AWS_REGION'),
    convexCallbackBaseUrl: readRequiredEnv('CONVEX_STORAGE_CALLBACK_BASE_URL'),
    convexCallbackSharedSecret: readRequiredEnv('CONVEX_STORAGE_CALLBACK_SHARED_SECRET'),
    guardDutyWebhookSharedSecret: readRequiredEnv('AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET'),
    inspectionWebhookSharedSecret: readRequiredEnv('AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET'),
    serviceSharedSecret: readRequiredEnv('STORAGE_WORKER_SHARED_SECRET'),
    storageBuckets: {
      clean: readBucketConfig('clean'),
      mirror: readBucketConfig('mirror'),
      quarantine: readBucketConfig('quarantine'),
      rejected: readBucketConfig('rejected'),
    },
    storageRoleArns: {
      cleanup: readStorageRoleArn('cleanup'),
      mirror: readStorageRoleArn('mirror'),
      promotion: readStorageRoleArn('promotion'),
      rejection: readStorageRoleArn('rejection'),
    },
  };
}
