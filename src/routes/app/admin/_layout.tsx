import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { routeAdminGuard } from '~/features/auth/server/route-guards';

export const Route = createFileRoute('/app/admin/_layout')({
  component: AdminLayout,
  errorComponent: AdminErrorBoundary,
  beforeLoad: routeAdminGuard,
});

function AdminLayout() {
  return <Outlet />;
}
