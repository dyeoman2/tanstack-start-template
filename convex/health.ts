import { internal } from './_generated/api';
import { httpAction, internalQuery } from './_generated/server';
import { probeHealthValidator } from './lib/returnValidators';

export const probeHealth = internalQuery({
  args: {},
  returns: probeHealthValidator,
  handler: async (ctx) => {
    await ctx.db.query('users').take(1);
    return { connected: true as const };
  },
});

/**
 * Health check HTTP endpoint
 * Returns a minimal public liveness probe.
 */
export const healthCheck = httpAction(async (ctx, _request) => {
  try {
    await ctx.runQuery(internal.health.probeHealth, {});

    return new Response(
      JSON.stringify({
        status: 'healthy',
      }),
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error('Health check failed', error);

    return new Response(
      JSON.stringify({
        status: 'unhealthy',
      }),
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
