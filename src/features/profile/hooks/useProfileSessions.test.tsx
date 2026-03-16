import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileSessions } from './useProfileSessions';

const listSessionsMock = vi.fn();
const revokeSessionMock = vi.fn();
const revokeOtherSessionsMock = vi.fn();
const showToastMock = vi.fn();

vi.mock('@convex/_generated/api', () => ({
  api: {
    auth: {
      listCurrentSessions: 'auth.listCurrentSessions',
      revokeCurrentSessionById: 'auth.revokeCurrentSessionById',
      revokeCurrentOtherSessions: 'auth.revokeCurrentOtherSessions',
    },
  },
}));

vi.mock('convex/react', () => ({
  useAction: (ref: string) => {
    switch (ref) {
      case 'auth.listCurrentSessions':
        return listSessionsMock;
      case 'auth.revokeCurrentSessionById':
        return revokeSessionMock;
      case 'auth.revokeCurrentOtherSessions':
        return revokeOtherSessionsMock;
      default:
        throw new Error(`Unexpected action ref: ${ref}`);
    }
  },
}));

vi.mock('~/components/ui/toast', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

describe('useProfileSessions', () => {
  beforeEach(() => {
    listSessionsMock.mockReset();
    revokeSessionMock.mockReset();
    revokeOtherSessionsMock.mockReset();
    showToastMock.mockReset();
  });

  it('loads sessions on mount and exposes them', async () => {
    listSessionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'session-1',
          isCurrent: true,
          createdAt: 1,
          updatedAt: 2,
          expiresAt: 3,
          ipAddress: '127.0.0.1',
          userAgent: 'Chrome',
        },
      ],
    });

    const { result } = renderHook(() => useProfileSessions());

    expect(result.current.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    expect(result.current.sessions).toEqual([
      {
        id: 'session-1',
        isCurrent: true,
        createdAt: 1,
        updatedAt: 2,
        expiresAt: 3,
        ipAddress: '127.0.0.1',
        userAgent: 'Chrome',
      },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('refreshes after a successful revoke', async () => {
    listSessionsMock
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: 'session-1',
            isCurrent: false,
            createdAt: 1,
            updatedAt: 10,
            expiresAt: 100,
            ipAddress: null,
            userAgent: null,
          },
          {
            id: 'session-2',
            isCurrent: true,
            createdAt: 2,
            updatedAt: 20,
            expiresAt: 200,
            ipAddress: null,
            userAgent: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: 'session-2',
            isCurrent: true,
            createdAt: 2,
            updatedAt: 20,
            expiresAt: 200,
            ipAddress: null,
            userAgent: null,
          },
        ],
      });
    revokeSessionMock.mockResolvedValue({
      ok: true,
      data: { success: true },
    });

    const { result } = renderHook(() => useProfileSessions());

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    await act(async () => {
      await result.current.revokeSession('session-1');
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    expect(result.current.sessions[0]?.id).toBe('session-2');
    expect(showToastMock).toHaveBeenCalledWith('Session revoked', 'success');
    expect(listSessionsMock).toHaveBeenCalledTimes(2);
  });

  it('preserves existing rows and exposes an error on failed revoke', async () => {
    listSessionsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'session-1',
          isCurrent: false,
          createdAt: 1,
          updatedAt: 10,
          expiresAt: 100,
          ipAddress: null,
          userAgent: null,
        },
      ],
    });
    revokeSessionMock.mockResolvedValue({
      ok: false,
      error: { message: 'Request failed' },
    });

    const { result } = renderHook(() => useProfileSessions());

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });

    await act(async () => {
      await result.current.revokeSession('session-1');
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.error).toBe('Request failed');
    expect(showToastMock).toHaveBeenCalledWith('Request failed', 'error');
  });
});
