import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import { useEffect, useState } from 'react';
import { useToast } from '~/components/ui/toast';

export type ProfileSession = {
  id: string;
  isCurrent: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  ipAddress: string | null;
  userAgent: string | null;
};

export function useProfileSessions() {
  const { showToast } = useToast();
  const listSessions = useAction(api.auth.listCurrentSessions);
  const revokeSession = useAction(api.auth.revokeCurrentSessionById);
  const revokeOtherSessions = useAction(api.auth.revokeCurrentOtherSessions);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const requestKey = refreshKey;

    const loadSessions = async () => {
      setIsPending(true);
      setError(null);

      try {
        const result = await listSessions({});
        if (cancelled) {
          return;
        }

        void requestKey;

        if (!result.ok) {
          throw new Error(result.error.message);
        }

        setSessions(result.data);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSessions([]);
        setError(error instanceof Error ? error.message : 'Failed to load sessions');
      } finally {
        if (!cancelled) {
          setIsPending(false);
        }
      }
    };

    void loadSessions();

    return () => {
      cancelled = true;
    };
  }, [listSessions, refreshKey]);

  const refresh = () => {
    setRefreshKey((value) => value + 1);
  };

  const revokeSessionById = async (sessionId: string) => {
    setError(null);

    try {
      const result = await revokeSession({ sessionId });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      if (!result.data.success) {
        throw new Error('Failed to revoke session');
      }

      refresh();
      showToast('Session revoked', 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke session';
      setError(message);
      showToast(message, 'error');
      return false;
    }
  };

  const revokeOtherSessionsById = async () => {
    setError(null);

    try {
      const result = await revokeOtherSessions({});
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      if (!result.data.success) {
        throw new Error('Failed to revoke other sessions');
      }

      refresh();
      showToast('Revoked other sessions', 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke other sessions';
      setError(message);
      showToast(message, 'error');
      return false;
    }
  };

  return {
    sessions,
    isPending,
    error,
    revokeSession: revokeSessionById,
    revokeOtherSessions: revokeOtherSessionsById,
    refresh,
  };
}
