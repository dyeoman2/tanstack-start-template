import { createFileRoute, Outlet } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { routeAuthGuard } from '~/features/auth/server/route-guards';

export const Route = createFileRoute('/app')({
  beforeLoad: routeAuthGuard,
  component: AppLayout,
  errorComponent: DashboardErrorBoundary,
});

function AppLayout() {
  return <Outlet />;
}
