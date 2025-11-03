import { ConvexReactClient } from 'convex/react';

const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.VITE_CONVEX_SITE_URL;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL or VITE_CONVEX_SITE_URL environment variable is required');
}

export const convexClient = new ConvexReactClient(convexUrl, {
  expectAuth: true,
});
