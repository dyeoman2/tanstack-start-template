import { api } from '@convex/_generated/api';
import { useAction, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  isInitialSubscriptionLoad: boolean;
  refresh: () => Promise<void>;
}

export function useAiUsageStatus(): UseAiUsageStatusReturn {
  // Use reactive query for usage data (updates automatically when aiMessageUsage table changes)
  const usageData = useQuery(api.ai.getCurrentUserUsage);

  // Use action for Autumn subscription status (less frequent, requires external API call)
  const getAiUsageStatusAction = useAction(api.ai.getAiUsageStatus);
  const [subscriptionData, setSubscriptionData] = useState<{
    status: 'unknown' | 'needs_upgrade' | 'subscribed' | 'not_configured';
    configured: boolean;
    lastCheckError: { message: string; code: string } | null;
    creditBalance: number | null;
    isUnlimited: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialSubscriptionLoad, setIsInitialSubscriptionLoad] = useState(true);

  // Fetch subscription status when usage data changes or on mount
  const refreshSubscription = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await getAiUsageStatusAction({});
      if (result.authenticated) {
        setSubscriptionData(result.subscription);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI usage status');
    } finally {
      setIsRefreshing(false);
      setIsInitialSubscriptionLoad(false);
    }
  }, [getAiUsageStatusAction]);

  // Fetch subscription status when usage data is available
  // This ensures we have subscription info, including when users have purchased credits
  // but still have free messages remaining (so we can show both)
  useEffect(() => {
    if (usageData) {
      // Always fetch subscription status when we have usage data
      // This ensures we detect purchased credits even when free tier hasn't been exhausted yet
      void refreshSubscription();
    }
  }, [usageData, refreshSubscription]);

  // Combine usage data (reactive) with subscription data (fetched)
  const status = useMemo<AiUsageStatusResult | null>(() => {
    if (usageData === undefined) {
      // Still loading
      return null;
    }

    if (usageData === null) {
      // Not authenticated
      return { authenticated: false };
    }

    // Authenticated - combine usage data with subscription data
    return {
      authenticated: true,
      usage: {
        messagesUsed: usageData.messagesUsed,
        pendingMessages: usageData.pendingMessages,
        freeMessagesRemaining: usageData.freeMessagesRemaining,
        freeLimit: usageData.freeLimit,
        lastReservedAt: usageData.lastReservedAt,
        lastCompletedAt: usageData.lastCompletedAt,
      },
      subscription: subscriptionData ?? {
        status: 'unknown',
        configured: false,
        lastCheckError: null,
        creditBalance: null,
        isUnlimited: false,
      },
    };
  }, [usageData, subscriptionData]);

  const refresh = useCallback(async () => {
    await refreshSubscription();
  }, [refreshSubscription]);

  return {
    status,
    error,
    isLoading: usageData === undefined,
    isRefreshing,
    isInitialSubscriptionLoad,
    refresh,
  };
}
