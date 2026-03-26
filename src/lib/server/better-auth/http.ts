import { getRequest } from '@tanstack/react-start/server';
export {
  AUTH_PROXY_IP_HEADER,
  AUTH_PROXY_IP_SIGNATURE_HEADER,
  AUTH_PROXY_IP_TIMESTAMP_HEADER,
  buildBetterAuthProxyHeaders,
  buildTrustedConvexAuthRequest,
  getTrustedClientIp,
  getTrustedUserAgent,
} from '../../shared/better-auth-http';

export function getBetterAuthRequest(): Request {
  const request = getRequest();
  if (!request) {
    throw new Error('Better Auth utilities must run on the server');
  }

  return request;
}
