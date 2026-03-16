import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePasskeysCard } from './ProfilePasskeysCard';

const { addPasskeyMock, deletePasskeyMock, refetchMock, showToastMock, useListPasskeysMock } =
  vi.hoisted(() => ({
    addPasskeyMock: vi.fn(),
    deletePasskeyMock: vi.fn(),
    refetchMock: vi.fn(),
    showToastMock: vi.fn(),
    useListPasskeysMock: vi.fn(),
  }));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    passkey: {
      addPasskey: (...args: unknown[]) => addPasskeyMock(...args),
      deletePasskey: (...args: unknown[]) => deletePasskeyMock(...args),
    },
  },
  authHooks: {
    useListPasskeys: (...args: unknown[]) => useListPasskeysMock(...args),
  },
}));

describe('ProfilePasskeysCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addPasskeyMock.mockResolvedValue({ success: true });
    deletePasskeyMock.mockResolvedValue({ success: true });
    refetchMock.mockResolvedValue(undefined);
  });

  it('adds a passkey from the empty state', async () => {
    const user = userEvent.setup();

    useListPasskeysMock.mockReturnValue({
      data: [],
      isPending: false,
      refetch: refetchMock,
    });

    render(<ProfilePasskeysCard />);

    expect(screen.getByText('No passkeys added yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /add passkey/i }));

    await waitFor(() => {
      expect(addPasskeyMock).toHaveBeenCalledWith({
        fetchOptions: { throw: true },
      });
    });

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith('Passkey added.', 'success');
  });

  it('removes an existing passkey', async () => {
    const user = userEvent.setup();

    useListPasskeysMock.mockReturnValue({
      data: [
        {
          id: 'passkey_1',
          createdAt: new Date('2026-03-01T12:00:00Z').toISOString(),
          deviceType: 'singleDevice',
          name: 'MacBook Pro',
        },
      ],
      isPending: false,
      refetch: refetchMock,
    });

    render(<ProfilePasskeysCard />);

    await user.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(deletePasskeyMock).toHaveBeenCalledWith({
        id: 'passkey_1',
        fetchOptions: { throw: true },
      });
    });

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith('Passkey removed.', 'success');
  });
});
