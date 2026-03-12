import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationWorkspacePage } from '~/features/organizations/components/OrganizationWorkspacePage';

export const Route = createFileRoute('/app/organizations/$slug/members')({
  component: OrganizationMembersRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationMembersRoute() {
  const { slug } = Route.useParams();

  return <OrganizationWorkspacePage slug={slug} view="MEMBERS" />;
}
