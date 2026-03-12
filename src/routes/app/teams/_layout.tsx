import { createFileRoute, Outlet } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';

export const Route = createFileRoute('/app/teams/_layout')({
  component: TeamsLayout,
  errorComponent: DashboardErrorBoundary,
});

function TeamsLayout() {
  return <Outlet />;
}
