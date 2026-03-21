import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSetupPage } from './AccountSetupPage';

const {
  invalidateMock,
  navigateMock,
  sendVerificationEmailMock,
  addPasskeyMock,
  enableTwoFactorMock,
  signOutMock,
  useAuthMock,
  useQueryMock,
} = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  navigateMock: vi.fn(),
  sendVerificationEmailMock: vi.fn(),
  addPasskeyMock: vi.fn(),
  enableTwoFactorMock: vi.fn(),
  signOutMock: vi.fn(),
  useAuthMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

type MockAuthState = {
  hasSession: boolean;
  isAuthenticated: boolean;
  isSiteAdmin: boolean;
  requiresEmailVerification: boolean;
  requiresMfaSetup: boolean;
  hasRecentStepUp: boolean;
  isImpersonating: boolean;
  isPending: boolean;
  error: Error | null;
  user: {
    id: string;
    email: string;
    role: string;
    isSiteAdmin: boolean;
  } | null;
};

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
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  useRouter: () => ({
    invalidate: invalidateMock,
    navigate: navigateMock,
  }),
}));

vi.mock('convex/react', () => ({
  useQuery: useQueryMock,
}));

vi.mock('~/features/auth/hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
    passkey: {
      addPasskey: (...args: unknown[]) => addPasskeyMock(...args),
    },
    twoFactor: {
      enable: (...args: unknown[]) => enableTwoFactorMock(...args),
    },
  },
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

function createAuthState(overrides: Partial<MockAuthState> = {}): MockAuthState {
  return {
    hasSession: false,
    isAuthenticated: false,
    isSiteAdmin: false,
    requiresEmailVerification: false,
    requiresMfaSetup: false,
    hasRecentStepUp: false,
    isImpersonating: false,
    isPending: false,
    error: null,
    user: null,
    ...overrides,
  };
}

describe('AccountSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateMock.mockResolvedValue(undefined);
    navigateMock.mockResolvedValue(undefined);
    useQueryMock.mockReturnValue({ isConfigured: true });
    sendVerificationEmailMock.mockResolvedValue({ success: true });
    addPasskeyMock.mockResolvedValue({});
    enableTwoFactorMock.mockResolvedValue({ backupCodes: [], totpURI: null });
    signOutMock.mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(createAuthState());
  });

  it('shows the verification checkpoint for signed-out users with concise rationale', () => {
    render(<AccountSetupPage email="person@example.com" redirectTo="/app/admin" />);

    expect(
      screen.getByText(
        'To protect workspace access, we require a verified email and a strong second sign-in method before granting app access.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Check your inbox for the verification link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeEnabled();
    expect(screen.getByRole('button', { name: "I've verified my email" })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Wrong email? Use another account' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'Sign in to continue' })).not.toBeInTheDocument();
  });

  it('treats callback verification as completing step one and prompting sign-in', () => {
    render(
      <AccountSetupPage email="person@example.com" redirectTo="/app/admin" verified="success" />,
    );

    expect(
      screen.getByText(
        'person@example.com is verified. Sign in to add your passkey or authenticator.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
      'href',
      '/login?email=person%40example.com&redirectTo=%2Fapp%2Fadmin',
    );
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' }),
    ).not.toBeInTheDocument();
  });

  it('shows neutral bridging copy when a Better Auth session exists but app auth is still resolving', () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: false,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage />);

    expect(
      screen.getByText(/checking whether person@example.com has completed the verification step/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/we'll keep checking automatically, or you can confirm below/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I've verified my email" })).toBeEnabled();
  });

  it('treats email verification as the current step and keeps security locked', () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: true,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage />);

    expect(
      screen.getByText('Verify person@example.com to continue to passkey or authenticator setup.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeEnabled();
    expect(screen.getByRole('button', { name: "I've verified my email" })).toBeEnabled();
    expect(screen.getByText('Locked until email is verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add passkey' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wrong email? Use another account' })).toBeEnabled();
  });

  it('treats security as the current step once email is complete', () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: false,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage />);

    expect(
      screen.getByText(
        'person@example.com is verified. Add a passkey or authenticator to finish setup.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use authenticator app instead' })).toBeEnabled();
    expect(screen.getByText('Add a passkey or authenticator')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' }),
    ).not.toBeInTheDocument();
  });

  it('redirects satisfied users to the target app route', () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: false,
        requiresMfaSetup: false,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage redirectTo="/app/admin" />);

    expect(screen.getByTestId('navigate')).toHaveTextContent('/app/admin');
  });

  it('keeps the success message and current step aligned after email verification callbacks', () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: false,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage verified="success" />);

    expect(
      screen.getByText('Email verified. Finish securing your account to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
  });

  it('resends verification email only when that action is the current step', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: true,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage redirectTo="/app" />);

    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() => {
      expect(sendVerificationEmailMock).toHaveBeenCalledWith({
        email: 'person@example.com',
        callbackURL: expect.stringContaining('/account-setup?verified=success'),
        fetchOptions: { throw: true },
      });
    });
  });

  it('allows signed-out users to resend verification email when the email is known', async () => {
    const user = userEvent.setup();

    render(<AccountSetupPage email="person@example.com" redirectTo="/app" />);

    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() => {
      expect(sendVerificationEmailMock).toHaveBeenCalledWith({
        email: 'person@example.com',
        callbackURL: expect.stringContaining('/account-setup?verified=success'),
        fetchOptions: { throw: true },
      });
    });
  });

  it('uses the explicit verification check action', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: true,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage />);

    await user.click(screen.getByRole('button', { name: "I've verified my email" }));

    await waitFor(() => {
      expect(invalidateMock).toHaveBeenCalled();
    });
  });

  it('starts background polling only while verification is pending and stops on unmount', async () => {
    vi.useFakeTimers();
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: true,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    const { unmount } = render(<AccountSetupPage />);

    invalidateMock.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(invalidateMock).toHaveBeenCalledTimes(1);

    unmount();
    invalidateMock.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(invalidateMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not start polling once the user is on the secure-account step', async () => {
    vi.useFakeTimers();
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: false,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage />);

    await vi.advanceTimersByTimeAsync(5000);
    expect(invalidateMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('lets the user recover by switching to another account', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: true,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage redirectTo="/app/admin" />);

    await user.click(screen.getByRole('button', { name: 'Wrong email? Use another account' }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalled();
      expect(invalidateMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/login',
        search: { redirectTo: '/app/admin' },
        replace: true,
      });
    });
  });
});
