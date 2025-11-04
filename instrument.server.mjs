import { createRequire } from 'node:module';
import * as Sentry from '@sentry/tanstackstart-react';

const require = createRequire(import.meta.url);

let nodeProfilingIntegration;
try {
  ({ nodeProfilingIntegration } = require('@sentry/profiling-node'));
  const semverMajor = parseInt(process.versions.modules ?? '0', 10);
  const supportedModules = new Set([93, 108, 115, 127, 137]);
  if (!supportedModules.has(semverMajor)) {
    console.warn(
      `[sentry] Node profiling native module does not ship a binary for Node ${process.version} (ABI ${semverMajor}). Profiling is disabled.`,
    );
    nodeProfilingIntegration = undefined;
  } else {
    console.info('[sentry] Node profiling integration enabled.');
  }
} catch (_error) {
  console.warn(
    '[sentry] Node profiling native module not available, continuing without profiling integration.',
  );
}

const sentryDsn = process.env.VITE_SENTRY_DSN;
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV !== 'production';

// Enable Sentry in production, and in development when a DSN is provided for testing
if (sentryDsn && (isProduction || isDevelopment)) {
  Sentry.init({
    dsn: sentryDsn,
    environment: isProduction ? 'production' : 'development',
    // Adds request headers and IP for users, for more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
    // logs
    // Enable logs to be sent to Sentry (allowed for dev testing too)
    enableLogs: true,
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
      ...(nodeProfilingIntegration ? [nodeProfilingIntegration()] : []),
      // send console.log, console.warn, and console.error calls as logs to Sentry
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    ],
    ...(nodeProfilingIntegration
      ? {
          // Capture profiles for 100% of transactions during testing
          profilesSampleRate: 1.0,
          // Trace lifecycle automatically enables profiling during active traces
          profileLifecycle: 'trace',
        }
      : {}),
    // Node.js profiling
  });
}
