import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationWorkspacePage } from '~/features/organizations/components/OrganizationWorkspacePage';

export const Route = createFileRoute('/app/organizations/$slug/settings')({
  component: OrganizationSettingsRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationSettingsRoute() {
  const { slug } = Route.useParams();

  return <OrganizationWorkspacePage slug={slug} view="SETTINGS" />;
}
