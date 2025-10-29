import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { routeAuthGuard } from '~/features/auth/server/route-guards';
import { Dashboard } from '~/features/dashboard/components/Dashboard';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/')({
  beforeLoad: routeAuthGuard,
  component: DashboardComponent,
  errorComponent: DashboardErrorBoundary,
});

function DashboardComponent() {
  // Use dedicated performance monitoring hook
  usePerformanceMonitoring('Dashboard');

  return <Dashboard />;
}
