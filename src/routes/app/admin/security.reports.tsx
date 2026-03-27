import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityReportsRoute } from '~/features/security/components/routes/AdminSecurityReportsRoute';
import {
  REPORT_KIND_FILTER_VALUES,
  REPORT_REVIEW_STATUS_FILTER_VALUES,
} from '~/features/security/constants';
import type { SecurityReportsSearch } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/reports')({
  validateSearch: validateSecurityReportsSearch,
  component: AdminSecurityReportsRouteComponent,
});

function AdminSecurityReportsRouteComponent() {
  return <AdminSecurityReportsRoute search={Route.useSearch()} />;
}

function validateSecurityReportsSearch(search: Record<string, unknown>): SecurityReportsSearch {
  const reportKind =
    typeof search.reportKind === 'string' &&
    (REPORT_KIND_FILTER_VALUES as readonly string[]).includes(search.reportKind)
      ? (search.reportKind as SecurityReportsSearch['reportKind'])
      : 'all';

  const reportReviewStatus =
    typeof search.reportReviewStatus === 'string' &&
    (REPORT_REVIEW_STATUS_FILTER_VALUES as readonly string[]).includes(search.reportReviewStatus)
      ? (search.reportReviewStatus as SecurityReportsSearch['reportReviewStatus'])
      : 'all';

  const reportSearch = typeof search.reportSearch === 'string' ? search.reportSearch : '';

  const selectedReport =
    typeof search.selectedReport === 'string' && search.selectedReport.length > 0
      ? search.selectedReport
      : undefined;

  return {
    reportKind,
    reportReviewStatus,
    reportSearch,
    selectedReport,
  };
}
