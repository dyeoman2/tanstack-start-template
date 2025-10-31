import { Outlet, useLocation, useRouter } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useEffect, useRef } from 'react';
import { AppNavigation } from '~/components/AppNavigation';
import { ClientOnly } from '~/components/ClientOnly';
import { useAuthContext } from '~/components/Providers';

/**
 * Application shell component following TanStack Start best practices
 * Handles the main app layout with navigation and content area
 * Also manages router auth context updates
 */
export function AppShell() {
  const location = useLocation();
  const router = useRouter();
  const { authContext } = useAuthContext();
  const prevLocationRef = useRef<string | undefined>(undefined);

  // Track navigation events with more detail
  useEffect(() => {
    const currentPath = location.pathname;
    prevLocationRef.current = currentPath;
  }, [location.pathname]);

  // Listen for router navigation events
  useEffect(() => {
    const unsubscribeBeforeLoad = router.subscribe('onBeforeLoad', () => {
      // Handle before load events if needed
    });

    const unsubscribeOnLoad = router.subscribe('onLoad', () => {
      // Handle on load events if needed
    });

    return () => {
      unsubscribeBeforeLoad();
      unsubscribeOnLoad();
    };
  }, [router]);

  // Update router context with current auth state for optimistic auth
  useEffect(() => {
    router.update({
      context: authContext,
    });
  }, [authContext, router]);

  // Hide navigation on auth routes
  const isAuthRoute = ['/login', '/register', '/forgot-password', '/reset-password'].includes(
    location.pathname,
  );

  return (
    <>
      <div className="min-h-screen bg-background">
        {!isAuthRoute && <AppNavigation />}
        <main
          className={`max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 ${isAuthRoute ? 'pt-12' : ''}`}
        >
          <Outlet />
        </main>
      </div>
      {import.meta.env.DEV && (
        <ClientOnly>
          <TanStackRouterDevtools position="bottom-right" />
        </ClientOnly>
      )}
    </>
  );
}
