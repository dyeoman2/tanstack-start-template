import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationIdentityPage } from '~/features/organizations/components/OrganizationIdentityPage';

const organizationIdentitySearchSchema = z.object({
  step: z.enum(['step-1', 'step-2', 'step-3', 'step-4']).optional(),
});

export const Route = createFileRoute('/app/organizations/$slug/identity')({
  validateSearch: organizationIdentitySearchSchema,
  component: OrganizationIdentityRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationIdentityRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  return <OrganizationIdentityPage slug={slug} searchParams={search} />;
}
