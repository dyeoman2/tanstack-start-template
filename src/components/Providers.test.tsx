import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ensureCurrentUserContextMock,
  setSentryUserMock,
  setupClaimRefreshMock,
  useActionMock,
  useAuthMock,
  useConvexAuthMock,
} = vi.hoisted(() => ({
  ensureCurrentUserContextMock: vi.fn(),
  setSentryUserMock: vi.fn(),
  setupClaimRefreshMock: vi.fn(() => vi.fn()),
  useActionMock: vi.fn(),
  useAuthMock: vi.fn(),
  useConvexAuthMock: vi.fn(),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    users: {
      ensureCurrentUserContext: 'ensureCurrentUserContext',
    },
  },
}));

vi.mock('@convex-dev/better-auth/react', () => ({
  ConvexBetterAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock('@tanstack/react-start', () => ({
  getGlobalStartContext: () => null,
}));

vi.mock('convex/react', () => ({
  useAction: (...args: unknown[]) => useActionMock(...args),
  useConvexAuth: (...args: unknown[]) => useConvexAuthMock(...args),
}));

vi.mock('~/components/ErrorBoundary', () => ({
  ErrorBoundaryWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('~/components/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('~/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('~/features/auth/auth-client-internal', () => ({
  rawAuthClient: {},
}));

vi.mock('~/features/auth/components/DevAuthOriginWarning', () => ({
  DevAuthOriginWarning: () => null,
}));

vi.mock('~/features/auth/hooks/useAuth', () => ({
  useAuth: (...args: unknown[]) => useAuthMock(...args),
}));

vi.mock('~/lib/convexClient', () => ({
  convexClient: {},
}));

vi.mock('~/lib/roleRefresh', () => ({
  setupClaimRefresh: () => setupClaimRefreshMock(),
}));

vi.mock('~/lib/sentry', () => ({
  setSentryUser: (...args: unknown[]) => setSentryUserMock(...args),
}));

describe('Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      user: {
        id: 'user_1',
        email: 'person@example.com',
        name: 'Person',
        role: 'user',
      },
      isAuthenticated: true,
      isPending: false,
      isSiteAdmin: false,
      requiresMfaSetup: false,
      requiresMfaVerification: false,
    });
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    useActionMock.mockReturnValue(ensureCurrentUserContextMock);
  });

  it('swallows expected MFA_REQUIRED failures from eager context ensuring', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ensureCurrentUserContextMock.mockRejectedValue({
      data: { code: 'MFA_REQUIRED' },
    });

    const { Providers } = await import('./Providers');
    render(<Providers>child</Providers>);

    await waitFor(() => {
      expect(ensureCurrentUserContextMock).toHaveBeenCalledWith({});
    });
    await waitFor(() => {
      expect(infoSpy).toHaveBeenCalledWith(
        '[auth] Skipping user context ensure until session assurance is available',
      );
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns for unexpected ensureCurrentUserContext failures', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('boom');
    ensureCurrentUserContextMock.mockRejectedValue(failure);

    const { Providers } = await import('./Providers');
    render(<Providers>child</Providers>);

    await waitFor(() => {
      expect(ensureCurrentUserContextMock).toHaveBeenCalledWith({});
    });
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith('[auth] Failed to ensure user context', failure);
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('skips eager context ensuring while MFA setup is still required', async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: 'user_1',
        email: 'person@example.com',
        name: 'Person',
        role: 'user',
      },
      isAuthenticated: true,
      isPending: false,
      isSiteAdmin: false,
      requiresMfaSetup: true,
      requiresMfaVerification: false,
    });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { Providers } = await import('./Providers');
    render(<Providers>child</Providers>);

    await waitFor(() => {
      expect(ensureCurrentUserContextMock).not.toHaveBeenCalled();
    });
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
