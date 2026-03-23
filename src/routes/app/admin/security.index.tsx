import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityOverviewRoute } from '~/features/security/components/AdminSecurityRoute';

export const Route = createFileRoute('/app/admin/security/')({
  component: AdminSecurityOverviewRoute,
});
