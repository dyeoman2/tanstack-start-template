import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adminActionMock,
  cancelBetterAuthOrganizationInvitationMock,
  checkBetterAuthOrganizationSlugMock,
  createBetterAuthOrganizationInvitationMock,
  createBetterAuthOrganizationMock,
  deleteBetterAuthOrganizationMock,
  removeBetterAuthOrganizationMemberMock,
  requireAuthMock,
  fetchAuthActionMock,
  fetchAuthQueryMock,
  handleServerErrorMock,
  updateBetterAuthOrganizationMemberRoleMock,
  updateBetterAuthOrganizationMock,
} = vi.hoisted(() => ({
  adminActionMock: vi.fn(),
  cancelBetterAuthOrganizationInvitationMock: vi.fn(),
  checkBetterAuthOrganizationSlugMock: vi.fn(),
  createBetterAuthOrganizationInvitationMock: vi.fn(),
  createBetterAuthOrganizationMock: vi.fn(),
  deleteBetterAuthOrganizationMock: vi.fn(),
  removeBetterAuthOrganizationMemberMock: vi.fn(),
  requireAuthMock: vi.fn(),
  fetchAuthActionMock: vi.fn(),
  fetchAuthQueryMock: vi.fn(),
  handleServerErrorMock: vi.fn((error: unknown) => error),
  updateBetterAuthOrganizationMemberRoleMock: vi.fn(),
  updateBetterAuthOrganizationMock: vi.fn(),
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
      getOrganizationCreationEligibility: 'getOrganizationCreationEligibility',
      getOrganizationWriteAccess: 'getOrganizationWriteAccess',
    },
  },
  internal: {
    organizationManagement: {
      cleanupOrganizationDataInternal: 'cleanupOrganizationDataInternal',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
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

vi.mock('~/lib/server/better-auth/api', () => ({
  cancelBetterAuthOrganizationInvitation: cancelBetterAuthOrganizationInvitationMock,
  checkBetterAuthOrganizationSlug: checkBetterAuthOrganizationSlugMock,
  createBetterAuthOrganization: createBetterAuthOrganizationMock,
  createBetterAuthOrganizationInvitation: createBetterAuthOrganizationInvitationMock,
  deleteBetterAuthOrganization: deleteBetterAuthOrganizationMock,
  removeBetterAuthOrganizationMember: removeBetterAuthOrganizationMemberMock,
  updateBetterAuthOrganization: updateBetterAuthOrganizationMock,
  updateBetterAuthOrganizationMemberRole: updateBetterAuthOrganizationMemberRoleMock,
}));

import {
  checkOrganizationSlugServerFn,
  cancelOrganizationInvitationServerFn,
  createOrganizationInvitationServerFn,
  createOrganizationServerFn,
  deleteOrganizationServerFn,
  removeOrganizationMemberServerFn,
  updateOrganizationMemberRoleServerFn,
  updateOrganizationSettingsServerFn,
} from './organization-management';

describe('organization management server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAuthQueryMock.mockResolvedValue({ allowed: true });
    adminActionMock.mockResolvedValue({ success: true });
    checkBetterAuthOrganizationSlugMock.mockResolvedValue({ status: true });
    createBetterAuthOrganizationInvitationMock.mockResolvedValue({ id: 'invite-1' });
    updateBetterAuthOrganizationMemberRoleMock.mockResolvedValue({
      member: { id: 'member_1' },
    });
    updateBetterAuthOrganizationMock.mockResolvedValue({ id: 'org_1', name: 'Acme' });
    createBetterAuthOrganizationMock.mockResolvedValue({
      id: 'org_1',
      name: 'Acme',
      slug: 'acme',
    });
    removeBetterAuthOrganizationMemberMock.mockResolvedValue({ member: { id: 'member_1' } });
    deleteBetterAuthOrganizationMock.mockResolvedValue({ id: 'org_1' });
    cancelBetterAuthOrganizationInvitationMock.mockResolvedValue({
      invitation: { id: 'invite_1' },
    });
  });

  it('routes managed organization writes through Better Auth actions', async () => {
    await createOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        email: ' Person@Example.com ',
        role: 'owner',
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
      nextRole: 'owner',
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
    expect(createBetterAuthOrganizationInvitationMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        email: 'person@example.com',
        role: 'owner',
        resend: true,
      },
      expect.any(Function),
    );
    expect(updateBetterAuthOrganizationMemberRoleMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        memberId: 'member_1',
        role: 'member',
      },
      expect.any(Function),
    );
    expect(updateBetterAuthOrganizationMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        data: {
          name: 'Acme',
          logo: 'https://example.com/logo.png',
        },
      },
      expect.any(Function),
    );
  });

  it('creates organizations through the server flow when the viewer is eligible', async () => {
    fetchAuthQueryMock.mockResolvedValueOnce({
      count: 1,
      limit: 2,
      canCreate: true,
      reason: null,
      isUnlimited: false,
    });

    const result = await createOrganizationServerFn({
      data: {
        name: '  Acme  ',
        slug: 'acme',
      },
    });

    expect(result).toEqual({ id: 'org_1', name: 'Acme', slug: 'acme' });
    expect(fetchAuthQueryMock).toHaveBeenCalledWith('getOrganizationCreationEligibility', {});
    expect(checkBetterAuthOrganizationSlugMock).toHaveBeenCalledWith(
      'acme',
      expect.any(Function),
    );
    expect(createBetterAuthOrganizationMock).toHaveBeenCalledWith(
      {
        keepCurrentActiveOrganization: false,
        name: 'Acme',
        slug: 'acme',
      },
      expect.any(Function),
    );
    expect(fetchAuthActionMock).toHaveBeenCalledWith('ensureCurrentUserContext', {});
  });

  it('checks slug availability through Better Auth before creation', async () => {
    const result = await checkOrganizationSlugServerFn({
      data: {
        slug: '  Acme Health  ',
      },
    });

    expect(result).toEqual({
      available: true,
      slug: 'acme-health',
    });
    expect(checkBetterAuthOrganizationSlugMock).toHaveBeenCalledWith(
      'acme-health',
      expect.any(Function),
    );
  });

  it('refreshes user context after member removal and organization deletion', async () => {
    fetchAuthActionMock.mockResolvedValue({ organizationId: 'org_next' });

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
    expect(removeBetterAuthOrganizationMemberMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        memberIdOrEmail: 'member_1',
      },
      expect.any(Function),
    );
    expect(deleteBetterAuthOrganizationMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
    );
    expect(adminActionMock).toHaveBeenCalledWith('cleanupOrganizationDataInternal', {
      organizationId: 'org_1',
    });
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(1, 'ensureCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(2, 'ensureCurrentUserContext', {});
  });

  it('calls the Better Auth invitation cancel endpoint', async () => {
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
    expect(cancelBetterAuthOrganizationInvitationMock).toHaveBeenCalledWith(
      'invite_1',
      expect.any(Function),
    );
  });

  it('wraps Better Auth action failures with mapped org messages', async () => {
    const failure = new Error('wrapped org failure');
    createBetterAuthOrganizationInvitationMock.mockRejectedValue(
      new Error('That user already has a pending invitation'),
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

  it('surfaces preflight invite role failures before calling Better Auth', async () => {
    const failure = new Error('wrapped invite failure');
    fetchAuthQueryMock.mockResolvedValueOnce({
      allowed: false,
      reason: 'You cannot assign that organization role',
    });
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationInvitationServerFn({
        data: {
          organizationId: 'org_1',
          email: 'person@example.com',
          role: 'owner',
        },
      }),
    ).rejects.toBe(failure);

    expect(createBetterAuthOrganizationInvitationMock).not.toHaveBeenCalled();
    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'You cannot assign that organization role',
      }),
      'Create organization invitation',
    );
  });

  it('blocks organization creation when the viewer is at the membership limit', async () => {
    const failure = new Error('wrapped create failure');
    fetchAuthQueryMock.mockResolvedValueOnce({
      count: 2,
      limit: 2,
      canCreate: false,
      reason: 'You can belong to up to 2 organizations.',
      isUnlimited: false,
    });
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationServerFn({
        data: {
          name: 'Acme',
          slug: 'acme',
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'You can belong to up to 2 organizations.',
      }),
      'Create organization',
    );
  });
});
