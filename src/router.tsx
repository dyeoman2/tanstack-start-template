import { createRouter as createTanStackRouter, type RouterHistory } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';
import type { UserRole } from '~/features/auth/types';
import { initializeSentry } from '~/lib/sentry';
import type { UserId } from '~/lib/shared/user-id';
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary';
import { NotFound } from './components/NotFound';
import { routeTree } from './routeTree.gen';

declare module '@tanstack/react-start' {
  interface Register {
    server: {
      requestContext: {
        nonce?: string;
      };
    };
  }
}

// Auth context type for route-level caching - matches root loader return type
export type RouterAuthContext =
  | {
      authenticated: false;
      user: null;
    }
  | {
      authenticated: true;
      user: {
        id: UserId;
        email: string;
        name?: string;
        role: UserRole;
        isSiteAdmin: boolean;
        mfaEnabled?: boolean;
        requiresMfaSetup?: boolean;
      } | null;
    };

export const defaultRouterAuthContext: RouterAuthContext = {
  authenticated: false,
  user: null,
};

declare module '@tanstack/history' {
  interface HistoryState {
    organizationBreadcrumb?: {
      name: string;
      slug: string;
    };
  }
}

interface CreateAppRouterOptions {
  history?: RouterHistory;
  context?: RouterAuthContext;
  ssrNonce?: string;
}

function getRequestScopedNonce() {
  try {
    return getGlobalStartContext()?.nonce;
  } catch {
    return undefined;
  }
}

export function createAppRouter({
  history,
  context = defaultRouterAuthContext,
  ssrNonce = getRequestScopedNonce(),
}: CreateAppRouterOptions = {}) {
  const router = createTanStackRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000, // 30 seconds
    defaultPreloadGcTime: 5 * 60_000, // 5 minutes
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: false, // Disabled due to $_TSR ordering bug in v1.132.47
    // Provide default auth context - optimistic for performance
    context,
    ssr: ssrNonce
      ? {
          nonce: ssrNonce,
        }
      : undefined,
  });

  // Initialize Sentry for error tracking and performance monitoring
  initializeSentry(router);

  return router;
}

export function getRouter() {
  return createAppRouter();
}
