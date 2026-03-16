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
          sendDefaultPii: false,
          integrations: [
            Sentry.tanstackRouterBrowserTracingIntegration(router),
            Sentry.feedbackIntegration({
              colorScheme: 'system',
            }),
          ],
          enableLogs: false,
          tracesSampleRate: isProduction ? 0.1 : 1.0,
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
