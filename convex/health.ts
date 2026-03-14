import { internal } from './_generated/api';
import { httpAction, internalQuery } from './_generated/server';

export const probeHealth = internalQuery({
  args: {},
  handler: async (ctx) => {
    await ctx.db.query('users').take(1);
    return { connected: true as const };
  },
});

/**
 * Health check HTTP endpoint
 * Returns database connectivity status and service metadata
 */
export const healthCheck = httpAction(async (ctx, _request) => {
  const startTime = Date.now();

  try {
    await ctx.runQuery(internal.health.probeHealth, {});

    const responseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        database: {
          connected: true,
          provider: 'convex',
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
    console.error('Health check failed', error);
    const responseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        error: 'Service unavailable',
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
