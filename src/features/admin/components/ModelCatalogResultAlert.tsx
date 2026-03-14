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
    <Alert className="mb-6" variant={result.success ? 'success' : 'destructive'}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {result.success ? 'AI Model Catalog Updated' : 'AI Model Update Failed'}
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          <p>{result.message}</p>
        </div>
      </AlertDescription>
    </Alert>
  );
}
