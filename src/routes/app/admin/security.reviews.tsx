import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityReviewsRoute } from '~/features/security/components/routes/AdminSecurityReviewsRoute';
import { securityReviewsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/reviews')({
  validateSearch: securityReviewsSearchSchema,
  component: AdminSecurityReviewsRouteComponent,
});

function AdminSecurityReviewsRouteComponent() {
  return <AdminSecurityReviewsRoute search={Route.useSearch()} />;
}
