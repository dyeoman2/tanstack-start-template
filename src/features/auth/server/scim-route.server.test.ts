import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleScimOrganizationLifecycleRequest } from './scim-route.server';

const { clientActionMock, createConvexAdminClientMock } = vi.hoisted(() => ({
  clientActionMock: vi.fn(),
  createConvexAdminClientMock: vi.fn(() => ({
    action: clientActionMock,
  })),
}));

vi.mock('~/lib/server/convex-admin.server', () => ({
  createConvexAdminClient: createConvexAdminClientMock,
}));

describe('handleScimOrganizationLifecycleRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips PATCH requests that do not touch the active attribute', async () => {
    const request = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/scim+json',
      },
      body: JSON.stringify({
        Operations: [
          {
            op: 'replace',
            path: 'name.formatted',
            value: 'Updated User',
          },
        ],
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      }),
    });

    const response = await handleScimOrganizationLifecycleRequest(request);

    expect(response).toBeNull();
    expect(createConvexAdminClientMock).not.toHaveBeenCalled();
  });

  it('handles PATCH requests that deactivate a user', async () => {
    clientActionMock.mockResolvedValueOnce({
      body: null,
      handled: true,
      location: null,
      status: 204,
    });

    const request = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/scim+json',
      },
      body: JSON.stringify({
        Operations: [
          {
            op: 'replace',
            path: 'active',
            value: false,
          },
        ],
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      }),
    });

    const response = await handleScimOrganizationLifecycleRequest(request);

    expect(createConvexAdminClientMock).toHaveBeenCalled();
    expect(clientActionMock).toHaveBeenCalledWith(expect.anything(), {
      authorizationHeader: 'Bearer test-token',
      baseUrl: 'http://localhost:3000/api/auth',
      bodyJson: JSON.stringify({
        Operations: [
          {
            op: 'replace',
            path: 'active',
            value: false,
          },
        ],
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      }),
      operation: 'patch',
      userId: 'user-1',
    });
    expect(response?.status).toBe(204);
  });

  it('handles DELETE requests through the org-scoped lifecycle action', async () => {
    clientActionMock.mockResolvedValueOnce({
      body: null,
      handled: true,
      location: null,
      status: 204,
    });

    const request = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    const response = await handleScimOrganizationLifecycleRequest(request);

    expect(createConvexAdminClientMock).toHaveBeenCalled();
    expect(clientActionMock).toHaveBeenCalledWith(expect.anything(), {
      authorizationHeader: 'Bearer test-token',
      baseUrl: 'http://localhost:3000/api/auth',
      operation: 'delete',
      userId: 'user-1',
    });
    expect(response?.status).toBe(204);
  });

  it('treats repeat DELETE requests as idempotent org-scoped lifecycle calls', async () => {
    clientActionMock.mockResolvedValue({
      body: null,
      handled: true,
      location: null,
      status: 204,
    });

    const first = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    const second = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    const firstResponse = await handleScimOrganizationLifecycleRequest(first);
    const secondResponse = await handleScimOrganizationLifecycleRequest(second);

    expect(clientActionMock).toHaveBeenCalledTimes(2);
    expect(firstResponse?.status).toBe(204);
    expect(secondResponse?.status).toBe(204);
  });

  it('handles PATCH requests that reactivate a user through the org-scoped lifecycle action', async () => {
    clientActionMock.mockResolvedValueOnce({
      body: null,
      handled: true,
      location: null,
      status: 204,
    });

    const request = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/scim+json',
      },
      body: JSON.stringify({
        Operations: [
          {
            op: 'replace',
            path: 'active',
            value: true,
          },
        ],
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      }),
    });

    const response = await handleScimOrganizationLifecycleRequest(request);

    expect(clientActionMock).toHaveBeenCalledWith(expect.anything(), {
      authorizationHeader: 'Bearer test-token',
      baseUrl: 'http://localhost:3000/api/auth',
      bodyJson: JSON.stringify({
        Operations: [
          {
            op: 'replace',
            path: 'active',
            value: true,
          },
        ],
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      }),
      operation: 'patch',
      userId: 'user-1',
    });
    expect(response?.status).toBe(204);
  });

  it('delegates non-lifecycle POST requests back to Better Auth', async () => {
    clientActionMock.mockResolvedValueOnce({
      body: null,
      handled: false,
      location: null,
      status: 200,
    });

    const request = new Request('http://localhost:3000/api/auth/scim/v2/Users', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/scim+json',
      },
      body: JSON.stringify({
        userName: 'provider@example.com',
      }),
    });

    const response = await handleScimOrganizationLifecycleRequest(request);

    expect(clientActionMock).toHaveBeenCalledOnce();
    expect(response).toBeNull();
  });

  it('returns a SCIM 401 response when the token is missing', async () => {
    const request = new Request('http://localhost:3000/api/auth/scim/v2/Users/user-1', {
      method: 'DELETE',
    });

    const response = await handleScimOrganizationLifecycleRequest(request);

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      detail: 'SCIM token is required',
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
    });
  });
});
