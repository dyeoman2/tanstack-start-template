import { useForm } from '@tanstack/react-form';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { UsageAlert } from '~/features/ai/components/UsageAlert';

interface FirecrawlFormProps {
  onSubmit: (data: { url: string }) => Promise<void>;
  apiKeyMissing: boolean;
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

export function FirecrawlForm({
  onSubmit,
  apiKeyMissing,
  isSubmitting,
  usageDetails,
  subscriptionDetails,
  isInitialSubscriptionLoad,
  onRefreshUsage,
}: FirecrawlFormProps) {
  const form = useForm({
    defaultValues: {
      url: 'https://useautumn.com/',
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Firecrawl Web Extraction</CardTitle>
        <CardDescription>
          Extract page content from any URL as markdown and JSON using Firecrawl
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
          <form.Field
            name="url"
            validators={{
              onChange: z.string().url('Please enter a valid URL'),
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>URL</FieldLabel>
                <Input
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="https://example.com"
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
                disabled={!canSubmit || isSubmittingForm || isSubmitting || apiKeyMissing}
                className="w-full"
              >
                {(isSubmittingForm || isSubmitting) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {apiKeyMissing ? 'Setup Required' : 'Extract Content'}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}
