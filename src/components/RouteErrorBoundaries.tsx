import * as Sentry from '@sentry/tanstackstart-react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { ErrorComponent, Link, useRouter } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Home, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

// Base route error boundary component
function RouteErrorBoundary({
  error,
  reset,
  title,
  description,
  feature,
  showHomeButton = true,
}: ErrorComponentProps & {
  title: string;
  description: string;
  feature: string;
  showHomeButton?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  console.error(`${feature} Route Error:`, error);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <CardTitle className="text-destructive">{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => {
                reset();
                router.invalidate();
              }}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>

            <Button onClick={() => window.location.reload()} size="sm" variant="outline">
              Reload Page
            </Button>

            <Button onClick={() => window.history.back()} size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>

            {showHomeButton && (
              <Button asChild size="sm" variant="default">
                <Link to="/app" className="inline-flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Home
                </Link>
              </Button>
            )}
          </div>

          {/* Development error details */}
          {import.meta.env.DEV && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                Error Details (Development)
              </summary>
              <div className="mt-2 p-4 bg-muted rounded-md">
                <ErrorComponent error={error} />
              </div>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Feature-specific error boundary components
export function DashboardErrorBoundary(props: ErrorComponentProps) {
  return (
    <RouteErrorBoundary
      {...props}
      title="Dashboard Unavailable"
      description="We're having trouble loading your dashboard. This might be due to a temporary data connection issue."
      feature="Dashboard"
    />
  );
}

export function AdminErrorBoundary(props: ErrorComponentProps) {
  return (
    <RouteErrorBoundary
      {...props}
      title="Admin Panel Unavailable"
      description="We're having trouble loading the admin panel. This might be due to a temporary system issue."
      feature="Admin"
      showHomeButton={false}
    />
  );
}
