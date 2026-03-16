import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordRequestCard } from './ForgotPasswordRequestCard';

const requestPasswordResetMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) => requestPasswordResetMock(...args),
  },
}));

describe('ForgotPasswordRequestCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestPasswordResetMock.mockResolvedValue({ success: true });
  });

  it('submits a password reset request with the prefilled email and redirect target', async () => {
    const user = userEvent.setup();

    render(
      <ForgotPasswordRequestCard
        email="doctor@example.com"
        redirectTo="/reset-password?from=forgot-password"
      />,
    );

    expect(screen.getByLabelText('Email')).toHaveValue('doctor@example.com');

    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(requestPasswordResetMock).toHaveBeenCalledWith({
        email: 'doctor@example.com',
        redirectTo: '/reset-password?from=forgot-password',
        fetchOptions: { throw: true },
      });
    });

    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
  });

  it('blocks invalid email input before calling Better Auth', async () => {
    const user = userEvent.setup();

    render(<ForgotPasswordRequestCard />);

    await user.type(screen.getByLabelText('Email'), 'invalid-email');
    const form = screen.getByRole('button', { name: /send reset link/i }).closest('form');
    if (!form) {
      throw new Error('Expected forgot password form to be rendered');
    }

    fireEvent.submit(form);

    expect(requestPasswordResetMock).not.toHaveBeenCalled();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
  });
});
