import { internal } from '@convex/_generated/api';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';

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

  const bodyJson =
    operation === 'delete' ? undefined : await request.text().catch(() => undefined);

  const convex = createConvexAdminClient();
  const result = await convex.action(internal.auth.handleScimOrganizationLifecycleInternal, {
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
