import * as Sentry from '@sentry/tanstackstart-react';
import type { AnyRouter } from '@tanstack/react-router';
import type { RouterAuthContext } from '~/router';

let sentryInitialized = false;

/**
 * Set user context in Sentry for authenticated users
 * This ensures user name, email, and ID appear in replays and other tracking
 */
export function setSentryUser(user: RouterAuthContext['user']) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.name || undefined,
    });
  } else {
    // Clear user context when user is not authenticated
    Sentry.setUser(null);
  }
}

/**
 * Set server-side Sentry user context for authenticated users
 * This ensures user name, email, and ID appear in server-side events
 */
export function setSentryServerUser(user: { id: string; email: string; name?: string } | null) {
  if (user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.name || undefined,
    });
  } else {
    // Clear user context when user is not authenticated
    Sentry.setUser(null);
  }
}

/**
 * Initialize Sentry for client-side error tracking and performance monitoring
 */
export function initializeSentry(router: AnyRouter) {
  // Initialize Sentry on client-side only when DSN is available
  // Only enable in production or when explicitly testing
  if (!router.isServer) {
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    const isProduction = import.meta.env.PROD;
    const testRoutePathname = '/test-sentry';

    const maybeInitialize = (pathname: string) => {
      if (!sentryInitialized && sentryDsn && (isProduction || pathname === testRoutePathname)) {
        Sentry.init({
          dsn: sentryDsn,
          environment: isProduction ? 'production' : 'development',
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
            // browser profiling
            Sentry.browserProfilingIntegration(),
            // browser profiling
            // logging
            // send console.log, console.warn, and console.error calls as logs to Sentry
            Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
            // logging
            // user-feedback
            Sentry.feedbackIntegration({
              // Additional SDK configuration goes in here, for example:
              colorScheme: 'system',
            }),
            // user-feedback
          ],
          // logs
          // Enable logs to be sent to Sentry (enabled for both production and dev test page)
          enableLogs: true,
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
          // browser profiling
          // Set profilesSampleRate to 1.0 to profile every transaction.
          // Since profilesSampleRate is relative to tracesSampleRate,
          // the final profiling rate can be computed as tracesSampleRate * profilesSampleRate
          // For example, a tracesSampleRate of 0.5 and profilesSampleRate of 0.5 would
          // results in 25% of transactions being profiled (0.5*0.5=0.25)
          profilesSampleRate: 1.0,
          // browser profiling
        });
        sentryInitialized = true;
      }
    };

    maybeInitialize(window.location.pathname);

    if (!sentryInitialized && !isProduction) {
      let unsubscribe: (() => void) | undefined;

      const handleResolved = () => {
        const currentPath = router.state.location.pathname;
        maybeInitialize(currentPath);
        if (sentryInitialized && unsubscribe) {
          unsubscribe();
          unsubscribe = undefined;
        }
      };

      unsubscribe = router.subscribe('onResolved', handleResolved);
    }
  }
}
