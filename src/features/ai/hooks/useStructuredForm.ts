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

  const handleSubmit = async (data: { topic: string; style: 'formal' | 'casual' | 'technical' }) => {
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

    const key = `structured-${Date.now()}`;

    // Show result card immediately with loading state
    const initialResult: AIResult = {
      response: '',
      provider: 'cloudflare-workers-ai-structured',
      model: 'llama', // Default model for structured responses
    };
    setResults((prev) => ({ ...prev, [key]: initialResult }));
    setLoading((prev) => ({ ...prev, [key]: true }));

    try {
      // Use streaming for structured output
      let accumulatedText = '';
      let metadata: { provider?: string; model?: string } | null = null;

      // Convex returns an array of chunks instead of an async generator
      const chunks = await streamStructuredResponseAction({
        topic: data.topic,
        style: data.style,
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
          // Update the result in real-time showing the raw text
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
          const result: AIResult = {
            response: chunk.rawText || accumulatedText,
            usage: chunk.usage,
            finishReason: chunk.finishReason,
            provider: metadata?.provider || 'cloudflare-workers-ai-structured',
            model: metadata?.model || '@cf/meta/llama-3.1-8b-instruct',
            structuredData: chunk.structuredData
              ? (chunk.structuredData as {
                  title: string;
                  summary: string;
                  keyPoints: string[];
                  category: string;
                  difficulty: string;
                })
              : undefined,
            parseError: chunk.parseError || undefined,
          };
          // Update final result and mark loading as complete
          setResults((prev) => ({ ...prev, [key]: result }));
          setLoading((prev) => ({ ...prev, [key]: false }));
        }
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

