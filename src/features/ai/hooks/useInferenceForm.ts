import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import type React from 'react';
import type { AIResult, InferenceMethod } from '~/features/ai/types';

interface UseInferenceFormProps {
  onRefreshUsage: () => Promise<void>;
  envVarsMissing: boolean;
  generationBlocked: boolean;
  addUsageDepletedResult: () => void;
  setResults: React.Dispatch<React.SetStateAction<Record<string, AIResult>>>;
  setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function useInferenceForm({
  onRefreshUsage,
  envVarsMissing,
  generationBlocked,
  addUsageDepletedResult,
  setResults,
  setLoading,
}: UseInferenceFormProps) {
  const streamWithWorkersAIAction = useAction(api.cloudflareAi.streamWithWorkersAI);
  const streamWithGatewayAction = useAction(api.cloudflareAi.streamWithGateway);
  const compareInferenceMethodsAction = useAction(api.cloudflareAi.compareInferenceMethods);

  const createRequestId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const handleSubmit = async (data: {
    prompt: string;
    model: 'llama' | 'falcon';
    method: InferenceMethod;
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

    if (data.method === 'direct' || data.method === 'gateway') {
      const requestId = createRequestId();
      const streamAction =
        data.method === 'direct' ? streamWithWorkersAIAction : streamWithGatewayAction;
      try {
        await streamAction({
          prompt: data.prompt,
          model: data.model,
          requestId,
        });
      } catch (error) {
        setResults((prev) => ({
          ...prev,
          [`error-${Date.now()}`]: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        }));
      } finally {
        await onRefreshUsage();
      }
      return;
    }

    const key = `${data.method}-${Date.now()}`;

    setResults((prev) => ({
      ...prev,
      [key]: {
        response: '',
        provider: 'cloudflare-gateway',
        model: data.model,
      },
    }));
    setLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const comparisonResult = await compareInferenceMethodsAction({
        prompt: data.prompt,
        model: data.model,
      });
      const directResponse =
        'response' in comparisonResult.direct
          ? comparisonResult.direct.response
          : comparisonResult.direct.error;
      const directUsage =
        'usage' in comparisonResult.direct ? comparisonResult.direct.usage : undefined;
      const gatewayResponse =
        'response' in comparisonResult.gateway
          ? comparisonResult.gateway.response
          : comparisonResult.gateway.error;
      const gatewayUsage =
        'usage' in comparisonResult.gateway ? comparisonResult.gateway.usage : undefined;

      const result = {
        response: `Direct: ${directResponse}\n\nGateway: ${gatewayResponse}`,
        usage: {
          direct: directUsage,
          gateway: gatewayUsage,
        },
        provider: 'cloudflare-gateway', // Use gateway icon for comparison
        model: data.model,
      };

      setResults((prev) => ({ ...prev, [key]: result }));
      setLoading((prev) => ({ ...prev, [key]: false }));
    } catch (error) {
      setResults((prev) => ({
        ...prev,
        [key]: { error: error instanceof Error ? error.message : 'Unknown error' },
      }));
      setLoading((prev) => ({ ...prev, [key]: false }));
    } finally {
      await onRefreshUsage();
    }
  };

  return {
    handleSubmit,
  };
}
