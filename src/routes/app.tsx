import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AuthenticatedAppShell } from '~/components/AuthenticatedAppShell';
import { NotFound } from '~/components/NotFound';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Spinner } from '~/components/ui/spinner';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { normalizeAppRedirectTarget } from '~/features/auth/lib/account-setup-routing';

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
  const redirectTarget = normalizeAppRedirectTarget(location.pathname);

  useEffect(() => {
    if (isPending || redirectRef.current) {
      return;
    }

    if (isAuthenticated && (requiresEmailVerification || requiresMfaSetup)) {
      redirectRef.current = true;
      void navigate({
        to: '/account-setup',
        search: {
          ...(user?.email ? { email: user.email } : {}),
          ...(redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {}),
        },
        replace: true,
      }).catch(() => {
        redirectRef.current = false;
      });
      return;
    }

    if (isAuthenticated) {
      if (!requiresEmailVerification && !requiresMfaSetup) {
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
    user?.email,
  ]);

  if (isPending || !isAuthenticated || requiresEmailVerification || requiresMfaSetup) {
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
