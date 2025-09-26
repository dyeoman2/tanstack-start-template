import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { ensureAdminContext } from '~/lib/route-guards';

export const Route = createFileRoute('/admin/_layout')({
  component: AdminLayout,
  errorComponent: AdminErrorBoundary,
  beforeLoad: ensureAdminContext,
});

function AdminLayout() {
  return <Outlet />;
}
