import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start';

const convexUrl = import.meta.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL environment variable is required');
}

const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
if (!convexSiteUrl) {
  throw new Error('VITE_CONVEX_SITE_URL environment variable is required');
}

export const convexAuthReactStart = convexBetterAuthReactStart({
  convexUrl,
  convexSiteUrl,
});
