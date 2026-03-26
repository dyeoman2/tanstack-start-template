import { type StorageBucketKind } from '../shared/storage-service-contract';

export type StorageBucketConfig = {
  bucket: string;
  kmsKeyArn: string;
};

export type StorageCapability =
  | 'cleanPut'
  | 'cleanup'
  | 'downloadPresign'
  | 'mirror'
  | 'promotion'
  | 'rejection'
  | 'uploadPresign';

export type StorageRoleConfig = Record<StorageCapability, string>;

export type StorageBrokerRuntimeConfig = {
  awsRegion: string;
  brokerAssertionSecrets: Record<'control' | 'edge', string>;
  brokerInvokeRoleArns: Record<'control' | 'edge', string>;
  documentParseQueueUrl: string;
  fileServeSigningSecret: string;
  inspectionQueueUrl: string;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
  storageRoleArns: Pick<
    StorageRoleConfig,
    | 'cleanPut'
    | 'cleanup'
    | 'downloadPresign'
    | 'mirror'
    | 'promotion'
    | 'rejection'
    | 'uploadPresign'
  >;
};

export type StorageInspectionWorkerRuntimeConfig = {
  awsRegion: string;
  callbackBaseUrl: string;
  callbackSecret: string;
  defaultMaxBytes: number;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
};

export type StorageDecisionWorkerRuntimeConfig = {
  awsRegion: string;
  callbackBaseUrl: string;
  callbackSecret: string;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
};

export type DocumentParserWorkerRuntimeConfig = {
  awsRegion: string;
  callbackBaseUrl: string;
  callbackSecret: string;
  documentParseJsonResultMaxBytes: number;
  documentParseTextResultMaxBytes: number;
  stagingPrefix: string;
  storageBuckets: Record<StorageBucketKind, StorageBucketConfig>;
};

function readRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} environment variable must be a positive integer.`);
  }
  return parsed;
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

function readStorageBuckets() {
  return {
    clean: readBucketConfig('clean'),
    mirror: readBucketConfig('mirror'),
    quarantine: readBucketConfig('quarantine'),
    rejected: readBucketConfig('rejected'),
  };
}

export function getStorageBrokerRuntimeConfig(): StorageBrokerRuntimeConfig {
  assertNoLegacyWebhookSecret();
  return {
    awsRegion: readRequiredEnv('AWS_REGION'),
    brokerAssertionSecrets: {
      control: readRequiredEnv('AWS_STORAGE_BROKER_CONTROL_ASSERTION_SECRET'),
      edge: readRequiredEnv('AWS_STORAGE_BROKER_EDGE_ASSERTION_SECRET'),
    },
    brokerInvokeRoleArns: {
      control: readRequiredEnv('AWS_STORAGE_BROKER_CONTROL_INVOKE_ROLE_ARN'),
      edge: readRequiredEnv('AWS_STORAGE_BROKER_EDGE_INVOKE_ROLE_ARN'),
    },
    documentParseQueueUrl: readRequiredEnv('AWS_DOCUMENT_PARSE_QUEUE_URL'),
    fileServeSigningSecret: readRequiredEnv('AWS_FILE_SERVE_SIGNING_SECRET'),
    inspectionQueueUrl: readRequiredEnv('AWS_STORAGE_INSPECTION_QUEUE_URL'),
    storageBuckets: readStorageBuckets(),
    storageRoleArns: {
      cleanPut: readStorageRoleArn('cleanPut'),
      cleanup: readStorageRoleArn('cleanup'),
      downloadPresign: readStorageRoleArn('downloadPresign'),
      mirror: readStorageRoleArn('mirror'),
      promotion: readStorageRoleArn('promotion'),
      rejection: readStorageRoleArn('rejection'),
      uploadPresign: readStorageRoleArn('uploadPresign'),
    },
  };
}

export function getStorageInspectionWorkerRuntimeConfig(): StorageInspectionWorkerRuntimeConfig {
  assertNoLegacyWebhookSecret();
  return {
    awsRegion: readRequiredEnv('AWS_REGION'),
    callbackBaseUrl: readRequiredEnv('CONVEX_STORAGE_CALLBACK_BASE_URL'),
    callbackSecret: readRequiredEnv('CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET'),
    defaultMaxBytes: readPositiveIntegerEnv('FILE_UPLOAD_MAX_BYTES', 10 * 1024 * 1024),
    storageBuckets: readStorageBuckets(),
  };
}

export function getStorageDecisionWorkerRuntimeConfig(): StorageDecisionWorkerRuntimeConfig {
  assertNoLegacyWebhookSecret();
  return {
    awsRegion: readRequiredEnv('AWS_REGION'),
    callbackBaseUrl: readRequiredEnv('CONVEX_STORAGE_CALLBACK_BASE_URL'),
    callbackSecret: readRequiredEnv('CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET'),
    storageBuckets: readStorageBuckets(),
  };
}

export function getDocumentParserWorkerRuntimeConfig(): DocumentParserWorkerRuntimeConfig {
  assertNoLegacyWebhookSecret();
  return {
    awsRegion: readRequiredEnv('AWS_REGION'),
    callbackBaseUrl: readRequiredEnv('CONVEX_STORAGE_CALLBACK_BASE_URL'),
    callbackSecret: readRequiredEnv('CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET'),
    documentParseJsonResultMaxBytes: readPositiveIntegerEnv(
      'AWS_DOCUMENT_PARSE_JSON_RESULT_MAX_BYTES',
      25 * 1024 * 1024,
    ),
    documentParseTextResultMaxBytes: readPositiveIntegerEnv(
      'AWS_DOCUMENT_PARSE_TEXT_RESULT_MAX_BYTES',
      10 * 1024 * 1024,
    ),
    stagingPrefix:
      process.env.AWS_DOCUMENT_RESULT_STAGING_PREFIX?.trim() || 'quarantine/parser-results/',
    storageBuckets: readStorageBuckets(),
  };
}
