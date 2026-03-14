import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adminActionMock,
  requireAuthMock,
  fetchAuthMutationMock,
  fetchAuthQueryMock,
  getRequestMock,
  handleServerErrorMock,
} = vi.hoisted(() => ({
  adminActionMock: vi.fn(),
  requireAuthMock: vi.fn(),
  fetchAuthMutationMock: vi.fn(),
  fetchAuthQueryMock: vi.fn(),
  getRequestMock: vi.fn(),
  handleServerErrorMock: vi.fn((error: unknown) => error),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator() {
      return this;
    },
    handler: (handler: (...args: unknown[]) => unknown) => handler,
  }),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    users: {
      ensureCurrentUserContext: 'ensureCurrentUserContext',
    },
    organizationManagement: {
      getOrganizationWriteAccess: 'getOrganizationWriteAccess',
    },
  },
  internal: {
    organizationManagement: {
      cleanupOrganizationDataInternal: 'cleanupOrganizationDataInternal',
    },
  },
}));

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => getRequestMock(),
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthMutation: fetchAuthMutationMock,
    fetchAuthQuery: fetchAuthQueryMock,
  },
}));

vi.mock('~/lib/server/convex-admin.server', () => ({
  createConvexAdminClient: () => ({
    action: adminActionMock,
  }),
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  ServerError: class ServerError extends Error {
    statusCode: number;
    payload: unknown;

    constructor(message: string, statusCode: number, payload?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.payload = payload;
    }
  },
  handleServerError: handleServerErrorMock,
}));

import {
  cancelOrganizationInvitationServerFn,
  createOrganizationInvitationServerFn,
  deleteOrganizationServerFn,
  removeOrganizationMemberServerFn,
  updateOrganizationMemberRoleServerFn,
  updateOrganizationSettingsServerFn,
} from './organization-management';

describe('organization management server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestMock.mockReturnValue(
      new Request('http://127.0.0.1:3000/app/organizations/cottage-hospital/settings', {
        headers: {
          cookie: 'session=abc',
          origin: 'http://127.0.0.1:3000',
          referer: 'http://127.0.0.1:3000/app',
          'user-agent': 'vitest',
          'x-forwarded-for': '127.0.0.1',
        },
      }),
    );
    fetchAuthQueryMock.mockResolvedValue({ allowed: true });
    adminActionMock.mockResolvedValue({ success: true });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('routes managed organization writes through Better Auth endpoints', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'invite-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ member: { id: 'member_1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'org_1', name: 'Acme' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await createOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        email: ' Person@Example.com ',
        role: 'admin',
        resend: true,
      },
    });

    await updateOrganizationMemberRoleServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
        role: 'member',
      },
    });

    await updateOrganizationSettingsServerFn({
      data: {
        organizationId: 'org_1',
        name: '  Acme  ',
        logo: ' https://example.com/logo.png ',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'invite',
      organizationId: 'org_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'update-member-role',
      organizationId: 'org_1',
      membershipId: 'member_1',
      nextRole: 'member',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(3, 'getOrganizationWriteAccess', {
      action: 'update-settings',
      organizationId: 'org_1',
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      new URL(
        '/api/auth/organization/invite-member',
        'http://127.0.0.1:3000/app/organizations/cottage-hospital/settings',
      ),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          organizationId: 'org_1',
          email: 'person@example.com',
          role: 'admin',
          resend: true,
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      new URL(
        '/api/auth/organization/update-member-role',
        'http://127.0.0.1:3000/app/organizations/cottage-hospital/settings',
      ),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          organizationId: 'org_1',
          memberId: 'member_1',
          role: 'member',
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      new URL(
        '/api/auth/organization/update',
        'http://127.0.0.1:3000/app/organizations/cottage-hospital/settings',
      ),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          organizationId: 'org_1',
          data: {
            name: 'Acme',
            logo: 'https://example.com/logo.png',
          },
        }),
      }),
    );
  });

  it('refreshes user context after member removal and organization deletion', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ member: { id: 'member_1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'org_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    fetchAuthMutationMock.mockResolvedValue({ organizationId: 'org_next' });

    await removeOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    await deleteOrganizationServerFn({
      data: {
        organizationId: 'org_1',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'remove-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'delete-organization',
      organizationId: 'org_1',
    });
    expect(adminActionMock).toHaveBeenCalledWith('cleanupOrganizationDataInternal', {
      organizationId: 'org_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(1, 'ensureCurrentUserContext', {});
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(2, 'ensureCurrentUserContext', {});
  });

  it('calls the Better Auth invitation cancel endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ invitation: { id: 'invite_1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await cancelOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        invitationId: 'invite_1',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenCalledWith('getOrganizationWriteAccess', {
      action: 'cancel-invitation',
      organizationId: 'org_1',
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL(
        '/api/auth/organization/cancel-invitation',
        'http://127.0.0.1:3000/app/organizations/cottage-hospital/settings',
      ),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ invitationId: 'invite_1' }),
      }),
    );
  });

  it('wraps Better Auth endpoint failures with mapped org messages', async () => {
    const failure = new Error('wrapped org failure');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'User is already invited to this organization',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationInvitationServerFn({
        data: {
          organizationId: 'org_1',
          email: 'person@example.com',
          role: 'member',
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'That user already has a pending invitation',
      }),
      'Create organization invitation',
    );
  });
});
