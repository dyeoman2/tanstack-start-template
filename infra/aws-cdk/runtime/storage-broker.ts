'use node';

import {
  createDownloadPresignedStorageUrl,
  createQuarantineUploadPresignedUrl,
  getStorageObject,
} from '../../../src/lib/server/storage-service-s3';
import { assertInternalServiceAuthorization } from '../../../src/lib/server/internal-service-auth';
import { getStorageBrokerRuntimeConfig } from '../../../src/lib/server/storage-service-env';
import type {
  StorageServiceDownloadUrlRequest,
  StorageServiceReadObjectRequest,
  StorageServiceUploadTargetRequest,
} from '../../../src/lib/shared/storage-service-contract';

type LambdaFunctionUrlEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
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

function parseJsonBody<T>(event: LambdaFunctionUrlEvent): T {
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

export async function handler(event: LambdaFunctionUrlEvent) {
  try {
    const path = event.rawPath ?? '/';
    const method = event.requestContext?.http?.method ?? 'GET';
    const config = getStorageBrokerRuntimeConfig();
    const awsConfig = {
      awsRegion: config.awsRegion,
      storageBuckets: config.storageBuckets,
      storageRoleArns: config.storageRoleArns,
    };

    if (method !== 'POST') {
      return json(405, { error: 'Method not allowed.' });
    }

    assertInternalServiceAuthorization({
      authorizationHeader: event.headers?.authorization ?? event.headers?.Authorization ?? null,
      expectedSecret: config.serviceSharedSecret,
    });

    if (path === '/internal/storage/upload-target') {
      const body = parseJsonBody<StorageServiceUploadTargetRequest>(event);
      return json(200, await createQuarantineUploadPresignedUrl(awsConfig, body));
    }

    if (
      path === '/internal/storage/download-url' ||
      path === '/internal/storage/file-ticket/redeem'
    ) {
      const body = parseJsonBody<StorageServiceDownloadUrlRequest>(event);
      return json(200, await createDownloadPresignedStorageUrl(awsConfig, body));
    }

    if (path === '/internal/storage/object-read') {
      const body = parseJsonBody<StorageServiceReadObjectRequest>(event);
      if (body.bucketKind !== 'clean' && body.bucketKind !== 'mirror') {
        return json(400, { error: 'Broker can only read clean or mirror objects.' });
      }
      const object = await getStorageObject(awsConfig, {
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

    return json(404, { error: 'Not found.' });
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : 'Storage broker request failed.',
    });
  }
}
