import { createFileRoute, Outlet } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { ensureAuthenticatedContext } from '~/lib/route-guards';

export const Route = createFileRoute('/_layout')({
  beforeLoad: ensureAuthenticatedContext,
  component: HomeLayout,
  errorComponent: DashboardErrorBoundary,
});

function HomeLayout() {
  return <Outlet />;
}
