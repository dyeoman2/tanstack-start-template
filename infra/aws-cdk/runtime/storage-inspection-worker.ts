'use node';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getStorageInspectionWorkerRuntimeConfig } from '../../../src/lib/server/storage-service-env';
import { inspectStorageUploadBytes } from '../../../src/lib/server/storage-inspection-policy';
import { createStorageWebhookSignature } from '../../../src/lib/server/storage-webhook-signature';
import type { StorageInspectionQueueMessage } from '../../../src/lib/shared/storage-service-contract';

type SqsEvent = {
  Records?: Array<{
    body?: string;
  }>;
};

async function readObjectBytes(client: S3Client, bucket: string, key: string) {
  const object = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const body: unknown = object.Body;
  if (!body) {
    throw new Error('Storage inspection object body is empty.');
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    return await (
      body as {
        transformToByteArray: () => Promise<Uint8Array>;
      }
    ).transformToByteArray();
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (typeof Blob !== 'undefined' && (body as Blob) instanceof Blob) {
    return new Uint8Array(await (body as Blob).arrayBuffer());
  }
  throw new Error('Storage inspection object body could not be read.');
}

async function postSignedCallback(args: {
  baseUrl: string;
  path: string;
  payload: unknown;
  secret: string;
}) {
  const body = JSON.stringify(args.payload);
  const timestamp = String(Date.now());
  const signature = await createStorageWebhookSignature(args.secret, `${timestamp}.${body}`);
  const response = await fetch(`${args.baseUrl.replace(/\/+$/, '')}${args.path}`, {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Scriptflow-Signature': signature,
      'X-Scriptflow-Timestamp': timestamp,
    },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function handler(event: SqsEvent) {
  const config = getStorageInspectionWorkerRuntimeConfig();
  const client = new S3Client({ region: config.awsRegion });
  const records = Array.isArray(event.Records) ? event.Records : [];

  for (const record of records) {
    const payload = JSON.parse(record.body ?? '{}') as StorageInspectionQueueMessage;
    if (payload.kind !== 'storage_inspection') {
      continue;
    }

    const bytes = await readObjectBytes(client, payload.bucket, payload.key);
    const result = await inspectStorageUploadBytes({
      allowedKinds: ['document', 'image', 'pdf'],
      bytes,
      fileName: payload.fileName,
      maxBytes: payload.maxBytes || config.defaultMaxBytes,
      mimeType: payload.mimeType,
      sha256Hex: payload.sha256Hex,
    });

    await postSignedCallback({
      baseUrl: config.callbackBaseUrl,
      path: '/internal/storage/inspection-result',
      payload: {
        type: 'inspection_result',
        storageId: payload.storageId,
        details: result.details,
        engine: result.engine,
        reason: result.reason,
        scannedAt: result.inspectedAt,
        status: result.status,
      },
      secret: config.callbackSecret,
    });
  }
}
