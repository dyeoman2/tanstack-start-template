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
  fetchAuthMutationMock,
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
  fetchAuthMutationMock: vi.fn(),
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
      deactivateOrganizationMember: 'deactivateOrganizationMember',
      getOrganizationCreationEligibility: 'getOrganizationCreationEligibility',
      getOrganizationWriteAccess: 'getOrganizationWriteAccess',
      reactivateOrganizationMember: 'reactivateOrganizationMember',
      recordOrganizationBulkAuditEvents: 'recordOrganizationBulkAuditEvents',
      suspendOrganizationMember: 'suspendOrganizationMember',
      updateOrganizationPolicies: 'updateOrganizationPolicies',
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
  bulkOrganizationDirectoryActionServerFn,
  checkOrganizationSlugServerFn,
  cancelOrganizationInvitationServerFn,
  createOrganizationInvitationServerFn,
  createOrganizationServerFn,
  deleteOrganizationServerFn,
  removeOrganizationMemberServerFn,
  reactivateOrganizationMemberServerFn,
  deactivateOrganizationMemberServerFn,
  suspendOrganizationMemberServerFn,
  updateOrganizationPoliciesServerFn,
  updateOrganizationMemberRoleServerFn,
  updateOrganizationSettingsServerFn,
} from './organization-management';

describe('organization management server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAuthQueryMock.mockResolvedValue({ allowed: true });
    fetchAuthMutationMock.mockResolvedValue({ success: true });
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
      email: 'person@example.com',
      nextRole: 'owner',
      resend: true,
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

  it('fails when organization write access is denied for invitations', async () => {
    const failure = new Error('not allowed');
    handleServerErrorMock.mockReturnValue(failure);
    fetchAuthQueryMock.mockResolvedValueOnce({ allowed: false, reason: 'tenant mismatch' });

    await expect(
      createOrganizationInvitationServerFn({
        data: {
          organizationId: 'org_1',
          email: 'other@org.com',
          role: 'member',
          resend: false,
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      'Create organization invitation',
    );
  });

  it('fails when updating a member role without tenant access', async () => {
    const failure = new Error('forbidden');
    handleServerErrorMock.mockReturnValue(failure);
    fetchAuthQueryMock.mockResolvedValueOnce({ allowed: false, reason: 'not your org' });

    await expect(
      updateOrganizationMemberRoleServerFn({
        data: {
          organizationId: 'org_1',
          membershipId: 'member_1',
          role: 'member',
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      'Update organization member role',
    );
    expect(updateBetterAuthOrganizationMemberRoleMock).not.toHaveBeenCalled();
  });

  it('updates organization policies through Convex auth mutations', async () => {
    await updateOrganizationPoliciesServerFn({
      data: {
        organizationId: 'org_1',
        invitePolicy: 'owners_only',
        verifiedDomainsOnly: true,
        memberCap: 25,
        mfaRequired: true,
        enterpriseAuthMode: 'off',
        enterpriseProviderKey: null,
        enterpriseProtocol: null,
        allowBreakGlassPasswordLogin: true,
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('updateOrganizationPolicies', {
      organizationId: 'org_1',
      invitePolicy: 'owners_only',
      verifiedDomainsOnly: true,
      memberCap: 25,
      mfaRequired: true,
      enterpriseAuthMode: 'off',
      enterpriseProviderKey: null,
      enterpriseProtocol: null,
      allowBreakGlassPasswordLogin: true,
    });
  });

  it('routes membership state changes through Convex mutations with preflight access', async () => {
    await suspendOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    await deactivateOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    await reactivateOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'suspend-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'deactivate-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(3, 'getOrganizationWriteAccess', {
      action: 'reactivate-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(1, 'suspendOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(2, 'deactivateOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(3, 'reactivateOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(1, 'ensureCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(2, 'ensureCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(3, 'ensureCurrentUserContext', {});
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

  it('runs bulk invitation revocation and records bulk audit events', async () => {
    await bulkOrganizationDirectoryActionServerFn({
      data: {
        organizationId: 'org_1',
        action: 'revoke-invites',
        invitations: [
          {
            invitationId: 'invite_1',
            email: 'invitee@example.com',
            role: 'member',
          },
        ],
        members: [],
      },
    });

    expect(cancelBetterAuthOrganizationInvitationMock).toHaveBeenCalledWith(
      'invite_1',
      expect.any(Function),
    );
    expect(fetchAuthMutationMock).toHaveBeenCalledWith('recordOrganizationBulkAuditEvents', {
      organizationId: 'org_1',
      eventType: 'bulk_invite_revoked',
      entries: [
        {
          targetEmail: 'invitee@example.com',
          targetId: 'invite_1',
          targetRole: 'member',
        },
      ],
    });
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
