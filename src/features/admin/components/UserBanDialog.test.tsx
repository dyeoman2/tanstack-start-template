import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { USER_ROLES } from '~/features/auth/types';
import { UserBanDialog } from './UserBanDialog';

const { banAdminUserServerFn, unbanAdminUserServerFn, invalidateQueriesMock } = vi.hoisted(() => ({
  banAdminUserServerFn: vi.fn(),
  unbanAdminUserServerFn: vi.fn(),
  invalidateQueriesMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('../server/admin-management', () => ({
  banAdminUserServerFn,
  unbanAdminUserServerFn,
}));

function renderDialog(user: Parameters<typeof UserBanDialog>[0]['user']) {
  return render(<UserBanDialog open user={user} onClose={vi.fn()} />);
}

describe('UserBanDialog', () => {
  it('submits ban requests with an optional reason', async () => {
    const user = userEvent.setup();
    banAdminUserServerFn.mockResolvedValueOnce(undefined);

    renderDialog({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      role: USER_ROLES.USER,
      emailVerified: true,
      banned: false,
      banReason: null,
      banExpires: null,
      onboardingStatus: 'not_started',
      onboardingDeliveryError: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    fireEvent.change(screen.getByLabelText('Ban reason'), {
      target: { value: 'Repeated abuse' },
    });
    await user.click(screen.getByRole('button', { name: /ban user/i }));

    await waitFor(() => {
      expect(banAdminUserServerFn).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          banReason: 'Repeated abuse',
          banExpiresIn: undefined,
        },
      });
    });
  });

  it('submits unban requests for banned users', async () => {
    const user = userEvent.setup();
    unbanAdminUserServerFn.mockResolvedValueOnce(undefined);

    renderDialog({
      id: 'user-2',
      email: 'user@example.com',
      name: 'User',
      role: USER_ROLES.USER,
      emailVerified: true,
      banned: true,
      banReason: 'Repeated abuse',
      banExpires: null,
      onboardingStatus: 'not_started',
      onboardingDeliveryError: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await user.click(screen.getByRole('button', { name: /unban user/i }));

    await waitFor(() => {
      expect(unbanAdminUserServerFn).toHaveBeenCalledWith({
        data: {
          userId: 'user-2',
        },
      });
    });
  });
});
