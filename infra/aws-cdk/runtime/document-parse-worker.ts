'use node';

import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ParseResult } from 'papaparse';
import { getDocumentParserWorkerRuntimeConfig } from '../../../src/lib/server/storage-service-env';
import { parsePdfBlob } from '../../../src/lib/server/pdf-parse.server';
import { createStorageWebhookSignature } from '../../../src/lib/server/storage-webhook-signature';
import {
  buildDocumentParseResultStagingKey,
  getDocumentParseResultContentType,
  type DocumentParseQueueMessage,
} from '../../../src/lib/shared/storage-service-contract';

type SqsEvent = {
  Records?: Array<{
    body?: string;
  }>;
};

function formatRowsAsTable(rows: unknown[][], addSeparatorAfterHeader = true) {
  let content = '';

  rows.forEach((row, index) => {
    if (!Array.isArray(row)) {
      return;
    }

    content += `${row.join(' | ')}\n`;
    if (addSeparatorAfterHeader && index === 0) {
      content += `${'-'.repeat(50)}\n`;
    }
  });

  return content;
}

async function readObjectBlob(client: S3Client, bucket: string, key: string, mimeType: string) {
  const object = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
  const body = object.Body;
  if (!body) {
    throw new Error('Document parse object body is empty.');
  }
  if (body instanceof Blob) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new Blob([Buffer.from(body)], { type: mimeType });
  }
  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const bytes = await (
      body as {
        transformToByteArray: () => Promise<Uint8Array>;
      }
    ).transformToByteArray();
    return new Blob([Buffer.from(bytes)], { type: mimeType });
  }
  if (typeof body === 'object' && body !== null && 'transformToString' in body) {
    const text = await (body as { transformToString: () => Promise<string> }).transformToString();
    return new Blob([text], { type: mimeType });
  }
  throw new Error('Document parse object body could not be read.');
}

async function parseChatDocument(blob: Blob, fileName: string, mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase().split(';', 1)[0] ?? '';
  const normalizedFileName = fileName.toLowerCase();

  if (normalizedMimeType === 'application/pdf' || normalizedFileName.endsWith('.pdf')) {
    const parsed = await parsePdfBlob(blob);
    return `[PDF File: ${fileName}]\n\nPages: ${parsed.pages}\n\n${parsed.content}`;
  }

  if (normalizedMimeType === 'text/csv' || normalizedFileName.endsWith('.csv')) {
    const Papa = await import('papaparse');
    const csvText = await blob.text();
    return await new Promise<string>((resolve, reject) => {
      Papa.parse<unknown[]>(csvText, {
        worker: false,
        complete: (results: ParseResult<unknown[]>) => {
          let content = `[CSV File: ${fileName}]\n\n`;
          if (results.data && results.data.length > 0) {
            content += formatRowsAsTable(results.data as unknown[][]);
          }

          resolve(content);
        },
        error: (error: Error) => reject(error),
      });
    });
  }

  if (normalizedMimeType === 'text/plain' || normalizedFileName.endsWith('.txt')) {
    return await blob.text();
  }

  throw new Error('Unsupported document type for chat extraction.');
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

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function handler(event: SqsEvent) {
  const config = getDocumentParserWorkerRuntimeConfig();
  const client = new S3Client({ region: config.awsRegion });
  const records = Array.isArray(event.Records) ? event.Records : [];

  for (const record of records) {
    const payload = JSON.parse(record.body ?? '{}') as DocumentParseQueueMessage;
    if (payload.kind !== 'document_parse') {
      continue;
    }

    try {
      const blob = await readObjectBlob(
        client,
        config.storageBuckets.clean.bucket,
        payload.canonicalKey,
        payload.mimeType,
      );

      if (payload.parseKind === 'pdf_parse') {
        const parsed = await parsePdfBlob(blob);
        const body = JSON.stringify(parsed);
        const resultKey = buildDocumentParseResultStagingKey(
          config.stagingPrefix,
          payload.parseKind,
          payload.storageId,
        );
        const resultContentType = getDocumentParseResultContentType(payload.parseKind);
        const resultSizeBytes = Buffer.byteLength(body);
        if (resultSizeBytes > config.documentParseJsonResultMaxBytes) {
          throw new Error('Parsed PDF result exceeded the maximum allowed size.');
        }
        await client.send(
          new PutObjectCommand({
            Body: body,
            Bucket: config.storageBuckets.quarantine.bucket,
            ContentType: resultContentType,
            Key: resultKey,
            SSEKMSKeyId: config.storageBuckets.quarantine.kmsKeyArn,
            ServerSideEncryption: 'aws:kms',
          }),
        );
        await postSignedCallback({
          baseUrl: config.callbackBaseUrl,
          path: '/internal/storage/document-result',
          payload: {
            type: 'document_result',
            parseKind: payload.parseKind,
            storageId: payload.storageId,
            imageCount: parsed.images.length,
            pageCount: parsed.pages,
            parserVersion: 'document-parse-worker-v1',
            resultChecksumSha256: sha256Hex(body),
            resultContentType,
            resultKey,
            resultSizeBytes,
            status: 'SUCCEEDED',
          },
          secret: config.callbackSecret,
        });
        continue;
      }

      const extractedText = await parseChatDocument(blob, payload.fileName, payload.mimeType);
      const resultKey = buildDocumentParseResultStagingKey(
        config.stagingPrefix,
        payload.parseKind,
        payload.storageId,
      );
      const resultContentType = getDocumentParseResultContentType(payload.parseKind);
      const resultSizeBytes = Buffer.byteLength(extractedText);
      if (resultSizeBytes > config.documentParseTextResultMaxBytes) {
        throw new Error('Extracted document text exceeded the maximum allowed size.');
      }
      await client.send(
        new PutObjectCommand({
          Body: extractedText,
          Bucket: config.storageBuckets.quarantine.bucket,
          ContentType: resultContentType,
          Key: resultKey,
          SSEKMSKeyId: config.storageBuckets.quarantine.kmsKeyArn,
          ServerSideEncryption: 'aws:kms',
        }),
      );
      await postSignedCallback({
        baseUrl: config.callbackBaseUrl,
        path: '/internal/storage/document-result',
        payload: {
          type: 'document_result',
          parseKind: payload.parseKind,
          storageId: payload.storageId,
          parserVersion: 'document-parse-worker-v1',
          resultChecksumSha256: sha256Hex(extractedText),
          resultContentType,
          resultKey,
          resultSizeBytes,
          status: 'SUCCEEDED',
        },
        secret: config.callbackSecret,
      });
    } catch (error) {
      await postSignedCallback({
        baseUrl: config.callbackBaseUrl,
        path: '/internal/storage/document-result',
        payload: {
          type: 'document_result',
          parseKind: payload.parseKind,
          storageId: payload.storageId,
          errorMessage:
            error instanceof Error ? error.message : 'Document parsing failed in AWS worker.',
          parserVersion: 'document-parse-worker-v1',
          status: 'FAILED',
        },
        secret: config.callbackSecret,
      });
    }
  }
}
