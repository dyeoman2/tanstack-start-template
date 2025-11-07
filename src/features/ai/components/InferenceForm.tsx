import { useForm } from '@tanstack/react-form';
import { BarChart3, Cpu, Loader2, Network } from 'lucide-react';
import { z } from 'zod';
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
import { Textarea } from '~/components/ui/textarea';
import { UsageAlert } from '~/features/ai/components/UsageAlert';
import type { InferenceMethod } from '~/features/ai/types';

interface InferenceFormProps {
  onSubmit: (data: {
    prompt: string;
    model: 'llama' | 'falcon';
    method: InferenceMethod;
  }) => Promise<void>;
  envVarsMissing: boolean;
  generationBlocked: boolean;
  isSubmitting: boolean;
  usageDetails: {
    freeLimit: number;
    freeMessagesRemaining: number;
  } | null;
  subscriptionDetails: {
    status: string;
    isUnlimited: boolean;
    creditBalance: number | null;
  } | null;
  isInitialSubscriptionLoad: boolean;
  onRefreshUsage: () => Promise<void>;
}

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

export function InferenceForm({
  onSubmit,
  envVarsMissing,
  generationBlocked,
  isSubmitting,
  usageDetails,
  subscriptionDetails,
  isInitialSubscriptionLoad,
  onRefreshUsage,
}: InferenceFormProps) {
  const form = useForm({
    defaultValues: {
      prompt: 'Explain how neural networks work in simple terms.',
      model: 'llama' as 'llama' | 'falcon',
      method: 'direct' as InferenceMethod,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
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
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form.Field name="model">
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
            </form.Field>

            <form.Field name="method">
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
            </form.Field>
          </div>

          <form.Field
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
                      form.handleSubmit();
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
          </form.Field>

          <UsageAlert
            usageDetails={usageDetails}
            subscriptionDetails={subscriptionDetails}
            isInitialSubscriptionLoad={isInitialSubscriptionLoad}
            onRefreshUsage={onRefreshUsage}
          />

          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmittingForm]) => (
              <Button
                type="submit"
                disabled={
                  !canSubmit ||
                  isSubmittingForm ||
                  isSubmitting ||
                  envVarsMissing ||
                  generationBlocked
                }
                className="w-full"
              >
                {(isSubmittingForm || isSubmitting) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {envVarsMissing ? 'Setup Required' : 'Generate Response'}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
