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
  const redirectTimerRef = useRef<number | null>(null);
  const redirectTarget = location.href ?? '/app';

  useEffect(() => {
    if (isPending) {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      return;
    }

    if (!isAuthenticated) {
      if (redirectTimerRef.current === null) {
        redirectTimerRef.current = window.setTimeout(() => {
          redirectTimerRef.current = null;

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
        }, 400);
      }
    } else {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }

      redirectRef.current = false;
    }
  }, [isAuthenticated, isPending, navigate, redirectTarget]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

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
