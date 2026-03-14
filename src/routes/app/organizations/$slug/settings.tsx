import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationSettingsManagement } from '~/features/organizations/components/OrganizationSettingsManagement';
import { organizationDirectorySearchSchema } from '~/features/organizations/lib/organization-management';

export const Route = createFileRoute('/app/organizations/$slug/settings')({
  validateSearch: organizationDirectorySearchSchema,
  component: OrganizationSettingsRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationSettingsRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  return <OrganizationSettingsManagement slug={slug} searchParams={search} />;
}
