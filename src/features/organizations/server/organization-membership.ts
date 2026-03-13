import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { handleServerError, ServerError } from '~/lib/server/error-utils.server';

const organizationIdSchema = z.object({
  organizationId: z.string().min(1),
});

function getCurrentRequest() {
  const request = getRequest();
  if (!request) {
    throw new Error('Organization membership utilities must run on the server');
  }

  return request;
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

async function callBetterAuthOrganizationEndpoint<TResponse>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  } = {},
): Promise<TResponse> {
  const request = getCurrentRequest();
  const url = new URL(path, request.url);
  const headers = new Headers();
  const forwardedHeaderNames = [
    'cookie',
    'origin',
    'referer',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-real-ip',
  ] as const;

  for (const headerName of forwardedHeaderNames) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

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
    const errorPayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const message =
      typeof errorPayload.message === 'string'
        ? errorPayload.message
        : typeof payload === 'string'
          ? payload
          : 'Organization action failed';

    throw new ServerError(message, response.status, payload);
  }

  return payload as TResponse;
}

export const leaveOrganizationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      await callBetterAuthOrganizationEndpoint<{ success: boolean }>('/api/auth/organization/leave', {
        method: 'POST',
        body: data,
      });

      const context = await convexAuthReactStart.fetchAuthMutation(api.users.ensureCurrentUserContext, {});
      return {
        success: true,
        nextOrganizationId: context.organizationId,
      };
    } catch (error) {
      throw handleServerError(error, 'Leave organization');
    }
  });
