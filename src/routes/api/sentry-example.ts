import * as Sentry from '@sentry/tanstackstart-react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/sentry-example')({
  server: {
    handlers: {
      GET: () => {
        // Test server-side console logging
        console.log('Sentry server test: This is a server console.log message');
        console.warn('Sentry server test: This is a server console.warn message');
        console.error('Sentry server test: This is a server console.error message');

        // Test server-side profiling with spans
        return Sentry.startSpan(
          {
            name: 'Example Server Span',
            op: 'test',
          },
          async () => {
            // Simulate some server work that should be profiled
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Throw error to test error tracking
            throw new Error('Sentry Example Route Error');
          },
        );
      },
    },
  },
});
