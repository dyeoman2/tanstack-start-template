'use node';

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  createDownloadPresignedStorageUrl,
  createQuarantineUploadPresignedUrl,
  deleteStorageObject,
  getStorageObject,
  listStorageObjectVersions,
  listStorageObjects,
  promoteQuarantineObject,
  putCleanObject,
  putMirrorObject,
  rejectQuarantineObject,
} from '../../../src/lib/server/storage-service-s3';
import { getStorageBrokerRuntimeConfig } from '../../../src/lib/server/storage-service-env';
import type {
  DocumentParseQueueMessage,
  StorageDecisionQueueMessage,
  StorageInspectionQueueMessage,
  StorageServiceDeleteObjectRequest,
  StorageServiceDownloadUrlRequest,
  StorageServiceListObjectVersionsRequest,
  StorageServiceListObjectsRequest,
  StorageServiceCopyObjectRequest,
  StorageServicePutObjectRequest,
  StorageServiceReadObjectRequest,
  StorageServiceUploadTargetRequest,
} from '../../../src/lib/shared/storage-service-contract';

type ApiGatewayEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
  path?: string;
  rawPath?: string;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

function json(statusCode: number, body: unknown) {
  return {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
    statusCode,
  };
}

function parseJsonBody<T>(event: ApiGatewayEvent): T {
  const rawBody = event.body ?? '';
  const decoded = event.isBase64Encoded ? Buffer.from(rawBody, 'base64').toString('utf8') : rawBody;
  return JSON.parse(decoded) as T;
}

async function readBodyAsBytes(body: unknown) {
  if (!body) {
    return new Uint8Array();
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    return await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
  }
  if (typeof body === 'object' && body !== null && 'transformToWebStream' in body) {
    const stream = (
      body as { transformToWebStream: () => ReadableStream<Uint8Array> }
    ).transformToWebStream();
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      chunks.push(result.value);
      totalLength += result.value.byteLength;
    }
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  throw new Error('Storage object body could not be read.');
}

function getAwsConfig() {
  const config = getStorageBrokerRuntimeConfig();
  return {
    awsRegion: config.awsRegion,
    brokerConfig: config,
    sqs: new SQSClient({ region: config.awsRegion }),
    storageConfig: {
      awsRegion: config.awsRegion,
      storageBuckets: config.storageBuckets,
      storageRoleArns: config.storageRoleArns,
    },
  };
}

async function enqueueMessage(
  sqs: SQSClient,
  queueUrl: string,
  payload: DocumentParseQueueMessage | StorageDecisionQueueMessage | StorageInspectionQueueMessage,
) {
  await sqs.send(
    new SendMessageCommand({
      MessageBody: JSON.stringify(payload),
      QueueUrl: queueUrl,
    }),
  );
  return {
    accepted: true as const,
  };
}

export async function handler(event: ApiGatewayEvent) {
  try {
    const path = event.path ?? event.rawPath ?? '/';
    const method = event.httpMethod ?? event.requestContext?.http?.method ?? 'GET';
    const { brokerConfig, sqs, storageConfig } = getAwsConfig();

    if (method !== 'POST') {
      return json(405, { error: 'Method not allowed.' });
    }

    if (path === '/internal/storage/upload-target') {
      const body = parseJsonBody<StorageServiceUploadTargetRequest>(event);
      return json(200, await createQuarantineUploadPresignedUrl(storageConfig, body));
    }

    if (
      path === '/internal/storage/download-url' ||
      path === '/internal/storage/file-ticket/redeem'
    ) {
      const body = parseJsonBody<StorageServiceDownloadUrlRequest>(event);
      return json(200, await createDownloadPresignedStorageUrl(storageConfig, body));
    }

    if (path === '/internal/storage/object-read') {
      const body = parseJsonBody<StorageServiceReadObjectRequest>(event);
      const object = await getStorageObject(storageConfig, {
        bucketKind: body.bucketKind,
        capability: 'downloadPresign',
        key: body.key,
      });
      const bytes = await readBodyAsBytes(object.Body);
      return {
        body: Buffer.from(bytes).toString('base64'),
        headers: {
          'content-type': object.ContentType ?? 'application/octet-stream',
          'x-storage-version-id': object.VersionId ?? '',
        },
        isBase64Encoded: true,
        statusCode: 200,
      };
    }

    if (path === '/internal/storage/clean-put') {
      const body = parseJsonBody<StorageServicePutObjectRequest>(event);
      const result = await putCleanObject(storageConfig, {
        body: Buffer.from(body.bodyBase64, 'base64'),
        contentType: body.contentType,
        key: body.key,
      });
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/promote') {
      const body = parseJsonBody<StorageServiceCopyObjectRequest>(event);
      const result = await promoteQuarantineObject(storageConfig, body);
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/reject') {
      const body = parseJsonBody<StorageServiceCopyObjectRequest>(event);
      const result = await rejectQuarantineObject(storageConfig, body);
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/mirror-put') {
      const body = parseJsonBody<StorageServicePutObjectRequest>(event);
      const result = await putMirrorObject(storageConfig, {
        body: Buffer.from(body.bodyBase64, 'base64'),
        contentType: body.contentType,
        key: body.key,
      });
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/cleanup') {
      const payload = parseJsonBody<
        | ({ operation: 'deleteObject' } & StorageServiceDeleteObjectRequest)
        | ({ operation: 'listObjects' } & StorageServiceListObjectsRequest)
        | ({ operation: 'listObjectVersions' } & StorageServiceListObjectVersionsRequest)
      >(event);

      if (payload.operation === 'deleteObject') {
        await deleteStorageObject(storageConfig, payload);
        return json(200, { ok: true });
      }

      if (payload.operation === 'listObjects') {
        const result = await listStorageObjects(storageConfig, payload);
        return json(200, {
          contents: (result.Contents ?? []).map((entry) => ({
            key: entry.Key ?? '',
            lastModified: entry.LastModified?.getTime() ?? null,
          })),
        });
      }

      const result = await listStorageObjectVersions(storageConfig, payload);
      return json(200, {
        versions: (result.Versions ?? []).map((entry) => ({
          isLatest: entry.IsLatest ?? false,
          key: entry.Key ?? null,
          lastModified: entry.LastModified?.getTime() ?? null,
          versionId: entry.VersionId ?? null,
        })),
      });
    }

    if (path === '/internal/storage/enqueue-inspection') {
      const body = parseJsonBody<StorageInspectionQueueMessage>(event);
      return json(200, await enqueueMessage(sqs, brokerConfig.inspectionQueueUrl, body));
    }

    if (path === '/internal/storage/enqueue-decision') {
      const body = parseJsonBody<StorageDecisionQueueMessage>(event);
      return json(200, await enqueueMessage(sqs, brokerConfig.decisionQueueUrl, body));
    }

    if (path === '/internal/storage/enqueue-document-parse') {
      const body = parseJsonBody<DocumentParseQueueMessage>(event);
      return json(200, await enqueueMessage(sqs, brokerConfig.documentParseQueueUrl, body));
    }

    return json(404, { error: 'Not found.' });
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : 'Storage broker request failed.',
    });
  }
}
