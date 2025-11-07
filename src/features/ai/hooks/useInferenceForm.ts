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

  const handleSubmit = async (data: {
    prompt: string;
    model: 'llama' | 'falcon';
    method: InferenceMethod;
  }) => {
    if (envVarsMissing) {
      setResults((prev) => ({
        ...prev,
        [`error-${Date.now()}`]: {
          error:
            'Cloudflare AI is not configured. Please set up your environment variables first.',
        },
      }));
      return;
    }

    if (generationBlocked) {
      addUsageDepletedResult();
      return;
    }

    const key = `${data.method}-${Date.now()}`;

    // Show result card immediately with loading state
    const initialResult: AIResult = {
      response: '',
      provider:
        data.method === 'gateway'
          ? 'cloudflare-gateway'
          : data.method === 'structured'
            ? 'cloudflare-workers-ai-structured'
            : 'cloudflare-workers-ai',
      model: data.model,
    };
    setResults((prev) => ({ ...prev, [key]: initialResult }));
    setLoading((prev) => ({ ...prev, [key]: true }));

    try {
      switch (data.method) {
        case 'direct':
        case 'gateway': {
          // Use streaming for direct and gateway methods
          const streamAction =
            data.method === 'direct' ? streamWithWorkersAIAction : streamWithGatewayAction;
          let accumulatedText = '';
          let metadata: { provider?: string; model?: string } | null = null;

          // Convex returns an array of chunks instead of an async generator
          const chunks = await streamAction({
            prompt: data.prompt,
            model: data.model,
          });

          // Process chunks sequentially to simulate streaming
          for (const chunk of chunks) {
            if (chunk.type === 'metadata') {
              metadata = chunk;
              // Update with metadata
              setResults((prev) => ({
                ...prev,
                [key]: {
                  ...prev[key],
                  provider: chunk.provider,
                  model: chunk.model,
                },
              }));
            } else if (chunk.type === 'text') {
              accumulatedText += chunk.content;
              // Update the result in real-time
              setResults((prev) => ({
                ...prev,
                [key]: {
                  ...prev[key],
                  response: accumulatedText,
                  provider: metadata?.provider || prev[key]?.provider,
                  model: metadata?.model || prev[key]?.model,
                },
              }));
            } else if (chunk.type === 'complete') {
              // Final update with complete data
              const result = {
                response: accumulatedText,
                usage: chunk.usage,
                finishReason: chunk.finishReason,
                provider:
                  metadata?.provider ||
                  (data.method === 'gateway' ? 'cloudflare-gateway' : 'cloudflare-workers-ai'),
                model: metadata?.model || data.model,
              };
              // Update final result and mark loading as complete
              setResults((prev) => ({ ...prev, [key]: result }));
              setLoading((prev) => ({ ...prev, [key]: false }));
            }
          }
          break;
        }
        case 'comparison': {
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
          break;
        }
        default:
          throw new Error('Invalid method');
      }
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

