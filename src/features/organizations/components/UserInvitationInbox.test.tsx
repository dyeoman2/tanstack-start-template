import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserInvitationInbox } from './UserInvitationInbox';

const {
  navigateMock,
  routerInvalidateMock,
  showToastMock,
  invalidateQueriesMock,
  useAuthQueryMock,
  acceptInvitationMock,
  rejectInvitationMock,
  notifyMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerInvalidateMock: vi.fn(),
  showToastMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  useAuthQueryMock: vi.fn(),
  acceptInvitationMock: vi.fn(),
  rejectInvitationMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: routerInvalidateMock }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    organization: {
      listUserInvitations: vi.fn(),
      acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
      rejectInvitation: (...args: unknown[]) => rejectInvitationMock(...args),
    },
    $store: {
      notify: notifyMock,
    },
  },
  authHooks: {
    useAuthQuery: (...args: unknown[]) => useAuthQueryMock(...args),
  },
}));

describe('UserInvitationInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the inbox when there are no invitations', () => {
    useAuthQueryMock.mockReturnValue({
      data: [],
      isPending: false,
    });

    const { container } = render(<UserInvitationInbox />);

    expect(container).toBeEmptyDOMElement();
  });

  it('accepts invitations from the native inbox', async () => {
    const user = userEvent.setup();
    useAuthQueryMock.mockReturnValue({
      data: [
        {
          id: 'invite-1',
          email: 'doctor@example.com',
          role: 'member',
          organizationId: 'org-1',
          organizationName: 'Seattle Grace',
          inviterId: 'user-1',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      isPending: false,
    });
    acceptInvitationMock.mockResolvedValueOnce({ success: true });

    render(<UserInvitationInbox />);

    await user.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: 'invite-1',
        fetchOptions: { throw: true },
      });
    });

    expect(showToastMock).toHaveBeenCalledWith('Invitation accepted.', 'success');
  });

  it('shows a verification-specific error when invite acceptance is blocked', async () => {
    const user = userEvent.setup();
    useAuthQueryMock.mockReturnValue({
      data: [
        {
          id: 'invite-1',
          email: 'doctor@example.com',
          role: 'member',
          organizationId: 'org-1',
          organizationName: 'Seattle Grace',
          inviterId: 'user-1',
          status: 'pending',
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      isPending: false,
    });
    const error = new Error('Email verification required before accepting or rejecting invitation');
    Object.assign(error, {
      code: 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION',
    });
    acceptInvitationMock.mockRejectedValueOnce(error);

    render(<UserInvitationInbox />);

    await user.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        'Verify your email address before responding to this invitation.',
        'error',
      );
    });
  });
});
