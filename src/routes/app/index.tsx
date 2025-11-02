import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
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

  const dashboardData = useQuery(api.dashboard.getDashboardData, {});
  const isLoading = dashboardData === undefined;

  return <Dashboard data={dashboardData ?? null} isLoading={isLoading} />;
}
