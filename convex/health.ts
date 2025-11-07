import { api } from './_generated/api';
import { httpAction } from './_generated/server';

/**
 * Health check HTTP endpoint
 * Returns database connectivity status and service metadata
 */
export const healthCheck = httpAction(async (ctx, _request) => {
  const startTime = Date.now();

  try {
    // Test Convex connectivity by checking user count
    const userCountResult = await ctx.runQuery(api.users.getUserCount, {});

    const responseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
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
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
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
        },
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
