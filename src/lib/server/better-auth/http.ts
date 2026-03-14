import { getRequest } from '@tanstack/react-start/server';

export function getBetterAuthRequest(): Request {
  const request = getRequest();
  if (!request) {
    throw new Error('Better Auth utilities must run on the server');
  }

  return request;
}

export function buildBetterAuthForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  const forwardedHeaderNames = [
    'cookie',
    'origin',
    'referer',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
  ] as const;

  for (const headerName of forwardedHeaderNames) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}
