import type {
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
