import { nodeProfilingIntegration } from '@sentry/profiling-node';
import * as Sentry from '@sentry/tanstackstart-react';

const sentryDsn = process.env.VITE_SENTRY_DSN;
const isProduction = process.env.NODE_ENV === 'production';

// Only enable Sentry in production or for test events
if (sentryDsn && (isProduction || process.argv.includes('--test-sentry'))) {
  Sentry.init({
    dsn: sentryDsn,
    // Adds request headers and IP for users, for more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
    // logs
    // Enable logs to be sent to Sentry (production only)
    enableLogs: process.env.NODE_ENV === 'production',
    // logs
    // performance
    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for tracing.
    // We recommend adjusting this value in production
    // Learn more at
    // https://docs.sentry.io/platforms/javascript/configuration/options/#traces-sample-rate
    tracesSampleRate: 1.0,
    // performance
    // Node.js profiling
    integrations: [
      nodeProfilingIntegration(),
      // send console.log, console.warn, and console.error calls as logs to Sentry
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    ],
    // Set sampling rate for profiling - this is evaluated only once per SDK.init call
    profileSessionSampleRate: 1.0,
    // Trace lifecycle automatically enables profiling during active traces
    profileLifecycle: 'trace',
    // Node.js profiling
  });
}
