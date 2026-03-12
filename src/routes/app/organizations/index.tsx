import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationDirectoryPage } from '~/features/organizations/components/OrganizationDirectoryPage';

export const Route = createFileRoute('/app/organizations/')({
  component: OrganizationsIndexRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationsIndexRoute() {
  return <OrganizationDirectoryPage />;
}
