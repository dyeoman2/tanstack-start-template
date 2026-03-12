import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationSettingsManagement } from '~/features/organizations/components/OrganizationSettingsManagement';

export const Route = createFileRoute('/app/organizations/$slug/settings')({
  component: OrganizationSettingsRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationSettingsRoute() {
  const { slug } = Route.useParams();

  return <OrganizationSettingsManagement slug={slug} />;
}
