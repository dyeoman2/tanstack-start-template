import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationDomainsPage } from '~/features/organizations/components/OrganizationDomainsPage';

export const Route = createFileRoute('/app/organizations/$slug/domains')({
  component: OrganizationDomainsRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationDomainsRoute() {
  const { slug } = Route.useParams();

  return <OrganizationDomainsPage slug={slug} />;
}
