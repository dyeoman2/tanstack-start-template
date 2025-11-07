import { api } from '@convex/_generated/api';
import { useAction } from 'convex/react';
import type React from 'react';
import type { AIResult } from '~/features/ai/types';

interface UseFirecrawlFormProps {
  checkFirecrawlConfigured: () => Promise<{ configured: boolean }>;
  setFirecrawlConfigured: (configured: boolean) => void;
  setResults: React.Dispatch<React.SetStateAction<Record<string, AIResult>>>;
  setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function useFirecrawlForm({
  checkFirecrawlConfigured,
  setFirecrawlConfigured,
  setResults,
  setLoading,
}: UseFirecrawlFormProps) {
  const extractWithFirecrawlAction = useAction(api.firecrawl.extractWithFirecrawl);

  const handleSubmit = async (data: { url: string }) => {
    const key = `firecrawl-${Date.now()}`;

    // Show result card immediately with loading state
    const initialResult: AIResult = {
      provider: 'firecrawl',
      firecrawlUrl: data.url,
    };
    setResults((prev) => ({ ...prev, [key]: initialResult }));
    setLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const result = await extractWithFirecrawlAction({ url: data.url });

      // Check if API key is missing (returned as success: false with error message)
      if (!result.success && result.error) {
        const isApiKeyMissing =
          result.error.includes('FIRECRAWL_API_KEY') ||
          result.error.includes('Firecrawl API key is not configured') ||
          result.error.includes('Missing required Firecrawl') ||
          result.error.includes('Missing required Firecrawl environment variable') ||
          (result.error.toLowerCase().includes('firecrawl') &&
            result.error.toLowerCase().includes('not configured'));

        if (isApiKeyMissing) {
          // Refresh Firecrawl configuration status
          void checkFirecrawlConfigured().then((result) =>
            setFirecrawlConfigured(result.configured),
          );
        }

        setResults((prev) => ({
          ...prev,
          [key]: {
            provider: 'firecrawl',
            firecrawlUrl: result.url,
            error: result.error,
          },
        }));
        setLoading((prev) => ({ ...prev, [key]: false }));
        return;
      }

      // Success case
      const finalResult: AIResult = {
        provider: 'firecrawl',
        firecrawlUrl: result.url,
        firecrawlMarkdown: result.markdown || undefined,
        firecrawlJson: result.json || undefined,
        success: result.success,
      };

      setResults((prev) => ({ ...prev, [key]: finalResult }));
      setLoading((prev) => ({ ...prev, [key]: false }));
      // Refresh Firecrawl configuration status
      void checkFirecrawlConfigured().then((result) => setFirecrawlConfigured(result.configured));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Check for various forms of the missing API key error (fallback for unexpected errors)
      const isApiKeyMissing =
        errorMessage.includes('FIRECRAWL_API_KEY') ||
        errorMessage.includes('Firecrawl API key is not configured') ||
        errorMessage.includes('Missing required Firecrawl') ||
        errorMessage.includes('Missing required Firecrawl environment variable') ||
        (errorMessage.toLowerCase().includes('firecrawl') &&
          errorMessage.toLowerCase().includes('not configured'));

      if (isApiKeyMissing) {
        // Refresh Firecrawl configuration status
        void checkFirecrawlConfigured().then((result) => setFirecrawlConfigured(result.configured));
      }

      setResults((prev) => ({
        ...prev,
        [key]: {
          provider: 'firecrawl',
          firecrawlUrl: data.url,
          error: errorMessage,
        },
      }));
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  return {
    handleSubmit,
  };
}
