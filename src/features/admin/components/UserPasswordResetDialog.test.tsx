import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '~/components/ui/toast';
import { USER_ROLES } from '~/features/auth/types';
import { UserPasswordResetDialog } from './UserPasswordResetDialog';

const { setAdminUserPasswordServerFn } = vi.hoisted(() => ({
  setAdminUserPasswordServerFn: vi.fn(),
}));

vi.mock('../server/admin-management', () => ({
  setAdminUserPasswordServerFn,
}));

function renderDialog() {
  return render(
    <ToastProvider>
      <UserPasswordResetDialog
        open
        user={{
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          role: USER_ROLES.USER,
          emailVerified: true,
          banned: false,
          banReason: null,
          banExpires: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  );
}

describe('UserPasswordResetDialog', () => {
  it('blocks weak passwords before submitting', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('New password'), 'weak');
    await user.type(screen.getByLabelText('Confirm password'), 'weak');

    expect(screen.getByText('Password must be at least 8 characters long')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
    expect(setAdminUserPasswordServerFn).not.toHaveBeenCalled();
  });

  it('submits matching strong passwords', async () => {
    const user = userEvent.setup();
    setAdminUserPasswordServerFn.mockResolvedValueOnce({ status: true });

    renderDialog();

    await user.type(screen.getByLabelText('New password'), 'StrongPass1!');
    await user.type(screen.getByLabelText('Confirm password'), 'StrongPass1!');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(setAdminUserPasswordServerFn).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          newPassword: 'StrongPass1!',
        },
      });
    });
  });
});
