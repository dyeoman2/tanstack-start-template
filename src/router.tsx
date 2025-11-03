import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { initializeSentry } from '~/lib/sentry';
import type { UserId } from '~/lib/shared/user-id';
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary';
import { NotFound } from './components/NotFound';
import { routeTree } from './routeTree.gen';

// Auth context type for route-level caching - matches root loader return type
export type RouterAuthContext =
  | {
      authenticated: false;
      user: null;
    }
  | {
      authenticated: true;
      user: { id: UserId; email: string; name?: string; role: string } | null; // null for optimistic auth
    };

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000, // 30 seconds
    defaultPreloadGcTime: 5 * 60_000, // 5 minutes
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: false, // Disabled due to $_TSR ordering bug in v1.132.47
    // Provide default auth context - optimistic for performance
    context: {
      authenticated: false,
      user: null,
    } satisfies RouterAuthContext,
  });

  // Initialize Sentry for error tracking and performance monitoring
  initializeSentry(router);

  return router;
}
