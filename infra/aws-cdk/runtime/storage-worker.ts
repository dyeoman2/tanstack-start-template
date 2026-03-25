'use node';

import {
  deleteStorageObject,
  getStorageObject,
  listStorageObjectVersions,
  listStorageObjects,
  promoteQuarantineObject,
  putCleanObject,
  putMirrorObject,
  rejectQuarantineObject,
} from '../../../src/lib/server/storage-service-s3';
import {
  assertInternalServiceAuthorization,
  buildInternalServiceAuthorizationHeader,
} from '../../../src/lib/server/internal-service-auth';
import { getStorageWorkerRuntimeConfig } from '../../../src/lib/server/storage-service-env';
import { verifyStorageWebhookSignature } from '../../../src/lib/server/storage-webhook-signature';
import type {
  StorageServiceCopyObjectRequest,
  StorageServiceDeleteObjectRequest,
  StorageServiceGuardDutyCallbackRequest,
  StorageServiceInspectionCallbackRequest,
  StorageServiceListObjectVersionsRequest,
  StorageServiceListObjectsRequest,
  StorageServicePutObjectRequest,
  StorageServiceReadObjectRequest,
} from '../../../src/lib/shared/storage-service-contract';
import {
  parseGuardDutyWebhookPayload,
  parseStorageInspectionWebhookPayload,
} from '../../../src/lib/shared/storage-webhook-payload';

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

async function postConvexCallback<T>(
  path: string,
  payload: T,
  baseUrl: string,
  sharedSecret: string,
) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Authorization: buildInternalServiceAuthorizationHeader(sharedSecret),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return await response.json();
}

export async function handler(event: LambdaFunctionUrlEvent) {
  try {
    const path = event.rawPath ?? '/';
    const method = event.requestContext?.http?.method ?? 'GET';
    const config = getStorageWorkerRuntimeConfig();
    const awsConfig = {
      awsRegion: config.awsRegion,
      storageBuckets: config.storageBuckets,
      storageRoleArns: config.storageRoleArns,
    };

    if (method !== 'POST') {
      return json(405, { error: 'Method not allowed.' });
    }

    if (path === '/webhooks/guardduty' || path === '/webhooks/storage-inspection') {
      const rawBody = event.body ?? '';
      const decodedBody = event.isBase64Encoded
        ? Buffer.from(rawBody, 'base64').toString('utf8')
        : rawBody;
      await verifyStorageWebhookSignature({
        payload: decodedBody,
        sharedSecret:
          path === '/webhooks/guardduty'
            ? config.guardDutyWebhookSharedSecret
            : config.inspectionWebhookSharedSecret,
        signature:
          event.headers?.['x-scriptflow-signature'] ??
          event.headers?.['X-Scriptflow-Signature'] ??
          null,
        timestamp:
          event.headers?.['x-scriptflow-timestamp'] ??
          event.headers?.['X-Scriptflow-Timestamp'] ??
          null,
      });

      if (path === '/webhooks/guardduty') {
        const payload = parseGuardDutyWebhookPayload(decodedBody);
        return json(
          200,
          await postConvexCallback<StorageServiceGuardDutyCallbackRequest>(
            '/internal/storage/guardduty',
            payload,
            config.convexCallbackBaseUrl,
            config.convexCallbackSharedSecret,
          ),
        );
      }

      const payload = parseStorageInspectionWebhookPayload(decodedBody);
      return json(
        200,
        await postConvexCallback<StorageServiceInspectionCallbackRequest>(
          '/internal/storage/inspection',
          payload,
          config.convexCallbackBaseUrl,
          config.convexCallbackSharedSecret,
        ),
      );
    }

    assertInternalServiceAuthorization({
      authorizationHeader: event.headers?.authorization ?? event.headers?.Authorization ?? null,
      expectedSecret: config.serviceSharedSecret,
    });

    if (path === '/internal/storage/promote') {
      const body = parseJsonBody<StorageServiceCopyObjectRequest>(event);
      const result = await promoteQuarantineObject(awsConfig, body);
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/reject') {
      const body = parseJsonBody<StorageServiceCopyObjectRequest>(event);
      const result = await rejectQuarantineObject(awsConfig, body);
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/mirror') {
      const body = parseJsonBody<StorageServicePutObjectRequest>(event);
      const result = await putMirrorObject(awsConfig, {
        body: Buffer.from(body.bodyBase64, 'base64'),
        contentType: body.contentType,
        key: body.key,
      });
      return json(200, { versionId: result.VersionId ?? null });
    }

    if (path === '/internal/storage/clean-put') {
      const body = parseJsonBody<StorageServicePutObjectRequest>(event);
      const result = await putCleanObject(awsConfig, {
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
        await deleteStorageObject(awsConfig, payload);
        return json(200, { ok: true });
      }

      if (payload.operation === 'listObjects') {
        const result = await listStorageObjects(awsConfig, payload);
        return json(200, {
          contents: (result.Contents ?? []).map((entry) => ({
            key: entry.Key ?? '',
            lastModified: entry.LastModified?.getTime() ?? null,
          })),
        });
      }

      const result = await listStorageObjectVersions(awsConfig, payload);
      return json(200, {
        versions: (result.Versions ?? []).map((entry) => ({
          isLatest: entry.IsLatest ?? false,
          key: entry.Key ?? null,
          lastModified: entry.LastModified?.getTime() ?? null,
          versionId: entry.VersionId ?? null,
        })),
      });
    }

    if (path === '/internal/storage/object-read') {
      const body = parseJsonBody<StorageServiceReadObjectRequest>(event);
      const object = await getStorageObject(awsConfig, {
        bucketKind: body.bucketKind,
        capability: 'cleanup',
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
      error: error instanceof Error ? error.message : 'Storage worker request failed.',
    });
  }
}
