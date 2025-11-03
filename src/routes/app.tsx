import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { NotFound } from '~/components/NotFound';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Spinner } from '~/components/ui/spinner';
import { useAuth } from '~/features/auth/hooks/useAuth';

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
  const { isAuthenticated, isPending } = useAuth();
  const redirectRef = useRef(false);
  const unauthenticatedStreakRef = useRef(0);
  const redirectTarget = location.href ?? '/app';

  useEffect(() => {
    if (isPending) {
      unauthenticatedStreakRef.current = 0;
      return;
    }

    if (!isAuthenticated) {
      unauthenticatedStreakRef.current += 1;

      if (unauthenticatedStreakRef.current < 2) {
        return;
      }

      if (redirectRef.current) {
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
    } else {
      unauthenticatedStreakRef.current = 0;
      redirectRef.current = false;
    }
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
