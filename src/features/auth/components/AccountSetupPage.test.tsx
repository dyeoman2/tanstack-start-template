import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSetupPage } from './AccountSetupPage';

const {
  invalidateMock,
  navigateMock,
  invalidateQueriesMock,
  setQueryDataMock,
  clipboardWriteTextMock,
  refreshAuthClientSessionMock,
  sendVerificationEmailMock,
  addPasskeyMock,
  createOrganizationAdminStepUpChallengeMock,
  beginAuthenticatorOnboardingMock,
  signOutMock,
  useAuthMock,
  useQueryMock,
} = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  navigateMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  setQueryDataMock: vi.fn(),
  clipboardWriteTextMock: vi.fn(),
  refreshAuthClientSessionMock: vi.fn(),
  sendVerificationEmailMock: vi.fn(),
  addPasskeyMock: vi.fn(),
  createOrganizationAdminStepUpChallengeMock: vi.fn(),
  beginAuthenticatorOnboardingMock: vi.fn(),
  signOutMock: vi.fn(),
  useAuthMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

const queryClientMock = {
  invalidateQueries: invalidateQueriesMock,
  setQueryData: setQueryDataMock,
};

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
    emailVerified?: boolean;
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

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClientMock,
}));

vi.mock('convex/react', () => ({
  useQuery: useQueryMock,
  useMutation: () => createOrganizationAdminStepUpChallengeMock,
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
  },
  refreshAuthClientSession: (...args: unknown[]) => refreshAuthClientSessionMock(...args),
  signOut: (...args: unknown[]) => signOutMock(...args),
}));

vi.mock('~/features/auth/server/onboarding', () => ({
  beginAuthenticatorOnboardingServerFn: (...args: unknown[]) =>
    beginAuthenticatorOnboardingMock(...args),
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
    clipboardWriteTextMock.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: clipboardWriteTextMock,
      },
    });
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        writeText: clipboardWriteTextMock,
      },
      configurable: true,
    });
    invalidateMock.mockResolvedValue(undefined);
    navigateMock.mockResolvedValue(undefined);
    refreshAuthClientSessionMock.mockResolvedValue({ user: { emailVerified: false } });
    useQueryMock.mockReturnValue({ isConfigured: true });
    sendVerificationEmailMock.mockResolvedValue({ success: true });
    addPasskeyMock.mockResolvedValue({});
    createOrganizationAdminStepUpChallengeMock.mockResolvedValue({
      challengeId: 'challenge-1',
      redirectTo: '/app',
      requirement: 'organizationAdmin',
    });
    beginAuthenticatorOnboardingMock.mockResolvedValue({
      backupCodes: [],
      totpURI: null,
    });
    signOutMock.mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(createAuthState());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the verification checkpoint for signed-out users with concise rationale', () => {
    render(<AccountSetupPage email="person@example.com" redirectTo="/app/admin" />);

    expect(
      screen.getByText(
        'We require a verified email and multi-factor authentication before granting app access.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Check person@example.com to continue.')).not.toBeInTheDocument();
    expect(
      screen.getByText('We sent a verification email to person@example.com.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Open the link in that email to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new verification email' })).toBeEnabled();
    expect(screen.getByRole('button', { name: "I've verified my email" })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Wrong email? Use another account' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'Sign in to continue' })).not.toBeInTheDocument();
  });

  it('uses verified callbacks to try automatic session recovery before step two opens', async () => {
    let currentAuthState = createAuthState();
    useAuthMock.mockImplementation(() => currentAuthState);
    refreshAuthClientSessionMock.mockImplementation(async () => {
      currentAuthState = createAuthState({
        hasSession: true,
        isAuthenticated: true,
        requiresEmailVerification: false,
        requiresMfaSetup: true,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          emailVerified: true,
          role: 'user',
          isSiteAdmin: false,
        },
      });

      return { user: { emailVerified: true } };
    });

    render(
      <AccountSetupPage email="person@example.com" redirectTo="/app/admin" verified="success" />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
    });

    expect(screen.queryByRole('link', { name: 'Sign in to continue' })).not.toBeInTheDocument();
  });

  it('falls back to manual sign-in only after automatic continuation fails', async () => {
    refreshAuthClientSessionMock
      .mockResolvedValueOnce({ user: { emailVerified: false } })
      .mockRejectedValueOnce(new Error('session restore failed'));

    render(
      <AccountSetupPage email="person@example.com" redirectTo="/app/admin" verified="success" />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "We couldn't continue automatically. Sign in to finish setting up your account.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
        'href',
        '/login?email=person%40example.com&redirectTo=%2Fapp%2Fadmin',
      );
    });
  });

  it('lets users continue strong-auth setup as soon as a verified Better Auth session exists', () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        hasSession: true,
        isAuthenticated: false,
        user: {
          id: 'user-1',
          email: 'person@example.com',
          emailVerified: true,
          role: 'user',
          isSiteAdmin: false,
        },
      }),
    );

    render(<AccountSetupPage />);

    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
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
      screen.getByText('We sent a verification email to person@example.com.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new verification email' })).toBeEnabled();
    expect(screen.getByRole('button', { name: "I've verified my email" })).toBeEnabled();
    expect(screen.getByText('Available after verification')).toBeInTheDocument();
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

    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use authenticator app' })).toBeEnabled();
    expect(screen.getByText('Set up MFA')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send a new verification email' }),
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

    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeEnabled();
  });

  it('replaces stale-session passkey errors with re-auth guidance', async () => {
    const user = userEvent.setup();
    addPasskeyMock.mockRejectedValue({
      error: {
        code: 'SESSION_NOT_FRESH',
        message: 'SESSION_NOT_FRESH',
      },
    });
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

    render(<AccountSetupPage redirectTo="/app/admin" />);

    await user.click(screen.getByRole('button', { name: 'Add passkey' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'For security, passkey setup requires a recent sign-in. Sign in again to continue, then return here to finish MFA setup.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign in again to add passkey' })).toHaveAttribute(
        'href',
        '/login?email=person%40example.com&redirectTo=%2Fapp%2Fadmin',
      );
    });

    expect(screen.queryByText('SESSION_NOT_FRESH')).not.toBeInTheDocument();
  });

  it('lets users copy and download backup codes before continuing', async () => {
    const user = userEvent.setup();
    const createObjectURLMock = vi.fn(() => 'blob:backup-codes');
    const revokeObjectURLMock = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURLMock,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURLMock,
      configurable: true,
    });

    beginAuthenticatorOnboardingMock.mockResolvedValue({
      backupCodes: ['abc-123', 'def-456'],
      totpURI: 'otpauth://totp/example',
    });
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

    await user.click(screen.getByRole('button', { name: 'Use authenticator app' }));

    expect(await screen.findByText('Save your backup codes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy codes' }));
    expect(screen.getByRole('button', { name: 'Backup codes copied' })).toBeInTheDocument();
    expect(screen.queryByText('Backup codes copied.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download codes' }));
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:backup-codes');
    expect(screen.getByRole('button', { name: 'Backup codes downloaded' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('button', { name: 'Continuing...' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Continuing...' }).querySelector('.animate-spin'),
    ).toBeTruthy();
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/two-factor',
      search: { totpURI: 'otpauth://totp/example' },
    });

    clickSpy.mockRestore();
    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreateObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevokeObjectURL,
      configurable: true,
    });
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

    await user.click(screen.getByRole('button', { name: 'Send a new verification email' }));

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

    await user.click(screen.getByRole('button', { name: 'Send a new verification email' }));

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
      expect(refreshAuthClientSessionMock).toHaveBeenCalledWith(queryClientMock);
      expect(invalidateMock).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          'Still waiting for verification. Open the latest email link or resend the email.',
        ),
      ).toBeInTheDocument();
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

    refreshAuthClientSessionMock.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refreshAuthClientSessionMock).toHaveBeenCalledTimes(1);

    unmount();
    refreshAuthClientSessionMock.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refreshAuthClientSessionMock).not.toHaveBeenCalled();
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
    expect(refreshAuthClientSessionMock).not.toHaveBeenCalled();
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
