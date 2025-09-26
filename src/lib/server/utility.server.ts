import { createServerFn } from '@tanstack/react-start';
import { sql } from 'drizzle-orm';
import * as schema from '~/db/schema';
import { getDb } from './db-config.server';

// Health check endpoint for monitoring database and service readiness
export const healthCheckServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const startTime = Date.now();

  try {
    // Test database connectivity with a simple query
    await getDb().execute(sql`SELECT 1 as health_check`);

    // Check if critical tables exist by counting records in a key table
    const userCount = await getDb()
      .select({ count: sql<number>`count(*)` })
      .from(schema.user)
      .limit(1);

    const responseTime = Date.now() - startTime;

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      database: {
        connected: true,
        hasUsersTable: true,
        userCount: Number(userCount[0]?.count ?? 0),
      },
      service: {
        name: 'TBD',
        version: '1.0.0-alpha.0',
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
      },
      service: {
        name: 'TBD',
        version: '1.0.0-alpha.0',
        environment: process.env.NODE_ENV || 'development',
      },
    };
  }
});
