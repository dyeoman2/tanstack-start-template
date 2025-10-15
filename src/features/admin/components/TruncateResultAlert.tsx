import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';

type TruncateResult = {
  success: boolean;
  message: string;
  truncatedTables?: number;
  failedTables?: number;
  totalTables?: number;
  failedTableNames?: string[];
  invalidateAllCaches?: boolean;
};

interface TruncateResultAlertProps {
  truncateResult: TruncateResult | null;
}

export function TruncateResultAlert({ truncateResult }: TruncateResultAlertProps) {
  if (!truncateResult) return null;

  return (
    <Alert
      className={`mb-6 ${truncateResult.success ? 'border-primary/20 bg-primary/5' : 'border-secondary bg-secondary/50'}`}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{truncateResult.success ? 'Success' : 'Partial Success'}</AlertTitle>
      <AlertDescription>
        <div className="space-y-2">
          <p>{truncateResult.message}</p>
          {truncateResult.totalTables && truncateResult.failedTables !== undefined && (
            <div className="text-sm">
              <p>
                <strong>Results:</strong> {truncateResult.truncatedTables} of{' '}
                {truncateResult.totalTables} tables truncated successfully
                {truncateResult.failedTables > 0 && (
                  <>
                    , {truncateResult.failedTables} failed
                    {truncateResult.failedTableNames &&
                      truncateResult.failedTableNames.length > 0 && (
                        <span className="block mt-1 text-xs text-muted-foreground">
                          Failed tables: {truncateResult.failedTableNames.join(', ')}
                        </span>
                      )}
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
