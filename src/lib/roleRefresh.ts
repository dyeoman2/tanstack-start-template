import { authClient } from '~/features/auth/auth-client';

/**
 * Claim refresh helper - refreshes Better Auth claims when the window regains focus
 * so role changes on the server propagate quickly without forcing a full reload.
 *
 * @param maxAgeMs - Maximum age of claims before refresh (default: 20 minutes)
 */
export function setupClaimRefresh(maxAgeMs = 20 * 60_000) {
  if (typeof window === 'undefined') return () => {};

  const maybeRefresh = async () => {
    if (!authClient.getSession) return;
    try {
      const snapshot = await authClient.getSession();
      // Type assertion to access the user property safely
      const user = (snapshot as { user?: { lastRefreshedAt?: number } })?.user;
      const lastRefreshedAt = user?.lastRefreshedAt ?? 0;
      if (Date.now() - lastRefreshedAt > maxAgeMs) {
        await authClient.getSession();
      }
    } catch (error) {
      console.warn('[claim-refresh] Failed to refresh claims', error);
    }
  };

  window.addEventListener('focus', maybeRefresh);
  setTimeout(() => {
    void maybeRefresh();
  }, 0);

  return () => window.removeEventListener('focus', maybeRefresh);
}
