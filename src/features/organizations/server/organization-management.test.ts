import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuthMock,
  fetchAuthMutationMock,
  handleServerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  fetchAuthMutationMock: vi.fn(),
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
      createOrganizationInvitation: 'createOrganizationInvitation',
      updateOrganizationMemberRole: 'updateOrganizationMemberRole',
      removeOrganizationMember: 'removeOrganizationMember',
      cancelOrganizationInvitation: 'cancelOrganizationInvitation',
      updateOrganizationSettings: 'updateOrganizationSettings',
      deleteOrganization: 'deleteOrganization',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthMutation: fetchAuthMutationMock,
  },
}));

vi.mock('~/lib/server/error-utils.server', () => ({
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
  });

  it('routes managed organization mutations through Convex org management', async () => {
    fetchAuthMutationMock.mockResolvedValue({ success: true });

    await createOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        email: ' Person@Example.com ',
        role: 'admin',
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

    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(
      1,
      'createOrganizationInvitation',
      {
        organizationId: 'org_1',
        email: 'person@example.com',
        role: 'admin',
      },
    );
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(
      2,
      'updateOrganizationMemberRole',
      {
        organizationId: 'org_1',
        membershipId: 'member_1',
        role: 'member',
      },
    );
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(
      3,
      'updateOrganizationSettings',
      {
        organizationId: 'org_1',
        name: 'Acme',
        logo: 'https://example.com/logo.png',
      },
    );
  });

  it('refreshes user context after member removal and organization deletion', async () => {
    fetchAuthMutationMock.mockResolvedValue({ success: true });

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

    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(1, 'removeOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(2, 'ensureCurrentUserContext', {});
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(3, 'deleteOrganization', {
      organizationId: 'org_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(4, 'ensureCurrentUserContext', {});
  });

  it('passes the organization id when canceling invitations', async () => {
    fetchAuthMutationMock.mockResolvedValue({ success: true });

    await cancelOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        invitationId: 'invite_1',
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('cancelOrganizationInvitation', {
      organizationId: 'org_1',
      invitationId: 'invite_1',
    });
  });
});
