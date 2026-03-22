import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserCreateDialog } from './UserCreateDialog';

const invalidateQueriesMock = vi.fn();
const createAdminUserServerFnMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('../server/admin-management', () => ({
  createAdminUserServerFn: (...args: unknown[]) => createAdminUserServerFnMock(...args),
}));

describe('UserCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a user and invokes the success callback', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    createAdminUserServerFnMock.mockResolvedValueOnce({
      user: {
        id: 'user-1',
      },
      onboardingEmailSent: true,
    });

    render(<UserCreateDialog open onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Dr. Meredith Grey' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'meredith@example.com' },
    });
    await user.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => {
      expect(createAdminUserServerFnMock).toHaveBeenCalledWith({
        data: {
          name: 'Dr. Meredith Grey',
          email: 'meredith@example.com',
          role: 'user',
        },
      });
    });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['admin-users'] });
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingEmailSent: true,
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
