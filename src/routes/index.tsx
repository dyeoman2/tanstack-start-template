import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { routeAuthGuard } from '~/features/auth/server/route-guards';
import { Dashboard } from '~/features/dashboard/components/Dashboard';
import { DashboardSkeleton } from '~/features/dashboard/components/DashboardSkeleton';
import { getDashboardDataServerFn } from '~/features/dashboard/dashboard.server';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/')({
  beforeLoad: routeAuthGuard,
  component: DashboardComponent,
  errorComponent: DashboardErrorBoundary,
  pendingMs: 200,
  pendingComponent: DashboardSkeleton,
  loader: async () => {
    return getDashboardDataServerFn();
  },
});

function DashboardComponent() {
  const loaderData = Route.useLoaderData();

  // Use dedicated performance monitoring hook
  usePerformanceMonitoring('Dashboard');

  return <Dashboard data={loaderData} />;
}
