import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AuthenticatedAppShell } from '~/components/AuthenticatedAppShell';
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
  const { isAuthenticated, isPending, requiresEmailVerification, requiresMfaSetup, user } =
    useAuth();
  const redirectRef = useRef(false);
  const redirectTarget = location.href ?? '/app';
  const isProfileRoute = location.pathname === '/app/profile';

  useEffect(() => {
    if (isPending || redirectRef.current) {
      return;
    }

    if (isAuthenticated && requiresEmailVerification && user?.email) {
      redirectRef.current = true;
      void navigate({
        to: '/verify-email-pending',
        search: { email: user.email, redirectTo: redirectTarget },
        replace: true,
      }).catch(() => {
        redirectRef.current = false;
      });
      return;
    }

    if (isAuthenticated) {
      if (requiresMfaSetup && !isProfileRoute) {
        redirectRef.current = true;
        void navigate({
          to: '/app/profile',
          search: { security: 'mfa-required' },
          replace: true,
        }).catch(() => {
          redirectRef.current = false;
        });
        return;
      }

      if (!requiresEmailVerification && (!requiresMfaSetup || isProfileRoute)) {
        redirectRef.current = false;
      }
      return;
    }

    redirectRef.current = true;
    void navigate({
      to: '/login',
      search: { redirectTo: redirectTarget },
      replace: true,
    }).catch(() => {
      redirectRef.current = false;
    });
  }, [
    isAuthenticated,
    isPending,
    navigate,
    redirectTarget,
    requiresEmailVerification,
    requiresMfaSetup,
    isProfileRoute,
    user?.email,
  ]);

  if (
    isPending ||
    !isAuthenticated ||
    requiresEmailVerification ||
    (requiresMfaSetup && !isProfileRoute)
  ) {
    return <AppLayoutSkeleton />;
  }

  return (
    <AuthenticatedAppShell>
      <Outlet />
    </AuthenticatedAppShell>
  );
}

function AppLayoutSkeleton() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-8 w-8 text-muted-foreground" />
    </div>
  );
}
