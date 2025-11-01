import { api } from '@convex/_generated/api';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';

// No auth cookies needed for unauthenticated endpoints
const noAuthCookieGetter = () => undefined;

// Health check endpoint for monitoring database and service readiness
export const healthCheckServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const startTime = Date.now();

  try {
    // Test Convex connectivity by checking user count
    const { fetchQuery } = await setupFetchClient(createAuth, noAuthCookieGetter);
    const userCountResult = await fetchQuery(api.users.getUserCount, {});

    const responseTime = Date.now() - startTime;

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      database: {
        connected: true,
        provider: 'convex',
        userCount: userCountResult.totalUsers,
      },
      service: {
        name: 'TanStack Start Template',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
      },
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      error: error instanceof Error ? error.message : 'Unknown error',
      database: {
        connected: false,
        provider: 'convex',
      },
      service: {
        name: 'TanStack Start Template',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }
});
