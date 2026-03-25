export type StorageWebhookKind = 'guardduty' | 'inspection';

const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) {
      return false;
    }
    mismatch |= leftByte ^ rightByte;
  }

  return mismatch === 0;
}

export async function createStorageWebhookSignature(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, '0')).join(
    '',
  );
}

export async function verifyStorageWebhookSignature(args: {
  payload: string;
  sharedSecret: string | null;
  signature: string | null;
  timestamp: string | null;
}) {
  if (!args.sharedSecret) {
    throw new Error('Storage webhook shared secret is not configured.');
  }
  if (!args.signature || !args.timestamp) {
    throw new Error('Missing required webhook signature headers.');
  }

  const timestampMs = Number.parseInt(args.timestamp, 10);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > WEBHOOK_MAX_AGE_MS) {
    throw new Error('Webhook timestamp is stale.');
  }

  const expected = await createStorageWebhookSignature(
    args.sharedSecret,
    `${args.timestamp}.${args.payload}`,
  );
  if (!timingSafeEqual(expected, args.signature)) {
    throw new Error('Webhook signature verification failed.');
  }
}
