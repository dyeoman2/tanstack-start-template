import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationSettingsManagement } from './OrganizationSettingsManagement';

const {
  navigateMock,
  routerInvalidateMock,
  locationMock,
  showToastMock,
  updateSettingsMock,
  deleteOrganizationMock,
  leaveOrganizationMock,
  invalidateQueriesMock,
  useQueryMock,
  notifyMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  locationMock: {
    pathname: '/app/organizations/cottage-hospital/settings',
    state: {},
  },
  showToastMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  deleteOrganizationMock: vi.fn(),
  leaveOrganizationMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  useQueryMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: routerInvalidateMock }),
  useLocation: () => locationMock,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useAction: () => vi.fn(),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    $store: {
      notify: notifyMock,
    },
  },
}));

vi.mock('~/features/organizations/server/organization-membership', () => ({
  leaveOrganizationServerFn: (...args: unknown[]) => leaveOrganizationMock(...args),
}));

vi.mock('~/features/organizations/server/organization-management', () => ({
  createOrganizationInvitationServerFn: vi.fn(),
  updateOrganizationMemberRoleServerFn: vi.fn(),
  suspendOrganizationMemberServerFn: vi.fn(),
  deactivateOrganizationMemberServerFn: vi.fn(),
  reactivateOrganizationMemberServerFn: vi.fn(),
  removeOrganizationMemberServerFn: vi.fn(),
  cancelOrganizationInvitationServerFn: vi.fn(),
  bulkOrganizationDirectoryActionServerFn: vi.fn(),
  updateOrganizationSettingsServerFn: (...args: unknown[]) => updateSettingsMock(...args),
  deleteOrganizationServerFn: (...args: unknown[]) => deleteOrganizationMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/organizations/components/OrganizationWorkspaceTabs', () => ({
  OrganizationWorkspaceTabs: () => <div>Organization tabs</div>,
}));

describe('OrganizationSettingsManagement', () => {
  const searchParams = {
    page: 1,
    pageSize: 10,
    sortBy: 'createdAt' as const,
    sortOrder: 'desc' as const,
    secondarySortBy: 'email' as const,
    secondarySortOrder: 'asc' as const,
    search: '',
    kind: 'all' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    locationMock.state = {};
    useQueryMock.mockReset();
  });

  it('renders access guidance when the viewer cannot manage settings', () => {
    const settingsResponse = {
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: false,
        delete: false,
        edit: false,
        view: true,
        siteAdmin: false,
      },
      capabilities: {
        availableInviteRoles: [],
        canInvite: false,
        canUpdateSettings: false,
        canDeleteOrganization: false,
        canLeaveOrganization: true,
        canManageMembers: false,
        canManagePolicies: false,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: true,
      viewerRole: 'member' as const,
      canManage: false,
    };
    useQueryMock.mockReturnValue(settingsResponse);

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    expect(screen.getByText('Management access required')).toBeInTheDocument();
    expect(screen.getByText('Danger zone')).toBeInTheDocument();
  });

  it('uses the seeded organization name while settings are loading', () => {
    locationMock.state = {
      organizationBreadcrumb: {
        name: 'Cottage Hospital',
        slug: 'cottage-hospital',
      },
    };
    useQueryMock.mockReturnValue(undefined);

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    expect(screen.getByRole('heading', { name: 'Cottage Hospital' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Loading organization' })).not.toBeInTheDocument();
  });

  it('renders the profile card and updates an organization from the edit modal', async () => {
    const user = userEvent.setup();

    const settingsResponse = {
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: false,
        delete: false,
        edit: false,
        view: true,
        siteAdmin: false,
      },
      capabilities: {
        availableInviteRoles: ['owner', 'admin', 'member'],
        canInvite: true,
        canUpdateSettings: true,
        canDeleteOrganization: true,
        canLeaveOrganization: true,
        canManageMembers: true,
        canManagePolicies: true,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: true,
      viewerRole: 'site-admin',
      canManage: true,
    };
    useQueryMock.mockReturnValue(settingsResponse);
    updateSettingsMock.mockResolvedValueOnce({ success: true });

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    expect(screen.getByText('Organization profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit profile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave organization/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete organization/i })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /edit profile/i })[0]!);

    const nameInput = await screen.findByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Cottage Hospital');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          name: 'New Cottage Hospital',
          logo: null,
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('Organization settings updated.', 'success');
    expect(notifyMock).toHaveBeenCalledWith('$activeOrgSignal');
    expect(notifyMock).toHaveBeenCalledWith('$sessionSignal');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['organizations'] });
    expect(routerInvalidateMock).toHaveBeenCalled();
  });

  it('does not show leave organization for a site admin who is not a member', async () => {
    const user = userEvent.setup();

    const settingsResponse = {
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
        availableInviteRoles: ['owner', 'admin', 'member'],
        canInvite: true,
        canUpdateSettings: true,
        canDeleteOrganization: true,
        canLeaveOrganization: false,
        canManageMembers: true,
        canManagePolicies: true,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: false,
      viewerRole: 'site-admin' as const,
      canManage: true,
    };
    useQueryMock.mockReturnValue(settingsResponse);

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    expect(screen.queryByRole('button', { name: /leave organization/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete organization/i })).toBeInTheDocument();
  });

  it('hides delete for organization admins while keeping management actions', async () => {
    const user = userEvent.setup();

    const settingsResponse = {
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: true,
        delete: false,
        edit: true,
        view: true,
        siteAdmin: false,
      },
      capabilities: {
        availableInviteRoles: ['admin', 'member'],
        canInvite: true,
        canUpdateSettings: true,
        canDeleteOrganization: false,
        canLeaveOrganization: true,
        canManageMembers: true,
        canManagePolicies: false,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: true,
      viewerRole: 'admin' as const,
      canManage: true,
    };
    useQueryMock.mockReturnValue(settingsResponse);

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    expect(screen.getByRole('button', { name: /edit profile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave organization/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete organization/i })).not.toBeInTheDocument();
  });

  it('opens the delete confirmation dialog from the danger zone', async () => {
    const user = userEvent.setup();

    const settingsResponse = {
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
        availableInviteRoles: ['owner', 'admin', 'member'],
        canInvite: true,
        canUpdateSettings: true,
        canDeleteOrganization: true,
        canLeaveOrganization: true,
        canManageMembers: true,
        canManagePolicies: true,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: true,
      viewerRole: 'site-admin',
      canManage: true,
    };
    useQueryMock.mockReturnValue(settingsResponse);

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    await user.click(screen.getByRole('button', { name: /delete organization/i }));

    expect(screen.getByRole('heading', { name: /delete organization/i })).toBeInTheDocument();
    expect(
      screen.getByText(/delete cottage hospital and all organization-scoped data/i),
    ).toBeInTheDocument();
  });

  it('allows members to leave an organization from the danger zone', async () => {
    const user = userEvent.setup();

    const settingsResponse = {
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: false,
        delete: false,
        edit: false,
        view: true,
        siteAdmin: false,
      },
      capabilities: {
        availableInviteRoles: [],
        canInvite: false,
        canUpdateSettings: false,
        canDeleteOrganization: false,
        canLeaveOrganization: true,
        canManageMembers: false,
        canManagePolicies: false,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: true,
      viewerRole: 'member' as const,
      canManage: false,
    };
    useQueryMock.mockReturnValue(settingsResponse);
    leaveOrganizationMock.mockResolvedValueOnce({
      success: true,
      nextOrganizationId: 'org-2',
    });

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    await user.click(screen.getByRole('button', { name: /leave organization/i }));
    await user.type(screen.getByPlaceholderText('Cottage Hospital'), 'Cottage Hospital');
    await user.click(screen.getByRole('button', { name: /^leave organization$/i }));

    await waitFor(() => {
      expect(leaveOrganizationMock).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
        },
      });
    });
    expect(showToastMock).toHaveBeenCalledWith('You left the organization.', 'success');
  });

  it('shows only the leave control for members who can only leave', () => {
    const settingsResponse = {
      organization: {
        id: 'org-1',
        slug: 'cottage-hospital',
        name: 'Cottage Hospital',
        logo: null,
      },
      access: {
        admin: false,
        delete: false,
        edit: false,
        view: true,
        siteAdmin: false,
      },
      capabilities: {
        availableInviteRoles: [],
        canInvite: false,
        canUpdateSettings: false,
        canDeleteOrganization: false,
        canLeaveOrganization: true,
        canManageMembers: false,
        canManagePolicies: false,
      },
      policies: {
        invitePolicy: 'owners_admins',
        verifiedDomainsOnly: false,
        memberCap: null,
        mfaRequired: false,
      },
      isMember: true,
      viewerRole: 'member' as const,
      canManage: false,
    };
    useQueryMock.mockReturnValue(settingsResponse);

    render(<OrganizationSettingsManagement slug="cottage-hospital" searchParams={searchParams} />);

    expect(screen.queryByRole('button', { name: /edit profile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete organization/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave organization/i })).toBeInTheDocument();
  });
});
