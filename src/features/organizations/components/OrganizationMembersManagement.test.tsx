import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationMembersManagement } from './OrganizationMembersManagement';

const navigateMock = vi.fn();
const showToastMock = vi.fn();
const createInvitationMock = vi.fn();
const updateMemberRoleMock = vi.fn();
const removeMemberMock = vi.fn();
const cancelInvitationMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock('~/features/organizations/server/organization-management', () => ({
  createOrganizationInvitationServerFn: (...args: unknown[]) => createInvitationMock(...args),
  updateOrganizationMemberRoleServerFn: (...args: unknown[]) => updateMemberRoleMock(...args),
  removeOrganizationMemberServerFn: (...args: unknown[]) => removeMemberMock(...args),
  cancelOrganizationInvitationServerFn: (...args: unknown[]) => cancelInvitationMock(...args),
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
  });

  it('navigates sorting changes to the consolidated settings route', async () => {
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
      to: '/app/organizations/$slug/settings',
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
