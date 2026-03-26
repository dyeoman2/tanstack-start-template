import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityReviewsRoute } from '~/features/security/components/routes/AdminSecurityReviewsRoute';
import {
  REPORT_KIND_FILTER_VALUES,
  REPORT_REVIEW_STATUS_FILTER_VALUES,
} from '~/features/security/constants';
import type { SecurityReviewsSearch } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/reviews')({
  // Avoid loading Zod on this route for a single optional string search param.
  // Zod v4 feature-detects JIT support with `new Function("")`, which trips our strict CSP.
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

  const reportKind =
    typeof search.reportKind === 'string' &&
    (REPORT_KIND_FILTER_VALUES as readonly string[]).includes(search.reportKind)
      ? (search.reportKind as SecurityReviewsSearch['reportKind'])
      : 'all';

  const reportReviewStatus =
    typeof search.reportReviewStatus === 'string' &&
    (REPORT_REVIEW_STATUS_FILTER_VALUES as readonly string[]).includes(search.reportReviewStatus)
      ? (search.reportReviewStatus as SecurityReviewsSearch['reportReviewStatus'])
      : 'all';

  const reportSearch = typeof search.reportSearch === 'string' ? search.reportSearch : '';

  const selectedReport =
    typeof search.selectedReport === 'string' && search.selectedReport.length > 0
      ? search.selectedReport
      : undefined;

  return {
    selectedReviewRun,
    reportKind,
    reportReviewStatus,
    reportSearch,
    selectedReport,
  };
}
