import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Dashboard } from '~/features/dashboard/components/Dashboard';
import { DashboardSkeleton } from '~/features/dashboard/components/DashboardSkeleton';
import {
  type DashboardData,
  getDashboardDataServerFn,
} from '~/features/dashboard/dashboard.server';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';
import { ensureAuthenticatedContext } from '~/lib/route-guards';

export const Route = createFileRoute('/')({
  beforeLoad: ensureAuthenticatedContext,
  component: DashboardComponent,
  errorComponent: DashboardErrorBoundary,
  pendingMs: 200,
  pendingComponent: DashboardSkeleton,
  loader: async () => {
    return getDashboardDataServerFn();
  },
});

function DashboardComponent() {
  const loaderData = Route.useLoaderData() as DashboardData;

  // Use dedicated performance monitoring hook
  usePerformanceMonitoring('Dashboard');

  return <Dashboard data={loaderData} />;
}
