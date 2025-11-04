import { ConvexReactClient } from 'convex/react';

// Use .cloud URL specifically for database operations
const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL environment variable is required');
}

export const convexClient = new ConvexReactClient(convexUrl, {
  expectAuth: true,
});
