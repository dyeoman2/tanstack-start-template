import type {
  DocumentParseResultCallbackRequest,
  StorageServiceGuardDutyCallbackRequest,
  StorageServiceInspectionCallbackRequest,
} from './storage-service-contract';

export function parseGuardDutyWebhookPayload(
  payload: string,
): StorageServiceGuardDutyCallbackRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Webhook payload is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('bucket' in parsed) ||
    !('findingId' in parsed) ||
    !('status' in parsed) ||
    !('scannedAt' in parsed) ||
    !('type' in parsed)
  ) {
    throw new Error('Webhook payload is malformed.');
  }

  const candidate = parsed as StorageServiceGuardDutyCallbackRequest;
  if (candidate.type === 'guardduty_finding') {
    if (!('key' in candidate)) {
      throw new Error('GuardDuty finding payload is malformed.');
    }
    if (candidate.status !== 'CLEAN' && candidate.status !== 'INFECTED') {
      throw new Error('Webhook status is not supported.');
    }
    return candidate;
  }

  if (!('quarantineKey' in candidate)) {
    throw new Error('Promotion result payload is malformed.');
  }
  if (candidate.status !== 'PROMOTED' && candidate.status !== 'PROMOTION_FAILED') {
    throw new Error('Promotion result status is not supported.');
  }

  return candidate;
}

export function parseStorageInspectionWebhookPayload(
  payload: string,
): StorageServiceInspectionCallbackRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Storage inspection webhook payload is not valid JSON.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('bucket' in parsed) ||
    !('key' in parsed) ||
    typeof parsed.bucket !== 'string' ||
    typeof parsed.key !== 'string'
  ) {
    throw new Error('Storage inspection webhook payload is malformed.');
  }

  return {
    bucket: parsed.bucket,
    key: parsed.key,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDocumentParseKind(
  value: unknown,
): value is DocumentParseResultCallbackRequest['parseKind'] {
  return value === 'chat_document_extract' || value === 'pdf_parse';
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function parseDocumentResultWebhookPayload(
  payload: string,
): DocumentParseResultCallbackRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Document parse callback payload is not valid JSON.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Document parse callback payload is malformed.');
  }

  if (parsed.type !== 'document_result') {
    throw new Error('Document parse callback payload type is not supported.');
  }

  if (!isDocumentParseKind(parsed.parseKind)) {
    throw new Error('Document parse callback parseKind is not supported.');
  }

  if (typeof parsed.storageId !== 'string' || typeof parsed.parserVersion !== 'string') {
    throw new Error('Document parse callback payload is malformed.');
  }

  if (parsed.status !== 'FAILED' && parsed.status !== 'SUCCEEDED') {
    throw new Error('Document parse callback status is not supported.');
  }

  if (
    !isOptionalString(parsed.errorMessage) ||
    !isOptionalString(parsed.resultContentType) ||
    !isOptionalString(parsed.resultKey) ||
    !isOptionalString(parsed.resultChecksumSha256) ||
    (parsed.pageCount !== undefined && !isPositiveInteger(parsed.pageCount)) ||
    (parsed.imageCount !== undefined && !isPositiveInteger(parsed.imageCount)) ||
    (parsed.resultSizeBytes !== undefined && !isPositiveInteger(parsed.resultSizeBytes))
  ) {
    throw new Error('Document parse callback payload is malformed.');
  }

  if (parsed.status === 'SUCCEEDED') {
    if (
      typeof parsed.resultContentType !== 'string' ||
      typeof parsed.resultKey !== 'string' ||
      typeof parsed.resultChecksumSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(parsed.resultChecksumSha256) ||
      !isPositiveInteger(parsed.resultSizeBytes)
    ) {
      throw new Error('Successful document parse callback is missing required result metadata.');
    }
  }

  return parsed as DocumentParseResultCallbackRequest;
}
