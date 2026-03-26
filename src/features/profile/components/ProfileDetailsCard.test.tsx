import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileData } from '~/features/profile/hooks/useProfile';
import { ProfileDetailsCard } from './ProfileDetailsCard';

const {
  changeEmailMock,
  createProfileEmailChangeStepUpChallengeServerFnMock,
  navigateMock,
  updateUserMock,
} = vi.hoisted(() => ({
  changeEmailMock: vi.fn(),
  createProfileEmailChangeStepUpChallengeServerFnMock: vi.fn(),
  navigateMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    changeEmail: (...args: unknown[]) => changeEmailMock(...args),
    updateUser: (...args: unknown[]) => updateUserMock(...args),
  },
}));

vi.mock('~/features/auth/server/step-up', () => ({
  createProfileEmailChangeStepUpChallengeServerFn: (...args: unknown[]) =>
    createProfileEmailChangeStepUpChallengeServerFnMock(...args),
}));

describe('ProfileDetailsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changeEmailMock.mockResolvedValue({ success: true });
    createProfileEmailChangeStepUpChallengeServerFnMock.mockResolvedValue({
      challengeId: '550e8400-e29b-41d4-a716-446655440000',
      redirectTo: '/app/profile',
      requirement: 'account_email_change',
    });
    navigateMock.mockResolvedValue(undefined);
    updateUserMock.mockResolvedValue({ success: true });
  });

  it('requests an email change with the profile callback URL when recent step-up is valid', async () => {
    const user = userEvent.setup();
    const profile: ProfileData = {
      id: 'user_1',
      email: 'current@example.com',
      name: 'Doctor Meredith Grey',
      phoneNumber: '(805) 123-4567',
      role: 'user',
      isSiteAdmin: false,
      currentOrganization: null,
      requiresEmailVerification: true,
      mfaEnabled: false,
      mfaRequired: true,
      requiresMfaSetup: false,
      recentStepUpAt: Date.now(),
      recentStepUpValidUntil: Date.now() + 5 * 60 * 1000,
      createdAt: new Date('2026-03-01T12:00:00Z'),
      updatedAt: new Date('2026-03-02T12:00:00Z'),
      emailVerified: false,
      organizations: [],
    };

    render(<ProfileDetailsCard profile={profile} />);

    const emailInput = screen.getByDisplayValue('current@example.com');
    fireEvent.change(emailInput, { target: { value: 'updated@example.com' } });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(changeEmailMock).toHaveBeenCalledWith({
        newEmail: 'updated@example.com',
        callbackURL: '/app/profile',
        fetchOptions: { throw: true },
      });
    });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Your changes were saved. Check your inbox to confirm the new email address.',
      ),
    ).toBeInTheDocument();
  });

  it('redirects through the profile step-up flow before changing email when recent verification is missing', async () => {
    const user = userEvent.setup();
    const profile: ProfileData = {
      id: 'user_1',
      email: 'current@example.com',
      name: 'Doctor Meredith Grey',
      phoneNumber: '(805) 123-4567',
      role: 'user',
      isSiteAdmin: false,
      currentOrganization: null,
      requiresEmailVerification: true,
      mfaEnabled: false,
      mfaRequired: true,
      requiresMfaSetup: false,
      recentStepUpAt: null,
      recentStepUpValidUntil: null,
      createdAt: new Date('2026-03-01T12:00:00Z'),
      updatedAt: new Date('2026-03-02T12:00:00Z'),
      emailVerified: false,
      organizations: [],
    };

    render(<ProfileDetailsCard profile={profile} />);

    const emailInput = screen.getByDisplayValue('current@example.com');
    fireEvent.change(emailInput, { target: { value: 'updated@example.com' } });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/profile',
        search: {
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          security: 'step-up-required',
        },
        replace: true,
      });
    });

    expect(changeEmailMock).not.toHaveBeenCalled();
  });
});
