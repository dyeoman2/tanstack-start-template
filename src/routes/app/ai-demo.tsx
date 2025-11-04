import { useForm } from '@tanstack/react-form';
import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, Cloud, Cpu, Loader2, Network, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
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
import {
  compareInferenceMethods,
  generateStructuredResponse,
  generateWithGateway,
  generateWithWorkersAI,
  testGatewayConnectivity,
} from '~/features/ai/server/cloudflare-ai.server';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/ai-demo')({
  component: CloudflareAIDemo,
  errorComponent: DashboardErrorBoundary,
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
}

function CloudflareAIDemo() {
  usePerformanceMonitoring('Cloudflare AI Demo');

  const [activeTab, setActiveTab] = useState('inference');
  const [results, setResults] = useState<Record<string, AIResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [envVarsMissing, setEnvVarsMissing] = useState(false);
  const [setupInstructions, setSetupInstructions] = useState<string | null>(null);

  // Check for environment variables availability
  useEffect(() => {
    const checkEnvVars = async () => {
      try {
        // Try to test gateway connectivity to see if env vars are set
        await testGatewayConnectivity();
        setEnvVarsMissing(false);
        setSetupInstructions(null);
      } catch (_error) {
        setEnvVarsMissing(true);
        setSetupInstructions(
          'Cloudflare AI is not configured. Please follow the setup guide to get started with Cloudflare Workers AI.',
        );
      }
    };

    checkEnvVars();
  }, []);

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

      const key = `${value.method}-${Date.now()}`;
      setLoading((prev) => ({ ...prev, [key]: true }));

      try {
        let result: AIResult;

        switch (value.method) {
          case 'direct':
            result = await generateWithWorkersAI({
              data: { prompt: value.prompt, model: value.model },
            });
            break;
          case 'gateway':
            result = await generateWithGateway({
              data: { prompt: value.prompt, model: value.model },
            });
            break;
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

            result = {
              response: `Direct: ${directResponse}\n\nGateway: ${gatewayResponse}`,
              usage: {
                direct: directUsage,
                gateway: gatewayUsage,
              },
            };
            break;
          }
          default:
            throw new Error('Invalid method');
        }

        setResults((prev) => ({ ...prev, [key]: result }));
      } catch (error) {
        setResults((prev) => ({
          ...prev,
          [key]: { error: error instanceof Error ? error.message : 'Unknown error' },
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [key]: false }));
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

      const key = `structured-${Date.now()}`;
      setLoading((prev) => ({ ...prev, [key]: true }));

      try {
        const result = await generateStructuredResponse({
          data: { topic: value.topic, style: value.style },
        });

        setResults((prev) => ({ ...prev, [key]: result }));
      } catch (error) {
        setResults((prev) => ({
          ...prev,
          [key]: { error: error instanceof Error ? error.message : 'Unknown error' },
        }));
      } finally {
        setLoading((prev) => ({ ...prev, [key]: false }));
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
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Cloud className="w-8 h-8 text-orange-500" />
          Cloudflare AI Demo
        </h1>
        <p className="text-muted-foreground">
          Compare direct Workers AI inference with AI Gateway monitoring using the Vercel AI SDK
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
            <CardDescription className="text-amber-700">{setupInstructions}</CardDescription>
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inference">Text Generation</TabsTrigger>
          <TabsTrigger value="structured">Structured Output</TabsTrigger>
          <TabsTrigger value="diagnostics">Gateway Diagnostics</TabsTrigger>
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
                        placeholder="Enter your prompt..."
                        rows={4}
                      />
                      {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                        <p className="text-sm text-red-500">{String(field.state.meta.errors[0])}</p>
                      )}
                    </Field>
                  )}
                </inferenceForm.Field>

                <inferenceForm.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                >
                  {([canSubmit, isSubmitting]) => (
                    <Button
                      type="submit"
                      disabled={!canSubmit || isSubmitting || envVarsMissing}
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
                      disabled={!canSubmit || isSubmitting || envVarsMissing}
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

        {Object.entries(results).map(([key, result]) => {
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
                {isLoading && (
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

                {result.structuredData && (
                  <div className="space-y-3">
                    <div className="p-4 bg-muted rounded">
                      <h4 className="font-semibold mb-2">{result.structuredData.title}</h4>
                      <p className="text-sm mb-3">{result.structuredData.summary}</p>

                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Badge variant="outline">{result.structuredData.category}</Badge>
                          <Badge variant="outline">{result.structuredData.difficulty}</Badge>
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
                )}

                {result.response && !result.structuredData && (
                  <div className="p-3 bg-muted rounded whitespace-pre-wrap">{result.response}</div>
                )}

                {key === 'gateway-test' && (
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
                )}

                {result.usage && (
                  <div className="mt-3 p-3 bg-slate-50 rounded text-sm">
                    <strong>Usage:</strong>
                    <pre className="mt-1 text-xs">{JSON.stringify(result.usage, null, 2)}</pre>
                  </div>
                )}

                {result.finishReason && (
                  <div className="mt-2 text-sm text-muted-foreground">
                    Finish Reason: {result.finishReason}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
