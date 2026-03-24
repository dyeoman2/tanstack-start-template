import { api } from '@convex/_generated/api';
import { createConvexPublicClient } from '~/lib/server/convex-admin.server';

const SCIM_USER_COLLECTION_PATH = '/api/auth/scim/v2/Users';

function getScimAuthBaseUrl(request: Request) {
  return new URL('/api/auth', request.url).toString().replace(/\/$/, '');
}

function isScimUserCollectionPath(pathname: string) {
  return pathname === SCIM_USER_COLLECTION_PATH;
}

function isScimUserResourcePath(pathname: string) {
  return new RegExp(`^${SCIM_USER_COLLECTION_PATH}/[^/]+$`).test(pathname);
}

function getScimUserIdFromPath(pathname: string) {
  const match = pathname.match(new RegExp(`^${SCIM_USER_COLLECTION_PATH}/([^/]+)$`));
  return match?.[1] ?? null;
}

function createScimResponse(input: {
  body: string | null;
  location: string | null;
  status: number;
}) {
  const headers = new Headers();
  if (input.body !== null) {
    headers.set('content-type', 'application/scim+json');
  }
  if (input.location) {
    headers.set('location', input.location);
  }

  return new Response(input.body, {
    headers,
    status: input.status,
  });
}

function shouldHandleScimPatchLifecycle(bodyJson: string | undefined) {
  if (!bodyJson) {
    return false;
  }

  try {
    const parsed = JSON.parse(bodyJson) as Record<string, unknown>;
    const operations = Array.isArray(parsed.Operations) ? parsed.Operations : [];

    return operations.some((operation) => {
      if (!operation || typeof operation !== 'object') {
        return false;
      }

      const path = typeof operation.path === 'string' ? operation.path.trim().toLowerCase() : '';
      const value = 'value' in operation ? operation.value : undefined;

      if (path === 'active') {
        return true;
      }

      return Boolean(
        !path &&
        typeof value === 'object' &&
        value !== null &&
        'active' in value &&
        typeof value.active === 'boolean',
      );
    });
  } catch {
    return false;
  }
}

export async function handleScimOrganizationLifecycleRequest(request: Request) {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  let operation: 'delete' | 'patch' | 'post' | 'put' | null = null;
  let userId: string | undefined;

  if (method === 'DELETE' && isScimUserResourcePath(pathname)) {
    operation = 'delete';
    userId = getScimUserIdFromPath(pathname) ?? undefined;
  } else if (method === 'PATCH' && isScimUserResourcePath(pathname)) {
    operation = 'patch';
    userId = getScimUserIdFromPath(pathname) ?? undefined;
  } else if (method === 'PUT' && isScimUserResourcePath(pathname)) {
    operation = 'put';
    userId = getScimUserIdFromPath(pathname) ?? undefined;
  } else if (method === 'POST' && isScimUserCollectionPath(pathname)) {
    operation = 'post';
  }

  if (!operation) {
    return null;
  }

  const authorizationHeader = request.headers.get('authorization');
  if (!authorizationHeader) {
    return createScimResponse({
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'SCIM token is required',
      }),
      location: null,
      status: 401,
    });
  }

  const bodyJson = operation === 'delete' ? undefined : await request.text().catch(() => undefined);

  if (operation === 'patch' && !shouldHandleScimPatchLifecycle(bodyJson)) {
    return null;
  }

  const convex = createConvexPublicClient();
  const result = await convex.action(api.auth.handleScimOrganizationLifecycle, {
    authorizationHeader,
    baseUrl: getScimAuthBaseUrl(request),
    ...(bodyJson ? { bodyJson } : {}),
    operation,
    ...(userId ? { userId } : {}),
  });

  if (!result.handled) {
    return null;
  }

  return createScimResponse({
    body: result.body,
    location: result.location,
    status: result.status,
  });
}
