import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrganizationMembersTable } from './OrganizationMembersTable';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const baseProps = {
  slug: 'cottage-hospital',
  pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
  searchParams: {
    page: 1,
    pageSize: 10,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
    secondarySortBy: 'email' as const,
    secondarySortOrder: 'asc' as const,
    search: '',
    kind: 'all' as const,
  },
  isLoading: false,
  onChangeRole: vi.fn(),
  onCopyInvitationLink: vi.fn(),
  onDeactivateMember: vi.fn(),
  onRemoveMember: vi.fn(),
  onReactivateMember: vi.fn(),
  onRevokeInvitation: vi.fn(),
  onResendInvitation: vi.fn(),
  onSuspendMember: vi.fn(),
  onToggleAllRows: vi.fn(),
  onToggleRow: vi.fn(),
  selectedRowIds: new Set<string>(),
};

describe('OrganizationMembersTable', () => {
  it('shows site admin badge inline with the name', () => {
    render(
      <OrganizationMembersTable
        {...baseProps}
        rows={[
          {
            id: 'member:1',
            kind: 'member',
            membershipId: 'member-1',
            authUserId: 'user-1',
            name: 'Daniel Yeoman',
            email: 'daniel@example.com',
            role: 'owner',
            status: 'active',
            createdAt: Date.now(),
            isSiteAdmin: true,
            availableRoles: ['owner', 'admin', 'member'],
            canChangeRole: true,
            canRemove: true,
            canSuspend: true,
            canDeactivate: true,
            canReactivate: false,
          },
        ]}
      />,
    );

    const row = screen.getByRole('row', { name: /daniel yeoman site admin daniel@example.com/i });
    const nameCell = within(row).getByText('Daniel Yeoman').closest('td');
    expect(nameCell).not.toBeNull();
    expect(within(nameCell as HTMLElement).getByText('Daniel Yeoman')).toBeInTheDocument();
    expect(within(nameCell as HTMLElement).getByText('Site admin')).toBeInTheDocument();
  });

  it('offers resend, copy, and revoke actions for invitation rows', async () => {
    const user = userEvent.setup();

    render(
      <OrganizationMembersTable
        {...baseProps}
        rows={[
          {
            id: 'invite:1',
            kind: 'invite',
            invitationId: 'invite-1',
            name: null,
            email: 'invitee@example.com',
            role: 'member',
            status: 'pending',
            createdAt: Date.now(),
            expiresAt: Date.now() + 86_400_000,
            canRevoke: true,
          },
        ]}
      />,
    );

    const row = screen.getByRole('row', { name: /pending invite invitee@example.com/i });
    await user.click(within(row).getByRole('button', { name: 'Organization row actions' }));

    await user.click(screen.getByRole('menuitem', { name: /resend invitation/i }));
    expect(baseProps.onResendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: 'invite-1' }),
    );

    await user.click(within(row).getByRole('button', { name: 'Organization row actions' }));
    await user.click(screen.getByRole('menuitem', { name: /copy invite link/i }));
    expect(baseProps.onCopyInvitationLink).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: 'invite-1' }),
    );

    await user.click(within(row).getByRole('button', { name: 'Organization row actions' }));
    await user.click(screen.getByRole('menuitem', { name: /revoke invitation/i }));
    expect(baseProps.onRevokeInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: 'invite-1' }),
    );
  });
});
