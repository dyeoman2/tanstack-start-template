import { getRequest } from '@tanstack/react-start/server';
import { ServerError } from '~/lib/server/error-utils.server';

type BetterAuthRequestInit = {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
};

type BetterAuthErrorPayload = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
};

type BetterAuthErrorMapper = (input: {
  code?: string;
  message?: string;
  payload: unknown;
  status: number;
}) => string;

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

async function readResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractBetterAuthErrorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const errorPayload = payload as BetterAuthErrorPayload;
  if (typeof errorPayload.code === 'string') {
    return errorPayload.code;
  }

  if (typeof errorPayload.error === 'string') {
    return errorPayload.error;
  }

  return undefined;
}

function extractBetterAuthErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return typeof payload === 'string' ? payload : undefined;
  }

  const errorPayload = payload as BetterAuthErrorPayload;
  if (typeof errorPayload.message === 'string') {
    return errorPayload.message;
  }

  return typeof payload === 'string' ? payload : undefined;
}

export async function callBetterAuthEndpoint<TResponse>(
  path: string,
  init: BetterAuthRequestInit = {},
  options: {
    mapErrorMessage?: BetterAuthErrorMapper;
  } = {},
): Promise<TResponse> {
  const request = getBetterAuthRequest();
  const url = new URL(path, request.url);

  if (init.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = buildBetterAuthForwardHeaders(request);
  headers.set('accept', 'application/json');

  let body: string | undefined;
  if (init.body) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }

  const response = await fetch(url, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    const code = extractBetterAuthErrorCode(payload);
    const message = extractBetterAuthErrorMessage(payload);
    const mappedMessage = options.mapErrorMessage?.({
      code,
      message,
      payload,
      status: response.status,
    });

    throw new ServerError(
      mappedMessage ?? message ?? 'Better Auth request failed',
      response.status,
      payload,
    );
  }

  return payload as TResponse;
}

export function getBetterAuthErrorCode(error: unknown) {
  if (error instanceof ServerError) {
    return extractBetterAuthErrorCode(error.originalError);
  }

  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return undefined;
}
