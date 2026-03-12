import { api } from '@convex/_generated/api';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAction, useMutation } from 'convex/react';
import { Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useAutumnBilling } from '~/components/AutumnProvider';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Button } from '~/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { useToast } from '~/components/ui/toast';
import { AIResultsDisplay } from '~/features/ai/components/AIResultsDisplay';
import { AutumnSetupCard } from '~/features/ai/components/AutumnSetupCard';
import { CloudflareSetupCard } from '~/features/ai/components/CloudflareSetupCard';
import { FirecrawlForm } from '~/features/ai/components/FirecrawlForm';
import { FirecrawlSetupCard } from '~/features/ai/components/FirecrawlSetupCard';
import { GatewayDiagnostics } from '~/features/ai/components/GatewayDiagnostics';
import { InferenceForm } from '~/features/ai/components/InferenceForm';
import { StructuredForm } from '~/features/ai/components/StructuredForm';
import { useAiResponseStream } from '~/features/ai/hooks/useAiResponseStream';
import { useAiUsageStatus } from '~/features/ai/hooks/useAiUsageStatus';
import { useFirecrawlForm } from '~/features/ai/hooks/useFirecrawlForm';
import { useGatewayDiagnostics } from '~/features/ai/hooks/useGatewayDiagnostics';
import { useInferenceForm } from '~/features/ai/hooks/useInferenceForm';
import { useStructuredForm } from '~/features/ai/hooks/useStructuredForm';
import type { AIResult } from '~/features/ai/types';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

const paymentStatusSchema = z.object({
  payment: z.enum(['success', 'cancelled', 'failed']).optional(),
});

export const Route = createFileRoute('/app/ai-playground')({
  component: CloudflareAIDemo,
  errorComponent: DashboardErrorBoundary,
  validateSearch: paymentStatusSchema,
});

function CloudflareAIDemo() {
  usePerformanceMonitoring('Cloudflare AI Demo');

  const navigate = useNavigate();
  const toast = useToast();
  const { payment } = Route.useSearch();
  const [activeTab, setActiveTab] = useState('inference');
  const [resultTabs, setResultTabs] = useState<Record<string, string>>({});
  const {
    status: usageStatus,
    refresh: refreshUsage,
    isInitialSubscriptionLoad,
  } = useAiUsageStatus();
  const { ready: autumnReady } = useAutumnBilling();
  const checkFirecrawlConfigured = useAction(api.firecrawl.isFirecrawlConfigured);
  const checkCloudflareConfigured = useAction(api.cloudflareAi.isCloudflareConfigured);
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<boolean | null>(null);
  const [cloudflareConfigured, setCloudflareConfigured] = useState<boolean | null>(null);
  const usageDetails = usageStatus?.authenticated ? usageStatus.usage : null;
  const subscriptionDetails = usageStatus?.authenticated ? usageStatus.subscription : null;
  const paymentHandledRef = useRef<string | undefined>(undefined);
  const streamingEntries = useAiResponseStream();
  const deleteAllResponses = useMutation(api.aiResponses.deleteAllUserResponses);

  // Check Firecrawl configuration using Convex action
  useEffect(() => {
    void (async () => {
      try {
        const result = await checkFirecrawlConfigured({});
        setFirecrawlConfigured(result.configured);
      } catch {
        setFirecrawlConfigured(false);
      }
    })();
  }, [checkFirecrawlConfigured]);

  // Check Cloudflare configuration using Convex action
  useEffect(() => {
    void (async () => {
      try {
        const result = await checkCloudflareConfigured({});
        setCloudflareConfigured(result.configured);
      } catch {
        setCloudflareConfigured(false);
      }
    })();
  }, [checkCloudflareConfigured]);

  const firecrawlApiKeyMissing = firecrawlConfigured === false;
  const envVarsMissing = cloudflareConfigured === false;

  // Handle payment status query parameter - only once per payment status
  useEffect(() => {
    // Skip if no payment status or if we've already handled this status
    if (!payment || paymentHandledRef.current === payment) {
      return;
    }

    // Mark this payment status as handled
    paymentHandledRef.current = payment;

    // Clean up URL immediately to prevent re-triggering
    navigate({
      to: '/app/ai-playground',
      replace: true,
    });

    // Show toast and refresh usage
    if (payment === 'success') {
      toast.showToast(
        'Payment completed successfully! Credits have been added to your account.',
        'success',
      );
      void refreshUsage();
    } else if (payment === 'cancelled' || payment === 'failed') {
      toast.showToast('Payment was cancelled or failed. Please try again.', 'error');
    }
  }, [payment, navigate, toast, refreshUsage]);

  const freeLimit = usageDetails?.freeLimit ?? 10;
  const freeRemaining = usageDetails?.freeMessagesRemaining ?? freeLimit;
  const isSubscribed = subscriptionDetails?.status === 'subscribed';
  const autumnNotConfigured = subscriptionDetails?.status === 'not_configured';
  const showAutumnSetupCard = !autumnReady || autumnNotConfigured;
  // Generation is blocked if: not subscribed AND free tier exhausted (including pending)
  const generationBlocked = !isSubscribed && freeRemaining <= 0;

  const addUsageDepletedResult = () => {
    // This will be handled by the form hooks
  };

  // Shared state for all results
  const [allResults, setAllResults] = useState<Record<string, AIResult>>({});
  const [allLoading, setAllLoading] = useState<Record<string, boolean>>({});
  const [resultTimestamps, setResultTimestamps] = useState<Record<string, number>>({});

  const setResultsWithMeta = useCallback<Dispatch<SetStateAction<Record<string, AIResult>>>>(
    (updater) => {
      setAllResults((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        setResultTimestamps((prevTs) => {
          const nextTs = { ...prevTs };
          for (const key of Object.keys(next)) {
            if (!(key in prev) && !(key in nextTs)) {
              nextTs[key] = Date.now();
            }
          }
          return nextTs;
        });
        return next;
      });
    },
    [],
  );

  const localEntries = useMemo(
    () =>
      Object.entries(allResults).map(([key, result]) => ({
        key,
        result,
        isLoading: allLoading[key] ?? false,
        createdAt: resultTimestamps[key] ?? 0,
      })),
    [allResults, allLoading, resultTimestamps],
  );

  const combinedEntries = useMemo(() => {
    const merged = [...streamingEntries, ...localEntries];
    return merged.sort((a, b) => b.createdAt - a.createdAt);
  }, [streamingEntries, localEntries]);

  const streamingSubmitting = streamingEntries.some((entry) => entry.isLoading);
  const anyLocalLoading = Object.values(allLoading).some((v) => v);
  const isSubmitting = streamingSubmitting || anyLocalLoading;

  const inferenceForm = useInferenceForm({
    onRefreshUsage: refreshUsage,
    envVarsMissing,
    generationBlocked,
    addUsageDepletedResult,
    setResults: setResultsWithMeta,
    setLoading: setAllLoading,
  });

  const structuredForm = useStructuredForm({
    onRefreshUsage: refreshUsage,
    envVarsMissing,
    generationBlocked,
    addUsageDepletedResult,
    setResults: setResultsWithMeta,
    setLoading: setAllLoading,
  });

  const firecrawlForm = useFirecrawlForm({
    checkFirecrawlConfigured: () => checkFirecrawlConfigured({}),
    setFirecrawlConfigured,
    setResults: setResultsWithMeta,
    setLoading: setAllLoading,
  });

  const gatewayDiagnostics = useGatewayDiagnostics({
    onRefreshUsage: refreshUsage,
    setResults: setResultsWithMeta,
    setLoading: setAllLoading,
  });

  const handleDeleteAllResults = useCallback(async () => {
    try {
      // Clear local state
      setAllResults({});
      setAllLoading({});
      setResultTimestamps({});
      setResultTabs({});

      // Delete streaming entries from Convex
      await deleteAllResponses({});

      toast.showToast('All results deleted successfully.', 'success');
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete results.',
        'error',
      );
    }
  }, [deleteAllResponses, toast]);

  const hasResults = combinedEntries.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Playground"
        description="Interactive demo for streaming AI text generation and structured output. Built with the Cloudflare Workers AI for inference, Cloudflare AI Gateway for request monitoring and analytics, Autumn for usage-based billing and credit management, and AI SDK for unified AI interfaces."
      />

      {/* Setup Instructions */}
      {envVarsMissing && activeTab !== 'firecrawl' && <CloudflareSetupCard />}
      {activeTab === 'firecrawl' && firecrawlApiKeyMissing && <FirecrawlSetupCard />}
      {showAutumnSetupCard && <AutumnSetupCard />}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 h-auto p-1">
          <TabsTrigger
            value="inference"
            className="text-xs sm:text-sm whitespace-normal h-auto py-2"
          >
            Text Generation
          </TabsTrigger>
          <TabsTrigger
            value="structured"
            className="text-xs sm:text-sm whitespace-normal h-auto py-2"
          >
            Structured Output
          </TabsTrigger>
          <TabsTrigger
            value="firecrawl"
            className="text-xs sm:text-sm whitespace-normal h-auto py-2"
          >
            Firecrawl
          </TabsTrigger>
          <TabsTrigger
            value="diagnostics"
            className="text-xs sm:text-sm whitespace-normal h-auto py-2"
          >
            Gateway Diagnostics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inference" className="space-y-6">
          <InferenceForm
            onSubmit={inferenceForm.handleSubmit}
            envVarsMissing={envVarsMissing}
            generationBlocked={generationBlocked}
            isSubmitting={isSubmitting}
            usageDetails={usageDetails}
            subscriptionDetails={subscriptionDetails}
            isInitialSubscriptionLoad={isInitialSubscriptionLoad}
            onRefreshUsage={refreshUsage}
          />
        </TabsContent>

        <TabsContent value="structured" className="space-y-6">
          <StructuredForm
            onSubmit={structuredForm.handleSubmit}
            envVarsMissing={envVarsMissing}
            generationBlocked={generationBlocked}
            isSubmitting={isSubmitting}
            usageDetails={usageDetails}
            subscriptionDetails={subscriptionDetails}
            isInitialSubscriptionLoad={isInitialSubscriptionLoad}
            onRefreshUsage={refreshUsage}
          />
        </TabsContent>

        <TabsContent value="firecrawl" className="space-y-6">
          <FirecrawlForm
            onSubmit={firecrawlForm.handleSubmit}
            apiKeyMissing={firecrawlApiKeyMissing}
            isSubmitting={isSubmitting}
            usageDetails={usageDetails}
            subscriptionDetails={subscriptionDetails}
            isInitialSubscriptionLoad={isInitialSubscriptionLoad}
            onRefreshUsage={refreshUsage}
          />
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-6">
          <GatewayDiagnostics
            onTest={gatewayDiagnostics.handleTest}
            disabled={envVarsMissing}
            isLoading={allLoading['gateway-test'] ?? false}
            usageDetails={usageDetails}
            subscriptionDetails={subscriptionDetails}
            isInitialSubscriptionLoad={isInitialSubscriptionLoad}
            onRefreshUsage={refreshUsage}
          />
        </TabsContent>
      </Tabs>

      {/* Results Display */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Results</h2>
          {hasResults && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteAllResults}
              disabled={isSubmitting}
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </Button>
          )}
        </div>
        <AIResultsDisplay
          entries={combinedEntries}
          resultTabs={resultTabs}
          onTabChange={(key, value) => setResultTabs((prev) => ({ ...prev, [key]: value }))}
        />
      </div>
    </div>
  );
}
