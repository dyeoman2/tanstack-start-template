import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationIdentityPage } from '~/features/organizations/components/OrganizationIdentityPage';

export const Route = createFileRoute('/app/organizations/$slug/identity')({
  component: OrganizationIdentityRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationIdentityRoute() {
  const { slug } = Route.useParams();

  return <OrganizationIdentityPage slug={slug} />;
}
