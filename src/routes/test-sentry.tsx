import { createFileRoute } from '@tanstack/react-router';
import { SentryTestButton } from '~/components/SentryTestButton';

export const Route = createFileRoute('/test-sentry')({
  component: TestSentryRoute,
});

function TestSentryRoute() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md mx-auto p-6 bg-card rounded-lg shadow-lg border">
        <h1 className="text-2xl font-bold text-center mb-6">Sentry Test Page</h1>
        <p className="text-muted-foreground mb-6 text-center">
          Click the button below to test all Sentry features: error monitoring, performance tracing,
          console logging, and profiling.
        </p>
        <div className="flex justify-center">
          <SentryTestButton />
        </div>
        <div className="mt-6 text-sm text-muted-foreground">
          <p className="mb-2">
            <strong>What this does:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Logs console messages (log, warn, error) to Sentry</li>
            <li>Creates performance spans for profiling</li>
            <li>Makes a request to a test API with server-side logging and profiling</li>
            <li>Captures frontend errors and profiling data</li>
            <li>Captures server errors and profiling data</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
