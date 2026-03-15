import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationAuditPage } from '~/features/organizations/components/OrganizationAuditPage';
import { organizationAuditSearchSchema } from '~/features/organizations/lib/organization-management';

export const Route = createFileRoute('/app/organizations/$slug/audit')({
  validateSearch: organizationAuditSearchSchema,
  component: OrganizationAuditRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationAuditRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  return <OrganizationAuditPage slug={slug} searchParams={search} />;
}
