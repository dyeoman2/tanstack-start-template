import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';

type AiUsageStatusResult =
  | {
      authenticated: false;
    }
  | {
      authenticated: true;
      usage: {
        messagesUsed: number;
        pendingMessages: number;
        freeMessagesRemaining: number;
        freeLimit: number;
        lastReservedAt: number | null;
        lastCompletedAt: number | null;
      };
      subscription: {
        status: 'unknown' | 'needs_upgrade' | 'subscribed' | 'not_configured';
        configured: boolean;
        lastCheckError: { message: string; code: string } | null;
        creditBalance: number | null;
        isUnlimited: boolean;
      };
    };

interface UseAiUsageStatusReturn {
  status: AiUsageStatusResult | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

export function useAiUsageStatus(): UseAiUsageStatusReturn {
  const getAiUsageStatusAction = useAction(api.ai.getAiUsageStatus);
  const [status, setStatus] = useState<AiUsageStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await getAiUsageStatusAction({});
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI usage status');
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [getAiUsageStatusAction]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    error,
    isLoading,
    isRefreshing,
    refresh,
  };
}
