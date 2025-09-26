import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary';
import { NotFound } from './components/NotFound';
import { routeTree } from './routeTree.gen';

// Auth context type for route-level caching - matches root loader return type
export type RouterAuthContext = {
  user: { id: string; email: string; name?: string; role: string } | null;
  authenticated: boolean;
};

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000, // 30 seconds
    defaultPreloadGcTime: 5 * 60_000, // 5 minutes
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
    // Provide default auth context
    context: {
      user: null,
      authenticated: false,
    } satisfies RouterAuthContext,
  });

  return router;
}
