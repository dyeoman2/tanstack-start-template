import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';
import { hasValidInternalServiceAuthorization } from '~/lib/server/internal-service-auth';

const INTERNAL_OBSERVABILITY_SHARED_SECRET_ENV = 'INTERNAL_OBSERVABILITY_SHARED_SECRET';

/** Maximum allowed clock skew for HMAC-signed observability requests (60 seconds). */
const OBSERVABILITY_HMAC_MAX_SKEW_MS = 60_000;

const OBSERVABILITY_HMAC_HEADER = 'x-obs-hmac';
const OBSERVABILITY_TIMESTAMP_HEADER = 'x-obs-timestamp';

function getInternalObservabilitySharedSecret() {
  const value = process.env[INTERNAL_OBSERVABILITY_SHARED_SECRET_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Verify an HMAC-signed observability request.
 *
 * Signing scheme:
 *   HMAC-SHA256(secret, "obs:" + timestamp + ":" + pathname)
 *
 * The timestamp header must be within OBSERVABILITY_HMAC_MAX_SKEW_MS of
 * the server clock to prevent replay attacks.
 */
function hasValidObservabilityHmac(request: Request, secret: string): boolean {
  const hmacHeader = request.headers.get(OBSERVABILITY_HMAC_HEADER);
  const timestampHeader = request.headers.get(OBSERVABILITY_TIMESTAMP_HEADER);

  if (!hmacHeader || !timestampHeader) {
    return false;
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs)) {
    return false;
  }

  const skew = Math.abs(Date.now() - timestampMs);
  if (skew > OBSERVABILITY_HMAC_MAX_SKEW_MS) {
    return false;
  }

  const pathname = new URL(request.url).pathname;
  const payload = `obs:${timestampHeader}:${pathname}`;
  const expectedHmac = createHmac('sha256', secret).update(payload).digest('hex');

  try {
    return cryptoTimingSafeEqual(Buffer.from(hmacHeader, 'hex'), Buffer.from(expectedHmac, 'hex'));
  } catch {
    return false;
  }
}

export function isPrivateObservabilityRequestAuthorized(request: Request) {
  const secret = getInternalObservabilitySharedSecret();
  if (!secret) {
    return false;
  }

  // Accept either the existing Bearer token or an HMAC-signed request.
  // HMAC adds replay protection when requests traverse a network boundary.
  if (hasValidObservabilityHmac(request, secret)) {
    return true;
  }

  return hasValidInternalServiceAuthorization({
    authorizationHeader: request.headers.get('authorization'),
    expectedSecret: secret,
  });
}

export function createHiddenObservabilityResponse() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
