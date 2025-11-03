import * as Sentry from '@sentry/tanstackstart-react';
import type { AnyRouter } from '@tanstack/react-router';

/**
 * Initialize Sentry for client-side error tracking and performance monitoring
 */
export function initializeSentry(router: AnyRouter) {
  // Initialize Sentry on client-side only when DSN is available
  // Only enable in production or when explicitly testing
  if (!router.isServer) {
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    const isProduction = import.meta.env.PROD;
    const isTestPage = window.location.pathname === '/test-sentry';

    if (sentryDsn && (isProduction || isTestPage)) {
      Sentry.init({
        dsn: sentryDsn,
        // Adds request headers and IP for users, for more info visit:
        // https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/configuration/options/#sendDefaultPii
        sendDefaultPii: true,
        integrations: [
          // performance
          Sentry.tanstackRouterBrowserTracingIntegration(router),
          // performance
          // session-replay
          Sentry.replayIntegration(),
          // session-replay
          // user-feedback
          Sentry.feedbackIntegration({
            // Additional SDK configuration goes in here, for example:
            colorScheme: 'system',
          }),
          // user-feedback
        ],
        // logs
        // Enable logs to be sent to Sentry (production only)
        enableLogs: import.meta.env.PROD,
        // logs
        // performance
        // Set tracesSampleRate to 1.0 to capture 100%
        // of transactions for tracing.
        // We recommend adjusting this value in production.
        // Learn more at https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
        tracesSampleRate: 1.0,
        // performance
        // session-replay
        // Capture Replay for 10% of all sessions,
        // plus for 100% of sessions with an error.
        // Learn more at https://docs.sentry.io/platforms/javascript/session-replay/configuration/#general-integration-configuration
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        // session-replay
      });
    }
  }
}
