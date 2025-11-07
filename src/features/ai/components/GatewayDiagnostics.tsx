import { Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

interface GatewayDiagnosticsProps {
  onTest: () => Promise<void>;
  disabled: boolean;
  isLoading: boolean;
}

export function GatewayDiagnostics({
  onTest,
  disabled,
  isLoading,
}: GatewayDiagnosticsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gateway Diagnostics</CardTitle>
        <CardDescription>
          Test Cloudflare AI Gateway connectivity and configuration
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onTest} disabled={disabled || isLoading} className="w-full">
          {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Test Gateway Connectivity
        </Button>
      </CardContent>
    </Card>
  );
}

