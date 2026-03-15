import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationMembersPage } from '~/features/organizations/components/OrganizationMembersPage';
import { organizationDirectorySearchSchema } from '~/features/organizations/lib/organization-management';

export const Route = createFileRoute('/app/organizations/$slug/members')({
  validateSearch: organizationDirectorySearchSchema,
  component: OrganizationMembersRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationMembersRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  return <OrganizationMembersPage slug={slug} searchParams={search} />;
}
