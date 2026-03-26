import { hasValidInternalServiceAuthorization } from '~/lib/server/internal-service-auth';

const INTERNAL_OBSERVABILITY_SHARED_SECRET_ENV = 'INTERNAL_OBSERVABILITY_SHARED_SECRET';

function getInternalObservabilitySharedSecret() {
  const value = process.env[INTERNAL_OBSERVABILITY_SHARED_SECRET_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

export function isPrivateObservabilityRequestAuthorized(request: Request) {
  return hasValidInternalServiceAuthorization({
    authorizationHeader: request.headers.get('authorization'),
    expectedSecret: getInternalObservabilitySharedSecret(),
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
