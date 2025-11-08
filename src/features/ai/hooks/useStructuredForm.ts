import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import type React from 'react';
import type { AIResult } from '~/features/ai/types';

interface UseStructuredFormProps {
  onRefreshUsage: () => Promise<void>;
  envVarsMissing: boolean;
  generationBlocked: boolean;
  addUsageDepletedResult: () => void;
  setResults: React.Dispatch<React.SetStateAction<Record<string, AIResult>>>;
  setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function useStructuredForm({
  onRefreshUsage,
  envVarsMissing,
  generationBlocked,
  addUsageDepletedResult,
  setResults,
  setLoading,
}: UseStructuredFormProps) {
  const streamStructuredResponseAction = useAction(api.cloudflareAi.streamStructuredResponse);

  const createRequestId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const handleSubmit = async (data: {
    topic: string;
    style: 'formal' | 'casual' | 'technical';
  }) => {
    if (envVarsMissing) {
      setResults((prev) => ({
        ...prev,
        [`error-${Date.now()}`]: {
          error: 'Cloudflare AI is not configured. Please set up your environment variables first.',
        },
      }));
      return;
    }

    if (generationBlocked) {
      addUsageDepletedResult();
      return;
    }

    const requestId = createRequestId();

    try {
      await streamStructuredResponseAction({
        topic: data.topic,
        style: data.style,
        requestId,
      });
    } catch (error) {
      const errorKey = `structured-error-${Date.now()}`;
      setResults((prev) => ({
        ...prev,
        [errorKey]: { error: error instanceof Error ? error.message : 'Unknown error' },
      }));
      setLoading((prev) => ({ ...prev, [errorKey]: false }));
    } finally {
      await onRefreshUsage();
    }
  };

  return {
    handleSubmit,
  };
}
