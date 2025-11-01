import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Dashboard } from '~/features/dashboard/components/Dashboard';
import { getDashboardDataServerFn } from '~/features/dashboard/server/dashboard.server';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/')({
  loader: () => getDashboardDataServerFn(),
  component: DashboardComponent,
  errorComponent: DashboardErrorBoundary,
});

function DashboardComponent() {
  // Use dedicated performance monitoring hook
  usePerformanceMonitoring('Dashboard');

  const initialData = Route.useLoaderData();

  return <Dashboard initialData={initialData} />;
}
