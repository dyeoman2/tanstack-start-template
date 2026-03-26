import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/admin/security/reports')({
  beforeLoad: () => {
    throw redirect({
      to: '/app/admin/security/reviews',
      search: {
        reportKind: 'all' as const,
        reportReviewStatus: 'all' as const,
        reportSearch: '',
        selectedReport: undefined,
        selectedReviewRun: undefined,
      },
    });
  },
});
