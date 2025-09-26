import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '~/db/schema';

// Load environment variables from .env.local in development
if (process.env.NODE_ENV !== 'production') {
  config({ path: '.env.local' });
}

// Database configuration for TanStack Start + Netlify + Neon

/**
 * Create database client - unified instance for all database operations
 * Automatically chooses between Neon (production) and postgres-js (local development)
 * Drizzle handles connection pooling and lazy connections automatically
 */
function createDatabaseClient() {
  const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or NETLIFY_DATABASE_URL environment variable is required');
  }

  // Choose driver based on connection string
  // Neon databases typically contain 'neon.tech' or use WebSocket connections
  const isNeonDatabase =
    connectionString.includes('neon.tech') ||
    connectionString.includes('vercel-postgres') ||
    connectionString.includes('supabase');

  if (isNeonDatabase) {
    // Production: Use Neon driver
    const neonClient = neon(connectionString);
    return drizzleNeon(neonClient, { schema });
  } else {
    // Local development: Use postgres-js driver
    const pgClient = postgres(connectionString);
    return drizzlePg(pgClient, { schema });
  }
}

/**
 * Unified database instance for all application database operations
 * Used by both auth and application code
 * Lazy-loaded to ensure environment variables are available
 */
let dbInstance: ReturnType<typeof createDatabaseClient> | null = null;

/**
 * Get database instance with lazy initialization
 * Replaces proxy pattern for better performance
 */
export function getDb() {
  if (!dbInstance) {
    dbInstance = createDatabaseClient();
  }
  return dbInstance;
}
