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
          Click the button below to test Sentry error monitoring and performance tracing.
        </p>
        <div className="flex justify-center">
          <SentryTestButton />
        </div>
        <div className="mt-6 text-sm text-muted-foreground">
          <p className="mb-2">
            <strong>What this does:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Creates a performance span</li>
            <li>Makes a request to a test API that throws an error</li>
            <li>Captures the frontend error in Sentry</li>
            <li>Captures the server error in Sentry</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
