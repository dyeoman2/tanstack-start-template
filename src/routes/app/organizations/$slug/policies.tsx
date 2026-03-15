import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationPoliciesPage } from '~/features/organizations/components/OrganizationPoliciesPage';

export const Route = createFileRoute('/app/organizations/$slug/policies')({
  component: OrganizationPoliciesRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationPoliciesRoute() {
  const { slug } = Route.useParams();

  return <OrganizationPoliciesPage slug={slug} />;
}
