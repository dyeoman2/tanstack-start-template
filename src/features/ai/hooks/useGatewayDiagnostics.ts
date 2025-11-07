import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import type React from 'react';
import type { AIResult } from '~/features/ai/types';

interface UseGatewayDiagnosticsProps {
  onRefreshUsage: () => Promise<void>;
  setResults: React.Dispatch<React.SetStateAction<Record<string, AIResult>>>;
  setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function useGatewayDiagnostics({
  onRefreshUsage,
  setResults,
  setLoading,
}: UseGatewayDiagnosticsProps) {
  const testGatewayConnectivityAction = useAction(api.cloudflareAi.testGatewayConnectivity);

  const handleTest = async () => {
    const key = 'gateway-test';

    // Show result card immediately with loading state
    const initialResult: AIResult = {
      response: '',
    };
    setResults((prev) => ({ ...prev, [key]: initialResult }));
    setLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const result = await testGatewayConnectivityAction({});
      setResults((prev) => ({ ...prev, [key]: result }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [key]: { error: error instanceof Error ? error.message : 'Unknown error' },
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
      await onRefreshUsage();
    }
  };

  return {
    handleTest,
  };
}
