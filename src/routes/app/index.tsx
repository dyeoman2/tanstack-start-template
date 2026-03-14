import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { Dashboard } from '~/features/dashboard/components/Dashboard';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/')({
  staleTime: 30_000,
  gcTime: 2 * 60_000,
  component: DashboardComponent,
  errorComponent: DashboardErrorBoundary,
});

function DashboardComponent() {
  // Use dedicated performance monitoring hook
  usePerformanceMonitoring('Dashboard');

  const authState = useAuthState();
  const [dashboardAsOf, setDashboardAsOf] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setDashboardAsOf(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const dashboardData = useQuery(
    api.dashboard.getDashboardData,
    authState.isAuthenticated ? { asOf: dashboardAsOf } : 'skip',
  );
  const isLoading =
    authState.isPending || (authState.isAuthenticated && dashboardData === undefined);
  const resolvedData = authState.isAuthenticated
    ? (dashboardData ?? null)
    : { status: 'unauthenticated' as const };

  return <Dashboard data={resolvedData} isLoading={isLoading} />;
}
