import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSessionMock = vi.fn();
const useAuthStateMock = vi.fn();
const useConvexAuthMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock('~/features/auth/auth-client', () => ({
  useSession: useSessionMock,
}));

vi.mock('./useAuthState', () => ({
  useAuthState: useAuthStateMock,
}));

vi.mock('convex/react', () => ({
  useConvexAuth: useConvexAuthMock,
  useQuery: useQueryMock,
}));

describe('useAuth', () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    useAuthStateMock.mockReset();
    useConvexAuthMock.mockReset();
    useQueryMock.mockReset();
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it('reports impersonation metadata from the Better Auth session', async () => {
    useAuthStateMock.mockReturnValue({
      isAuthenticated: true,
      isPending: false,
      error: null,
      userId: 'admin-1',
    });
    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'person@example.com',
          name: 'Person Example',
        },
        session: {
          impersonatedBy: 'admin-1',
        },
      },
      isPending: false,
      error: null,
    });
    useQueryMock.mockReturnValue({
      role: 'user',
      isSiteAdmin: false,
      phoneNumber: null,
      currentOrganization: null,
    });

    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    expect(result.current.isImpersonating).toBe(true);
    expect(result.current.impersonatedByUserId).toBe('admin-1');
    expect(result.current.hasSession).toBe(true);
    expect(result.current.user?.email).toBe('person@example.com');
    expect(result.current.isSiteAdmin).toBe(false);
  });

  it('derives site admin from the normalized role', async () => {
    useAuthStateMock.mockReturnValue({
      isAuthenticated: true,
      isPending: false,
      error: null,
      userId: 'admin-1',
    });
    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          name: 'Admin Example',
        },
        session: {},
      },
      isPending: false,
      error: null,
    });
    useQueryMock.mockReturnValue({
      role: 'admin',
      isSiteAdmin: false,
      phoneNumber: null,
      currentOrganization: null,
    });

    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    expect(result.current.user?.role).toBe('admin');
    expect(result.current.isSiteAdmin).toBe(true);
  });

  it('exposes Better Auth session presence even before Convex auth is ready', async () => {
    useAuthStateMock.mockReturnValue({
      isAuthenticated: true,
      isPending: false,
      error: null,
      userId: 'user-1',
    });
    useSessionMock.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
          email: 'person@example.com',
          name: 'Person Example',
        },
        session: {},
      },
      isPending: false,
      error: null,
    });
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    useQueryMock.mockReturnValue('skip');

    const { useAuth } = await import('./useAuth');
    const { result } = renderHook(() => useAuth());

    expect(result.current.hasSession).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isPending).toBe(false);
  });
});
