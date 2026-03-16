import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileSessionsCard } from './ProfileSessionsCard';

const { signOutMock, revokeSessionMock, revokeOtherSessionsMock, showToastMock } = vi.hoisted(
  () => ({
    signOutMock: vi.fn(),
    revokeSessionMock: vi.fn(),
    revokeOtherSessionsMock: vi.fn(),
    showToastMock: vi.fn(),
  }),
);

vi.mock('~/features/profile/hooks/useProfileSessions', () => ({
  useProfileSessions: () => ({
    sessions: [
      {
        id: 'current-session',
        isCurrent: true,
        createdAt: 1,
        updatedAt: 10,
        expiresAt: 100,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0 Chrome',
      },
      {
        id: 'other-session',
        isCurrent: false,
        createdAt: 2,
        updatedAt: 9,
        expiresAt: 100,
        ipAddress: '10.0.0.2',
        userAgent: 'Mozilla/5.0 Safari',
      },
    ],
    isPending: false,
    error: null,
    revokeSession: revokeSessionMock,
    revokeOtherSessions: revokeOtherSessionsMock,
    refresh: vi.fn(),
  }),
}));

vi.mock('~/features/auth/auth-client', () => ({
  signOut: signOutMock,
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

describe('ProfileSessionsCard', () => {
  beforeEach(() => {
    signOutMock.mockReset();
    revokeSessionMock.mockReset();
    revokeOtherSessionsMock.mockReset();
    showToastMock.mockReset();
  });

  it('signs out the current session via Better Auth signOut', async () => {
    render(<ProfileSessionsCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(revokeSessionMock).not.toHaveBeenCalled();
  });
});
