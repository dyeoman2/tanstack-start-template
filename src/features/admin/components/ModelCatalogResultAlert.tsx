import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';

type ModelCatalogResult = {
  success: boolean;
  message: string;
  modelCount?: number;
  publicModelCount?: number;
  adminModelCount?: number;
  refreshedAt?: number;
};

interface ModelCatalogResultAlertProps {
  result: ModelCatalogResult | null;
}

export function ModelCatalogResultAlert({ result }: ModelCatalogResultAlertProps) {
  if (!result) {
    return null;
  }

  return (
    <Alert
      className={`mb-6 ${result.success ? 'border-primary/20 bg-primary/5' : 'border-secondary bg-secondary/50'}`}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{result.success ? 'AI Models Refreshed' : 'AI Model Refresh Failed'}</AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          <p>{result.message}</p>
          {result.success && result.modelCount !== undefined ? (
            <p className="text-sm text-muted-foreground">
              {result.modelCount} total models, {result.publicModelCount ?? 0} public,{' '}
              {result.adminModelCount ?? 0} admin-only.
            </p>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
