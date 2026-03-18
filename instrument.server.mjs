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
const sentryApproved =
  typeof process.env.ENABLE_SENTRY_EGRESS === 'string' &&
  ['1', 'true', 'yes', 'on'].includes(process.env.ENABLE_SENTRY_EGRESS.trim().toLowerCase());

function sanitizeTelemetryEvent(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  const safeKeys = new Set([
    'contexts',
    'environment',
    'event_id',
    'exception',
    'fingerprint',
    'level',
    'logger',
    'message',
    'platform',
    'release',
    'tags',
    'timestamp',
    'transaction',
    'type',
  ]);
  const safeTagKeys = new Set(['component', 'feature', 'route', 'surface', 'vendor']);
  const safeContextKeys = new Set(['app', 'browser', 'device', 'os', 'runtime', 'trace']);
  const next = {};

  for (const [key, value] of Object.entries(event)) {
    if (!safeKeys.has(key)) {
      continue;
    }

    if (key === 'tags' && value && typeof value === 'object' && !Array.isArray(value)) {
      next.tags = Object.fromEntries(
        Object.entries(value).filter(([tagKey]) => safeTagKeys.has(tagKey)),
      );
      continue;
    }

    if (key === 'contexts' && value && typeof value === 'object' && !Array.isArray(value)) {
      next.contexts = Object.fromEntries(
        Object.entries(value).filter(([contextKey]) => safeContextKeys.has(contextKey)),
      );
      continue;
    }

    next[key] =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? value
        : key === 'exception'
          ? value
          : '[REDACTED]';
  }

  return next;
}

// Enable Sentry in production, and in development when a DSN is provided for testing
if (sentryApproved && sentryDsn && (isProduction || isDevelopment)) {
  Sentry.init({
    dsn: sentryDsn,
    environment: isProduction ? 'production' : 'development',
    sendDefaultPii: false,
    enableLogs: false,
    tracesSampleRate: isProduction ? 0.05 : 0.01,
    // Node.js profiling
    integrations: [...(nodeProfilingIntegration ? [nodeProfilingIntegration()] : [])],
    beforeSend(event) {
      return sanitizeTelemetryEvent(event);
    },
    ...(nodeProfilingIntegration
      ? {
          profilesSampleRate: isProduction ? 0.01 : 0,
          // Trace lifecycle automatically enables profiling during active traces
          profileLifecycle: 'trace',
        }
      : {}),
    // Node.js profiling
  });
}
