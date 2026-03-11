import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { NotFound } from '~/components/NotFound';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Spinner } from '~/components/ui/spinner';
import { useAuthState } from '~/features/auth/hooks/useAuthState';

export const Route = createFileRoute('/app')({
  pendingMs: 150,
  pendingMinMs: 250,
  pendingComponent: () => <AppLayoutSkeleton />,
  component: AppLayout,
  errorComponent: DashboardErrorBoundary,
  notFoundComponent: () => <NotFound />,
});

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isPending } = useAuthState();
  const redirectRef = useRef(false);
  const redirectTarget = location.href ?? '/app';

  useEffect(() => {
    if (isPending || isAuthenticated || redirectRef.current) {
      if (isAuthenticated) {
        redirectRef.current = false;
      }
      return;
    }

    redirectRef.current = true;
    void navigate({
      to: '/login',
      search: { redirect: redirectTarget },
      replace: true,
    }).catch(() => {
      redirectRef.current = false;
    });
  }, [isAuthenticated, isPending, navigate, redirectTarget]);

  if (isPending || !isAuthenticated) {
    return <AppLayoutSkeleton />;
  }

  return <Outlet />;
}

function AppLayoutSkeleton() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-8 w-8 text-muted-foreground" />
    </div>
  );
}
