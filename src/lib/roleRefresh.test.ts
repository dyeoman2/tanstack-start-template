import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();

vi.mock('~/features/auth/auth-client', () => ({
  authClient: {
    getSession: getSessionMock,
  },
}));

describe('setupClaimRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T10:00:00.000Z'));
    getSessionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes stale claims immediately and again on focus', async () => {
    getSessionMock.mockResolvedValue({
      user: {
        lastRefreshedAt: Date.now() - 21 * 60_000,
      },
    });

    const { setupClaimRefresh } = await import('~/lib/roleRefresh');
    const cleanup = setupClaimRefresh();

    await vi.runAllTimersAsync();
    expect(getSessionMock).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();
    expect(getSessionMock).toHaveBeenCalledTimes(4);

    cleanup();
  });

  it('does not perform a second refresh when claims are still fresh', async () => {
    getSessionMock.mockResolvedValue({
      user: {
        lastRefreshedAt: Date.now() - 5 * 60_000,
      },
    });

    const { setupClaimRefresh } = await import('~/lib/roleRefresh');
    const cleanup = setupClaimRefresh();

    await vi.runAllTimersAsync();
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('swallows refresh failures and unregisters the focus listener on cleanup', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getSessionMock.mockRejectedValue(new Error('network'));

    const { setupClaimRefresh } = await import('~/lib/roleRefresh');
    const cleanup = setupClaimRefresh();

    await vi.runAllTimersAsync();
    expect(warnSpy).toHaveBeenCalled();

    cleanup();
    window.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();

    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });
});
