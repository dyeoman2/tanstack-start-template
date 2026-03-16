import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteAcceptanceCard } from './InviteAcceptanceCard';

const {
  acceptInvitationMock,
  invalidateQueriesMock,
  navigateMock,
  refreshOrganizationClientStateMock,
  rejectInvitationMock,
  routerInvalidateMock,
  showToastMock,
  useInvitationMock,
} = vi.hoisted(() => ({
  acceptInvitationMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  navigateMock: vi.fn(),
  refreshOrganizationClientStateMock: vi.fn(),
  rejectInvitationMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  showToastMock: vi.fn(),
  useInvitationMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate-redirect">{to}</div>,
  useNavigate: () => navigateMock,
  useRouter: () => ({
    invalidate: routerInvalidateMock,
  }),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/auth/hooks/useAuthState', () => ({
  useAuthState: () => ({
    isAuthenticated: true,
    isPending: false,
  }),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    organization: {
      acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
      rejectInvitation: (...args: unknown[]) => rejectInvitationMock(...args),
    },
  },
  authHooks: {
    useInvitation: (...args: unknown[]) => useInvitationMock(...args),
  },
}));

vi.mock('~/features/organizations/lib/organization-session', () => ({
  refreshOrganizationClientState: (...args: unknown[]) =>
    refreshOrganizationClientStateMock(...args),
}));

describe('InviteAcceptanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acceptInvitationMock.mockResolvedValue({ success: true });
    rejectInvitationMock.mockResolvedValue({ success: true });
    refreshOrganizationClientStateMock.mockResolvedValue(undefined);
    navigateMock.mockResolvedValue(undefined);
    routerInvalidateMock.mockResolvedValue(undefined);
  });

  it('accepts an invitation and redirects to organizations', async () => {
    const user = userEvent.setup();

    useInvitationMock.mockReturnValue({
      data: {
        email: 'doctor@example.com',
        id: 'invite_1',
        organizationName: 'Seattle Grace',
        role: 'member',
      },
      error: null,
      isPending: false,
    });

    render(<InviteAcceptanceCard token="invite_1" />);

    await user.click(screen.getByRole('button', { name: /accept invitation/i }));

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: 'invite_1',
        fetchOptions: { throw: true },
      });
    });

    expect(refreshOrganizationClientStateMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith('Invitation accepted.', 'success');
    expect(navigateMock).toHaveBeenCalledWith({ to: '/app/organizations' });
  });

  it('shows the unavailable state when the invitation cannot be loaded', () => {
    useInvitationMock.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
    });

    render(<InviteAcceptanceCard token="missing_invite" />);

    expect(screen.getByText('Invitation unavailable')).toBeInTheDocument();
    expect(
      screen.getByText('This invitation is invalid, expired, or has already been used.'),
    ).toBeInTheDocument();
  });
});
