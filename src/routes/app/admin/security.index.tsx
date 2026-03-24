import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityOverviewRoute } from '~/features/security/components/routes/AdminSecurityOverviewRoute';

export const Route = createFileRoute('/app/admin/security/')({
  component: AdminSecurityOverviewRoute,
});
