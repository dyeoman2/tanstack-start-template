import { Outlet, useLocation } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { AppNavigation } from '~/components/AppNavigation';
import { ClientOnly } from '~/components/ClientOnly';

/**
 * Application shell component following TanStack Start best practices
 * Handles the main app layout with navigation and content area
 */
export function AppShell() {
  const location = useLocation();

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
