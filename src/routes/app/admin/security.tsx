import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminSecurityLayout } from '~/features/security/components/AdminSecurityRoute';
import { securityCompatSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security')({
  validateSearch: securityCompatSearchSchema,
  component: AdminSecurityLayoutRouteComponent,
});

function AdminSecurityLayoutRouteComponent() {
  return (
    <AdminSecurityLayout search={Route.useSearch()}>
      <Outlet />
    </AdminSecurityLayout>
  );
}
