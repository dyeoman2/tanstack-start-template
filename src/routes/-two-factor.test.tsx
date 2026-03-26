import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorPage } from '~/features/auth/components/TwoFactorPage';

const {
  invalidateMock,
  navigateMock,
  showToastMock,
  useSearchMock,
  useQueryMock,
  verifyTotpMock,
  useSessionMock,
  toDataUrlMock,
} = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  navigateMock: vi.fn(),
  showToastMock: vi.fn(),
  useSearchMock: vi.fn(),
  useQueryMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  useSessionMock: vi.fn(),
  toDataUrlMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: string;
    search?: Record<string, string>;
  }) => (
    <a
      href={
        typeof to === 'string'
          ? `${to}${search ? `?${new URLSearchParams(search).toString()}` : ''}`
          : undefined
      }
      {...props}
    >
      {children}
    </a>
  ),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    options: config,
    useSearch: () => useSearchMock(),
  }),
  useRouter: () => ({
    invalidate: invalidateMock,
    navigate: navigateMock,
  }),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataUrlMock(...args),
  },
}));

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    twoFactor: {
      verifyTotp: (...args: unknown[]) => verifyTotpMock(...args),
    },
  },
  useSession: (...args: unknown[]) => useSessionMock(...args),
}));

describe('TwoFactorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchMock.mockReturnValue({
      redirectTo: undefined,
      totpURI: 'otpauth://totp/example?secret=ABC123&issuer=Example',
    });
    verifyTotpMock.mockResolvedValue({ success: true });
    invalidateMock.mockResolvedValue(undefined);
    navigateMock.mockResolvedValue(undefined);
    useQueryMock.mockReturnValue(null);
    useSessionMock.mockReturnValue({
      data: {
        user: {
          email: 'person@example.com',
        },
      },
    });
    toDataUrlMock.mockResolvedValue('data:image/png;base64,qr');
  });

  it('submits the authenticator code without a trust-device bypass', async () => {
    const user = userEvent.setup();

    render(<TwoFactorPage />);

    expect(screen.queryByLabelText('Trust this device for future logins')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('One-Time Password'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and enable' }));

    await waitFor(() => {
      expect(verifyTotpMock).toHaveBeenCalledWith({
        code: '123456',
        fetchOptions: { throw: true },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Redirecting...' })).toBeDisabled();
    });
  });
});
