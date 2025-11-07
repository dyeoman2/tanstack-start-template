import { useForm } from '@tanstack/react-form';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BarChart3, Cloud, Cpu, Loader2, Network, Shield } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useAutumnBilling } from '~/components/AutumnProvider';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Field, FieldLabel } from '~/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';
import { CreditPurchase } from '~/features/ai/components/CreditPurchase';
import { CREDIT_PACKAGES } from '~/features/ai/constants';
import { useAiUsageStatus } from '~/features/ai/hooks/useAiUsageStatus';
import {
  compareInferenceMethods,
  streamStructuredResponse,
  streamWithGateway,
  streamWithWorkersAI,
  testGatewayConnectivity,
} from '~/features/ai/server/cloudflare-ai.server';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

const paymentStatusSchema = z.object({
  payment: z.enum(['success', 'cancelled', 'failed']).optional(),
});

export const Route = createFileRoute('/app/ai-demo')({
  component: CloudflareAIDemo,
  errorComponent: DashboardErrorBoundary,
  validateSearch: paymentStatusSchema,
});

type InferenceMethod = 'direct' | 'gateway' | 'structured' | 'comparison';

interface AIResult {
  response?: string;
  structuredData?: {
    title: string;
    summary: string;
    keyPoints: string[];
    category: string;
    difficulty: string;
  };
  usage?: Record<string, unknown>;
  error?: string;
  model?: string;
  provider?: string;
  finishReason?: string;
  // Gateway test results
  success?: boolean;
  status?: number;
  statusText?: string;
  gatewayUrl?: string | null;
  headers?: Record<string, string>;
  // Structured output parsing
  parseError?: string;
  rawText?: string;
}

function CloudflareAIDemo() {
  usePerformanceMonitoring('Cloudflare AI Demo');

  const navigate = useNavigate();
  const toast = useToast();
  const { payment } = Route.useSearch();
  const [activeTab, setActiveTab] = useState('inference');
  const [results, setResults] = useState<Record<string, AIResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [envVarsMissing] = useState(false);
  const [resultTabs, setResultTabs] = useState<Record<string, string>>({});
  const {
    status: usageStatus,
    refresh: refreshUsage,
    isInitialSubscriptionLoad,
  } = useAiUsageStatus();
  const { ready: autumnReady } = useAutumnBilling();
  const usageDetails = usageStatus?.authenticated ? usageStatus.usage : null;
  const subscriptionDetails = usageStatus?.authenticated ? usageStatus.subscription : null;
  const paymentHandledRef = useRef<string | undefined>(undefined);

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
      to: '/app/ai-demo',
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
  const isUnlimited = subscriptionDetails?.isUnlimited ?? false;
  const creditBalance = subscriptionDetails?.creditBalance ?? null;
  const autumnNotConfigured = subscriptionDetails?.status === 'not_configured';
  const showAutumnSetupCard = !autumnReady || autumnNotConfigured;
  // Generation is blocked if: not subscribed AND free tier exhausted (including pending)
  const generationBlocked = !isSubscribed && freeRemaining <= 0;
  // User has purchased credits but still has free messages remaining
  const hasPaidCreditsWithFreeRemaining =
    isSubscribed && creditBalance !== null && freeRemaining > 0;

  const addUsageDepletedResult = () => {
    setResults((prev) => ({
      ...prev,
      [`autumn-usage-${Date.now()}`]: {
        error:
          'You have no free messages remaining. Configure Autumn billing to add credits and continue.',
      },
    }));
  };

  // Note: We don't auto-check env vars on page load to avoid consuming AI credits
  // Users will see error messages when they try to use AI features if not configured

  const inferenceForm = useForm({
    defaultValues: {
      prompt: 'Explain how neural networks work in simple terms.',
      model: 'llama' as 'llama' | 'falcon',
      method: 'direct' as InferenceMethod,
    },
    onSubmit: async ({ value }) => {
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

      const key = `${value.method}-${Date.now()}`;

      // Show result card immediately with loading state
      const initialResult: AIResult = {
        response: '',
        provider:
          value.method === 'gateway'
            ? 'cloudflare-gateway'
            : value.method === 'structured'
              ? 'cloudflare-workers-ai-structured'
              : 'cloudflare-workers-ai',
        model: value.model,
      };
      setResults((prev) => ({ ...prev, [key]: initialResult }));
      setLoading((prev) => ({ ...prev, [key]: true }));

      try {
        switch (value.method) {
          case 'direct':
          case 'gateway': {
            // Use streaming for direct and gateway methods
            const streamFn = value.method === 'direct' ? streamWithWorkersAI : streamWithGateway;
            let accumulatedText = '';
            let metadata: { provider?: string; model?: string } | null = null;

            for await (const chunk of await streamFn({
              data: { prompt: value.prompt, model: value.model },
            })) {
              if (chunk.type === 'metadata') {
                metadata = chunk;
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
                    (value.method === 'gateway' ? 'cloudflare-gateway' : 'cloudflare-workers-ai'),
                  model: metadata?.model || value.model,
                };
                // Update final result and mark loading as complete
                setResults((prev) => ({ ...prev, [key]: result }));
                setLoading((prev) => ({ ...prev, [key]: false }));
              }
            }
            break;
          }
          case 'comparison': {
            const comparisonResult = await compareInferenceMethods({
              data: { prompt: value.prompt, model: value.model },
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
              model: value.model,
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
        await refreshUsage();
      }
    },
  });

  const structuredForm = useForm({
    defaultValues: {
      topic: 'machine learning',
      style: 'formal' as 'formal' | 'casual' | 'technical',
    },
    onSubmit: async ({ value }) => {
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

        for await (const chunk of await streamStructuredResponse({
          data: { topic: value.topic, style: value.style },
        })) {
          if (chunk.type === 'metadata') {
            metadata = chunk;
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
              structuredData: chunk.structuredData,
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
        await refreshUsage();
      }
    },
  });

  const methods = [
    {
      id: 'direct' as const,
      name: 'Direct Workers AI',
      icon: Cpu,
      description: 'Direct inference via Cloudflare Workers AI',
      color: 'bg-blue-500',
    },
    {
      id: 'gateway' as const,
      name: 'AI Gateway',
      icon: Network,
      description: 'Inference via Cloudflare AI Gateway with monitoring',
      color: 'bg-green-500',
    },
    {
      id: 'comparison' as const,
      name: 'Compare Methods',
      icon: BarChart3,
      description: 'Run both methods in parallel for comparison',
      color: 'bg-purple-500',
    },
  ];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">AI Demo</h1>
        <p className="text-muted-foreground">
          Interactive demo for streaming AI text generation and structured output. Built with the
          Cloudflare Workers AI for inference, Cloudflare AI Gateway for request monitoring and
          analytics, Autumn for usage-based billing and credit management, and AI SDK for unified AI
          interfaces.
        </p>
      </div>

      {/* Setup Instructions */}
      {envVarsMissing && (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-amber-800">
              <Cloud className="w-5 h-5" />
              <span>Cloudflare AI Setup Required</span>
            </CardTitle>
            <CardDescription className="text-amber-700">
              Configure your environment variables to start using Cloudflare Workers AI
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-amber-800 space-y-3">
              <p>
                To use Cloudflare AI features, you need to set up the following environment
                variables:
              </p>
              <div className="bg-white p-3 rounded border font-mono text-xs">
                <div>CLOUDFLARE_API_TOKEN=your_api_token</div>
                <div>CLOUDFLARE_ACCOUNT_ID=your_account_id</div>
                <div>CLOUDFLARE_GATEWAY_ID=your_gateway_id</div>
              </div>
              <div className="space-y-2">
                <p className="font-semibold">Setup Steps:</p>
                <ol className="list-decimal list-inside space-y-1 ml-4">
                  <li>Create a Cloudflare account and enable Workers AI</li>
                  <li>Generate an API token with Workers AI permissions</li>
                  <li>Create an AI Gateway for monitoring (optional)</li>
                  <li>Add environment variables to your deployment platforms</li>
                </ol>
              </div>
            </div>
            <div className="flex space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('/docs/CLOUDFLARE_AI_SETUP.md', '_blank')}
                className="text-amber-700 border-amber-300 hover:bg-amber-100"
              >
                📖 Setup Guide
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://dash.cloudflare.com', '_blank')}
                className="text-amber-700 border-amber-300 hover:bg-amber-100"
              >
                🔗 Cloudflare Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Autumn Setup Instructions */}
      {showAutumnSetupCard && (
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-blue-800">
              <BarChart3 className="w-5 h-5" />
              <span>Autumn Setup Required</span>
            </CardTitle>
            <CardDescription className="text-blue-700">
              Autumn billing platform is not configured. Please follow the setup guide to enable
              usage-based billing and premium features.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-blue-800 space-y-3">
              <p>
                To enable Autumn billing for usage-based pricing and premium AI features, you need
                to set up the following environment variables:
              </p>
              <div className="bg-white p-3 rounded border font-mono text-xs">
                <div>AUTUMN_SECRET_KEY=am_sk_your_secret_key_here</div>
                <div>VITE_AUTUMN_50_CREDITS_ID=prod_50_credits</div>
              </div>
              <div className="space-y-2">
                <p className="font-semibold">Setup Steps:</p>
                <ol className="list-decimal list-inside space-y-1 ml-4">
                  <li>
                    Create an Autumn account at{' '}
                    <button
                      type="button"
                      onClick={() => window.open('https://useautumn.com', '_blank')}
                      className="text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                      useautumn.com
                    </button>
                  </li>
                  <li>Create a credit package: $5.00 (50 credits)</li>
                  <li>Get your secret key and product ID from the Autumn dashboard</li>
                  <li>Add environment variables to your deployment platforms</li>
                </ol>
              </div>
            </div>
            <div className="flex space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('/docs/AUTUMN_SETUP.md', '_blank')}
                className="text-blue-700 border-blue-300 hover:bg-blue-100"
              >
                📖 Setup Guide
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://useautumn.com', '_blank')}
                className="text-blue-700 border-blue-300 hover:bg-blue-100"
              >
                🔗 Autumn Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 h-auto p-1">
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
            value="diagnostics"
            className="text-xs sm:text-sm whitespace-normal h-auto py-2"
          >
            Gateway Diagnostics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inference" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Text Generation</CardTitle>
              <CardDescription>
                Generate text using Cloudflare Workers AI with or without gateway monitoring
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  inferenceForm.handleSubmit();
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <inferenceForm.Field name="model">
                    {(field) => (
                      <Field>
                        <FieldLabel>Model</FieldLabel>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value as 'llama' | 'falcon')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="llama">Llama 3.1 8B Instruct</SelectItem>
                            <SelectItem value="falcon">Falcon 7B Instruct</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  </inferenceForm.Field>

                  <inferenceForm.Field name="method">
                    {(field) => (
                      <Field>
                        <FieldLabel>Method</FieldLabel>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value as InferenceMethod)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {methods.map((method) => (
                              <SelectItem key={method.id} value={method.id}>
                                {method.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  </inferenceForm.Field>
                </div>

                <inferenceForm.Field
                  name="prompt"
                  validators={{
                    onChange: z.string().min(1, 'Prompt is required'),
                  }}
                >
                  {(field) => (
                    <Field>
                      <FieldLabel>Prompt</FieldLabel>
                      <Textarea
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            inferenceForm.handleSubmit();
                          }
                        }}
                        placeholder="Enter your prompt..."
                        rows={4}
                      />
                      {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                        <p className="text-sm text-red-500">{String(field.state.meta.errors[0])}</p>
                      )}
                    </Field>
                  )}
                </inferenceForm.Field>

                {usageDetails && !isInitialSubscriptionLoad ? (
                  <Alert
                    variant={
                      isSubscribed ? 'default' : generationBlocked ? 'destructive' : 'warning'
                    }
                  >
                    <AlertDescription>
                      <div className="space-y-3 w-full">
                        <div className="flex items-center justify-between gap-4">
                          <span>
                            {isSubscribed && isUnlimited
                              ? 'Your Autumn subscription provides unlimited messages.'
                              : hasPaidCreditsWithFreeRemaining
                                ? `You have ${freeRemaining} free message${freeRemaining === 1 ? '' : 's'} remaining. After that, you have ${creditBalance} paid credit${creditBalance === 1 ? '' : 's'} available.`
                                : isSubscribed && creditBalance !== null
                                  ? `You have ${creditBalance} message${creditBalance === 1 ? '' : 's'} remaining.`
                                  : generationBlocked
                                    ? 'You have no messages remaining. Purchase more credits to continue.'
                                    : `You have ${freeRemaining} free message${freeRemaining === 1 ? '' : 's'} remaining.`}
                          </span>
                          {!isSubscribed && (
                            <CreditPurchase onPurchaseSuccess={refreshUsage} compact />
                          )}
                        </div>
                        {!isSubscribed && !generationBlocked && freeRemaining <= 2 && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-2">
                              Running low on free messages? Purchase credits to continue:
                            </p>
                            <div className="flex gap-2">
                              {CREDIT_PACKAGES.map((pkg) => (
                                <Button
                                  key={pkg.productId}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open('https://useautumn.com', '_blank')}
                                  className="text-xs"
                                >
                                  ${pkg.price} ({pkg.credits} credits)
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <inferenceForm.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                >
                  {([canSubmit, isSubmitting]) => (
                    <Button
                      type="submit"
                      disabled={!canSubmit || isSubmitting || envVarsMissing || generationBlocked}
                      className="w-full"
                    >
                      {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {envVarsMissing ? 'Setup Required' : 'Generate Response'}
                    </Button>
                  )}
                </inferenceForm.Subscribe>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="structured" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Structured Output</CardTitle>
              <CardDescription>
                Generate structured JSON responses with predefined schemas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  structuredForm.handleSubmit();
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <structuredForm.Field
                    name="topic"
                    validators={{
                      onChange: z.string().min(1, 'Topic is required'),
                    }}
                  >
                    {(field) => (
                      <Field>
                        <FieldLabel>Topic</FieldLabel>
                        <input
                          type="text"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="e.g., quantum computing"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                          <p className="text-sm text-red-500">
                            {String(field.state.meta.errors[0])}
                          </p>
                        )}
                      </Field>
                    )}
                  </structuredForm.Field>

                  <structuredForm.Field name="style">
                    {(field) => (
                      <Field>
                        <FieldLabel>Style</FieldLabel>
                        <Select
                          value={field.state.value}
                          onValueChange={(value) =>
                            field.handleChange(value as 'formal' | 'casual' | 'technical')
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="formal">Formal</SelectItem>
                            <SelectItem value="casual">Casual</SelectItem>
                            <SelectItem value="technical">Technical</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  </structuredForm.Field>
                </div>

                <structuredForm.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                >
                  {([canSubmit, isSubmitting]) => (
                    <Button
                      type="submit"
                      disabled={!canSubmit || isSubmitting || envVarsMissing || generationBlocked}
                      className="w-full"
                    >
                      {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {envVarsMissing ? 'Setup Required' : 'Generate Structured Response'}
                    </Button>
                  )}
                </structuredForm.Subscribe>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Gateway Diagnostics</CardTitle>
              <CardDescription>
                Test Cloudflare AI Gateway connectivity and configuration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={async () => {
                  const key = 'gateway-test';

                  // Show result card immediately with loading state
                  const initialResult: AIResult = {
                    response: '',
                  };
                  setResults((prev) => ({ ...prev, [key]: initialResult }));
                  setLoading((prev) => ({ ...prev, [key]: true }));

                  try {
                    const result = await testGatewayConnectivity();
                    setResults((prev) => ({ ...prev, [key]: result }));
                  } catch (error) {
                    setResults((prev) => ({
                      ...prev,
                      [key]: { error: error instanceof Error ? error.message : 'Unknown error' },
                    }));
                  } finally {
                    setLoading((prev) => ({ ...prev, [key]: false }));
                    await refreshUsage();
                  }
                }}
                disabled={envVarsMissing || loading['gateway-test']}
                className="w-full"
              >
                {loading['gateway-test'] && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Test Gateway Connectivity
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Results Display */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Results</h2>
        {Object.entries(results).length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No results yet. Try generating some responses above.
            </CardContent>
          </Card>
        )}

        {Object.entries(results)
          .reverse()
          .map(([key, result]) => {
            const isLoading = loading[key];

            return (
              <Card key={key}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {result.provider === 'cloudflare-workers-ai' && (
                        <Cpu className="w-5 h-5 text-blue-500" />
                      )}
                      {result.provider === 'cloudflare-gateway' && (
                        <Network className="w-5 h-5 text-green-500" />
                      )}
                      {result.provider === 'cloudflare-workers-ai-structured' && (
                        <Shield className="w-5 h-5 text-purple-500" />
                      )}
                      {key === 'gateway-test' && <Network className="w-5 h-5 text-orange-500" />}
                      <CardTitle className="text-lg">
                        {key === 'gateway-test'
                          ? 'Gateway Connectivity Test'
                          : result.provider === 'cloudflare-gateway'
                            ? 'AI Gateway'
                            : result.provider === 'cloudflare-workers-ai-structured'
                              ? 'Structured Output'
                              : 'Direct Workers AI'}
                      </CardTitle>
                    </div>
                    <Badge variant={result.error ? 'destructive' : 'default'}>
                      {isLoading ? 'Loading...' : result.error ? 'Error' : 'Complete'}
                    </Badge>
                  </div>
                  {result.model && <CardDescription>Model: {result.model}</CardDescription>}
                </CardHeader>
                <CardContent>
                  {isLoading && !result.response && (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating response...</span>
                    </div>
                  )}

                  {result.error && (
                    <div className="text-red-500 p-3 bg-red-50 rounded border">
                      <strong>Error:</strong> {result.error}
                    </div>
                  )}

                  {/* Result Content with Tabs */}
                  {(result.response || result.structuredData || result.parseError) &&
                    !result.error &&
                    (() => {
                      // Calculate which tabs are available
                      const hasJsonTab =
                        result.provider === 'cloudflare-workers-ai-structured' &&
                        (result.rawText || result.response);
                      const hasUsageTab = !!result.usage;
                      const totalTabs = 1 + (hasJsonTab ? 1 : 0) + (hasUsageTab ? 1 : 0);
                      const gridCols =
                        totalTabs === 3
                          ? 'grid-cols-3'
                          : totalTabs === 2
                            ? 'grid-cols-2'
                            : 'grid-cols-1';

                      return (
                        <Tabs
                          value={resultTabs[key] || 'response'}
                          onValueChange={(value) =>
                            setResultTabs((prev) => ({ ...prev, [key]: value }))
                          }
                          className="w-full"
                        >
                          <TabsList className={`grid w-full ${gridCols}`}>
                            <TabsTrigger value="response">Response</TabsTrigger>
                            {hasJsonTab && <TabsTrigger value="json">JSON</TabsTrigger>}
                            {hasUsageTab && <TabsTrigger value="usage">Usage</TabsTrigger>}
                          </TabsList>

                          <TabsContent value="response" className="mt-4">
                            {result.structuredData ? (
                              <div className="space-y-3">
                                <div className="p-4 bg-muted rounded">
                                  <h4 className="font-semibold mb-2">
                                    {result.structuredData.title}
                                  </h4>
                                  <p className="text-sm mb-3">{result.structuredData.summary}</p>

                                  <div className="space-y-2">
                                    <div className="flex gap-2">
                                      <Badge variant="outline">
                                        {result.structuredData.category}
                                      </Badge>
                                      <Badge variant="outline">
                                        {result.structuredData.difficulty}
                                      </Badge>
                                    </div>

                                    <div>
                                      <h5 className="font-medium mb-1">Key Points:</h5>
                                      <ul className="list-disc list-inside text-sm space-y-1">
                                        {result.structuredData.keyPoints.map((point: string) => (
                                          <li key={point}>{point}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : result.parseError ? (
                              <div className="space-y-3">
                                <div className="p-3 bg-red-50 border border-red-200 rounded">
                                  <div className="flex items-center space-x-2 mb-2">
                                    <span className="text-red-600 font-medium">
                                      JSON Parse Error:
                                    </span>
                                    <span className="text-red-500 text-sm">
                                      {result.parseError}
                                    </span>
                                  </div>
                                  <p className="text-sm text-red-700">
                                    The AI generated a response that couldn't be parsed as valid
                                    JSON. Check the JSON tab to see the raw response.
                                  </p>
                                </div>
                              </div>
                            ) : result.response &&
                              result.provider === 'cloudflare-workers-ai-structured' ? (
                              <div className="p-3 bg-muted rounded whitespace-pre-wrap">
                                <div className="text-sm text-muted-foreground mb-2">
                                  Generating structured JSON...
                                </div>
                                {result.response}
                              </div>
                            ) : result.response ? (
                              <div className="p-3 bg-muted rounded whitespace-pre-wrap">
                                {result.response}
                              </div>
                            ) : null}
                          </TabsContent>

                          {hasJsonTab && (
                            <TabsContent value="json" className="mt-4">
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Raw JSON Response</h4>
                                <pre className="p-3 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap border">
                                  {result.rawText || result.response || 'No JSON data available'}
                                </pre>
                              </div>
                            </TabsContent>
                          )}

                          {hasUsageTab && (
                            <TabsContent value="usage" className="mt-4">
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Usage Statistics</h4>
                                {result.usage ? (
                                  <div className="grid grid-cols-3 gap-4 p-3 bg-slate-50 rounded">
                                    <div className="text-center">
                                      <div className="text-lg font-semibold text-blue-600">
                                        {result.usage.inputTokens?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Input Tokens
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <div className="text-lg font-semibold text-green-600">
                                        {result.usage.outputTokens?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Output Tokens
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <div className="text-lg font-semibold text-purple-600">
                                        {result.usage.totalTokens?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Total Tokens
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-3 bg-slate-50 rounded text-center text-muted-foreground">
                                    No usage data available
                                  </div>
                                )}
                                {result.finishReason && (
                                  <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
                                    <strong>Finish Reason:</strong> {result.finishReason}
                                  </div>
                                )}
                              </div>
                            </TabsContent>
                          )}
                        </Tabs>
                      );
                    })()}

                  {key === 'gateway-test' &&
                    (() => {
                      // Calculate which tabs are available for gateway test
                      const hasResponseTab = !!(result.response || result.error);
                      const hasUsageTab = !!result.usage;
                      const totalTabs = 1 + (hasResponseTab ? 1 : 0) + (hasUsageTab ? 1 : 0);
                      const gridCols =
                        totalTabs === 3
                          ? 'grid-cols-3'
                          : totalTabs === 2
                            ? 'grid-cols-2'
                            : 'grid-cols-1';

                      return (
                        <Tabs
                          value={resultTabs[key] || 'response'}
                          onValueChange={(value) =>
                            setResultTabs((prev) => ({ ...prev, [key]: value }))
                          }
                          className="w-full"
                        >
                          <TabsList className={`grid w-full ${gridCols}`}>
                            <TabsTrigger value="response">Connection Test</TabsTrigger>
                            {hasResponseTab && <TabsTrigger value="json">Response</TabsTrigger>}
                            {hasUsageTab && <TabsTrigger value="usage">Usage</TabsTrigger>}
                          </TabsList>

                          <TabsContent value="response" className="mt-4">
                            <div className="space-y-3">
                              {result.success ? (
                                <div className="p-4 bg-green-50 border border-green-200 rounded">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                                    <span className="font-semibold text-green-800">
                                      Gateway Connected Successfully
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm text-green-700">
                                    <p>
                                      <strong>Status:</strong> {result.status} {result.statusText}
                                    </p>
                                    <p>
                                      <strong>Gateway URL:</strong> {result.gatewayUrl}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-4 bg-red-50 border border-red-200 rounded">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                                    <span className="font-semibold text-red-800">
                                      Gateway Connection Failed
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm text-red-700">
                                    <p>
                                      <strong>Error:</strong> {result.error}
                                    </p>
                                    {result.gatewayUrl && (
                                      <p>
                                        <strong>Gateway URL:</strong> {result.gatewayUrl}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </TabsContent>

                          {hasResponseTab && (
                            <TabsContent value="json" className="mt-4">
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Raw Response</h4>
                                <pre className="p-3 bg-slate-50 rounded text-xs overflow-x-auto whitespace-pre-wrap border">
                                  {result.response || result.error || 'No response data available'}
                                </pre>
                              </div>
                            </TabsContent>
                          )}

                          {hasUsageTab && (
                            <TabsContent value="usage" className="mt-4">
                              <div className="space-y-2">
                                <h4 className="text-sm font-medium">Usage Statistics</h4>
                                {result.usage ? (
                                  <div className="grid grid-cols-3 gap-4 p-3 bg-slate-50 rounded">
                                    <div className="text-center">
                                      <div className="text-lg font-semibold text-blue-600">
                                        {result.usage.inputTokens?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Input Tokens
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <div className="text-lg font-semibold text-green-600">
                                        {result.usage.outputTokens?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Output Tokens
                                      </div>
                                    </div>
                                    <div className="text-center">
                                      <div className="text-lg font-semibold text-purple-600">
                                        {result.usage.totalTokens?.toLocaleString() || '0'}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Total Tokens
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-3 bg-slate-50 rounded text-center text-muted-foreground">
                                    No usage data available
                                  </div>
                                )}
                              </div>
                            </TabsContent>
                          )}
                        </Tabs>
                      );
                    })()}
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
