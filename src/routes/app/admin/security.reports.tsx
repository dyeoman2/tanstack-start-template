import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityReportsRoute } from '~/features/security/components/routes/AdminSecurityReportsRoute';
import { securityReportsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/reports')({
  validateSearch: securityReportsSearchSchema,
  component: AdminSecurityReportsRouteComponent,
});

function AdminSecurityReportsRouteComponent() {
  return <AdminSecurityReportsRoute search={Route.useSearch()} />;
}
