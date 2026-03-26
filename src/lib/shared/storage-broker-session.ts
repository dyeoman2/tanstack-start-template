import type {
  StorageBrokerSessionRequest,
  StorageBrokerTrustTier,
} from './storage-service-contract';

export const STORAGE_BROKER_SESSION_TTL_MS = 15 * 60 * 1000;
export const STORAGE_BROKER_SESSION_REFRESH_WINDOW_MS = 60 * 1000;
export const STORAGE_BROKER_SESSION_MAX_CLOCK_SKEW_MS = 60 * 1000;

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function buildSignaturePayload(input: {
  expiresAt: number;
  issuedAt: number;
  nonce: string;
  tier: StorageBrokerTrustTier;
}) {
  return `${input.tier}.${input.issuedAt}.${input.expiresAt}.${input.nonce}`;
}

async function signPayload(secret: string, payload: string) {
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

export async function createStorageBrokerSessionRequest(args: {
  now?: number;
  secret: string;
  tier: StorageBrokerTrustTier;
  ttlMs?: number;
}): Promise<StorageBrokerSessionRequest> {
  const issuedAt = args.now ?? Date.now();
  const expiresAt = issuedAt + (args.ttlMs ?? STORAGE_BROKER_SESSION_TTL_MS);
  const nonce = crypto.randomUUID();
  const signature = await signPayload(
    args.secret,
    buildSignaturePayload({
      expiresAt,
      issuedAt,
      nonce,
      tier: args.tier,
    }),
  );

  return {
    expiresAt,
    issuedAt,
    nonce,
    signature,
    tier: args.tier,
  };
}

export async function validateStorageBrokerSessionRequest(args: {
  now?: number;
  request: StorageBrokerSessionRequest;
  secret: string;
  tier: StorageBrokerTrustTier;
}): Promise<string | null> {
  if (args.request.tier !== args.tier) {
    return 'Storage broker session tier did not match the requested endpoint.';
  }

  if (!Number.isFinite(args.request.issuedAt) || !Number.isFinite(args.request.expiresAt)) {
    return 'Storage broker session timestamps were invalid.';
  }

  if (!args.request.nonce.trim()) {
    return 'Storage broker session nonce is required.';
  }

  const now = args.now ?? Date.now();
  if (args.request.issuedAt > now + STORAGE_BROKER_SESSION_MAX_CLOCK_SKEW_MS) {
    return 'Storage broker session request was issued in the future.';
  }
  if (args.request.expiresAt <= args.request.issuedAt) {
    return 'Storage broker session expiry must be later than the issue time.';
  }
  if (args.request.expiresAt < now - STORAGE_BROKER_SESSION_MAX_CLOCK_SKEW_MS) {
    return 'Storage broker session request has expired.';
  }

  const expected = await signPayload(
    args.secret,
    buildSignaturePayload({
      expiresAt: args.request.expiresAt,
      issuedAt: args.request.issuedAt,
      nonce: args.request.nonce,
      tier: args.request.tier,
    }),
  );
  if (!timingSafeEqual(expected, args.request.signature)) {
    return 'Storage broker session signature was invalid.';
  }

  return null;
}
