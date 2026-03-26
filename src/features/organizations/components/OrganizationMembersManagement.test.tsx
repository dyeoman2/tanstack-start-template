import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationMembersManagement } from './OrganizationMembersManagement';

const {
  navigateMock,
  routerInvalidateMock,
  showToastMock,
  exportDirectoryCsvMock,
  createInvitationMock,
  deactivateMemberMock,
  updateMemberRoleMock,
  removeMemberMock,
  reactivateMemberMock,
  cancelInvitationMock,
  bulkActionMock,
  suspendMemberMock,
  useQueryMock,
  invalidateQueriesMock,
  notifyMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  showToastMock: vi.fn(),
  exportDirectoryCsvMock: vi.fn(),
  createInvitationMock: vi.fn(),
  deactivateMemberMock: vi.fn(),
  updateMemberRoleMock: vi.fn(),
  removeMemberMock: vi.fn(),
  reactivateMemberMock: vi.fn(),
  cancelInvitationMock: vi.fn(),
  bulkActionMock: vi.fn(),
  suspendMemberMock: vi.fn(),
  useQueryMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: routerInvalidateMock }),
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction:
    () =>
    (...args: unknown[]) =>
      exportDirectoryCsvMock(...args),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    $store: {
      notify: notifyMock,
    },
  },
}));

vi.mock('~/features/organizations/server/organization-management', () => ({
  createOrganizationInvitationServerFn: (...args: unknown[]) => createInvitationMock(...args),
  deactivateOrganizationMemberServerFn: (...args: unknown[]) => deactivateMemberMock(...args),
  updateOrganizationMemberRoleServerFn: (...args: unknown[]) => updateMemberRoleMock(...args),
  removeOrganizationMemberServerFn: (...args: unknown[]) => removeMemberMock(...args),
  reactivateOrganizationMemberServerFn: (...args: unknown[]) => reactivateMemberMock(...args),
  suspendOrganizationMemberServerFn: (...args: unknown[]) => suspendMemberMock(...args),
  cancelOrganizationInvitationServerFn: (...args: unknown[]) => cancelInvitationMock(...args),
  bulkOrganizationDirectoryActionServerFn: (...args: unknown[]) => bulkActionMock(...args),
  exportOrganizationDirectoryCsvServerFn: (...args: unknown[]) => exportDirectoryCsvMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

const directoryResponse = {
  organization: {
    id: 'org-1',
    slug: 'cottage-hospital',
    name: 'Cottage Hospital',
    logo: null,
  },
  access: {
    admin: true,
    delete: true,
    edit: true,
    view: true,
    siteAdmin: true,
  },
  capabilities: {
    availableInviteRoles: ['owner', 'admin', 'member'] as const,
    canInvite: true,
    canUpdateSettings: true,
    canDeleteOrganization: true,
    canLeaveOrganization: false,
    canManageMembers: true,
    canManagePolicies: true,
  },
  policies: {
    invitePolicy: 'owners_admins' as const,
    verifiedDomainsOnly: false,
    memberCap: null,
    mfaRequired: false,
  },
  viewerRole: 'site-admin' as const,
  rows: [
    {
      id: 'invite:1',
      kind: 'invite' as const,
      invitationId: 'invite-1',
      name: null,
      email: 'invitee@example.com',
      role: 'member' as const,
      status: 'pending' as const,
      createdAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      canRevoke: true,
    },
  ],
  counts: {
    members: 0,
    invites: 1,
  },
  pagination: {
    page: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
  },
};

describe('OrganizationMembersManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(directoryResponse);
  });

  it('runs bulk invite actions for selected rows', async () => {
    const user = userEvent.setup();
    bulkActionMock.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 0,
      results: [{ key: 'invite-1', success: true }],
    });

    render(
      <OrganizationMembersManagement
        slug="cottage-hospital"
        searchParams={{
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          secondarySortBy: 'email',
          secondarySortOrder: 'asc',
          search: '',
          kind: 'all',
        }}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: /select invitee@example.com/i }));
    await user.click(screen.getByRole('button', { name: /revoke invites/i }));

    await waitFor(() => {
      expect(bulkActionMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          action: 'revoke-invites',
          invitations: [
            {
              invitationId: 'invite-1',
              email: 'invitee@example.com',
              role: 'member',
            },
          ],
          members: [],
        },
      });
    });
  });

  it('resends organization invitations from the invite row actions', async () => {
    const user = userEvent.setup();
    createInvitationMock.mockResolvedValueOnce({ success: true, invitationId: 'invite-2' });

    render(
      <OrganizationMembersManagement
        slug="cottage-hospital"
        searchParams={{
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          secondarySortBy: 'email',
          secondarySortOrder: 'asc',
          search: '',
          kind: 'all',
        }}
      />,
    );

    const row = screen.getByRole('row', { name: /pending invite invitee@example.com/i });
    await user.click(within(row).getByRole('button', { name: 'Organization row actions' }));
    await user.click(screen.getByRole('menuitem', { name: /resend invitation/i }));

    await waitFor(() => {
      expect(createInvitationMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          email: 'invitee@example.com',
          role: 'member',
          resend: true,
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Invitation resent.', 'success');
    expect(notifyMock).toHaveBeenCalledWith('$activeOrgSignal');
    expect(notifyMock).toHaveBeenCalledWith('$sessionSignal');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['organizations'] });
    expect(routerInvalidateMock).toHaveBeenCalled();
  });

  it('offers owner as an invite role when the server capabilities allow it', async () => {
    const user = userEvent.setup();
    createInvitationMock.mockResolvedValueOnce({ success: true, invitationId: 'invite-2' });
    useQueryMock.mockReturnValue({
      ...directoryResponse,
      capabilities: {
        ...directoryResponse.capabilities,
        availableInviteRoles: ['owner'] as const,
      },
    });

    render(
      <OrganizationMembersManagement
        slug="cottage-hospital"
        searchParams={{
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          secondarySortBy: 'email',
          secondarySortOrder: 'asc',
          search: '',
          kind: 'all',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /invite member/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'owner@example.com' },
    });
    await user.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => {
      expect(createInvitationMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          email: 'owner@example.com',
          role: 'owner',
        },
      });
    });
  });

  it('navigates sorting changes to the dedicated members route', async () => {
    const user = userEvent.setup();

    render(
      <OrganizationMembersManagement
        slug="cottage-hospital"
        searchParams={{
          page: 1,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          secondarySortBy: 'email',
          secondarySortOrder: 'asc',
          search: '',
          kind: 'all',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^email$/i }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/organizations/$slug/members',
      params: { slug: 'cottage-hospital' },
      search: {
        page: 1,
        pageSize: 10,
        sortBy: 'email',
        sortOrder: 'asc',
        secondarySortBy: 'email',
        secondarySortOrder: 'asc',
        search: '',
        kind: 'all',
      },
    });
  });
});
