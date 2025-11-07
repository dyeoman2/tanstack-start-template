import { useForm } from '@tanstack/react-form';
import { Loader2 } from 'lucide-react';
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
import { UsageAlert } from '~/features/ai/components/UsageAlert';

interface StructuredFormProps {
  onSubmit: (data: { topic: string; style: 'formal' | 'casual' | 'technical' }) => Promise<void>;
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

export function StructuredForm({
  onSubmit,
  envVarsMissing,
  generationBlocked,
  isSubmitting,
  usageDetails,
  subscriptionDetails,
  isInitialSubscriptionLoad,
  onRefreshUsage,
}: StructuredFormProps) {
  const form = useForm({
    defaultValues: {
      topic: 'machine learning',
      style: 'formal' as 'formal' | 'casual' | 'technical',
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
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
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form.Field
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
                    <p className="text-sm text-red-500">{String(field.state.meta.errors[0])}</p>
                  )}
                </Field>
              )}
            </form.Field>

            <form.Field name="style">
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
            </form.Field>
          </div>

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
                {envVarsMissing ? 'Setup Required' : 'Generate Structured Response'}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
