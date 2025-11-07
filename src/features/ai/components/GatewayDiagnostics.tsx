import { Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { UsageAlert } from '~/features/ai/components/UsageAlert';

interface GatewayDiagnosticsProps {
  onTest: () => Promise<void>;
  disabled: boolean;
  isLoading: boolean;
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

export function GatewayDiagnostics({
  onTest,
  disabled,
  isLoading,
  usageDetails,
  subscriptionDetails,
  isInitialSubscriptionLoad,
  onRefreshUsage,
}: GatewayDiagnosticsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gateway Diagnostics</CardTitle>
        <CardDescription>Test Cloudflare AI Gateway connectivity and configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UsageAlert
          usageDetails={usageDetails}
          subscriptionDetails={subscriptionDetails}
          isInitialSubscriptionLoad={isInitialSubscriptionLoad}
          onRefreshUsage={onRefreshUsage}
        />
        <Button onClick={onTest} disabled={disabled || isLoading} className="w-full">
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Test Gateway Connectivity
        </Button>
      </CardContent>
    </Card>
  );
}
