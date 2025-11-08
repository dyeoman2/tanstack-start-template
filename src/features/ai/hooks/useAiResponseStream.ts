import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import type { AIResult } from '~/features/ai/types';

export interface AiResultEntry {
  key: string;
  result: AIResult;
  isLoading: boolean;
  createdAt: number;
}

export function useAiResponseStream(): AiResultEntry[] {
  const responses = useQuery(api.aiResponses.listUserResponses, {}) as
    | Doc<'aiResponses'>[]
    | undefined;

  return useMemo(() => {
    if (!responses) {
      return [];
    }

    return responses.map((response) => {
      const key = `streaming:${response._id}`;
      const baseResult: AIResult = {
        response: response.response,
        provider: response.provider ?? undefined,
        model: response.model ?? undefined,
        usage: response.usage ?? undefined,
        finishReason: response.finishReason ?? undefined,
        structuredData: response.structuredData ?? undefined,
        rawText: response.rawText ?? undefined,
        parseError: response.parseError ?? undefined,
      };
      if (response.status === 'error' && response.errorMessage) {
        baseResult.error = response.errorMessage;
      }

      return {
        key,
        result: baseResult,
        isLoading: response.status === 'pending',
        createdAt: response.createdAt,
      };
    });
  }, [responses]);
}
