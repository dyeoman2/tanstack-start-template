import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityReviewsRoute } from '~/features/security/components/routes/AdminSecurityReviewsRoute';
import type { SecurityReviewsSearch } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/reviews')({
  validateSearch: validateSecurityReviewsSearch,
  component: AdminSecurityReviewsRouteComponent,
});

function AdminSecurityReviewsRouteComponent() {
  return <AdminSecurityReviewsRoute search={Route.useSearch()} />;
}

function validateSecurityReviewsSearch(search: Record<string, unknown>): SecurityReviewsSearch {
  const selectedReviewRun =
    typeof search.selectedReviewRun === 'string' && search.selectedReviewRun.length > 0
      ? search.selectedReviewRun
      : undefined;

  return {
    selectedReviewRun,
  };
}
