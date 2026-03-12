import { createFileRoute, Outlet } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';

export const Route = createFileRoute('/app/organizations/_layout')({
  component: OrganizationsLayout,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationsLayout() {
  return <Outlet />;
}
