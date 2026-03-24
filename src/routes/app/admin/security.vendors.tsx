import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityVendorsRoute } from '~/features/security/components/routes/AdminSecurityVendorsRoute';
import { securityVendorsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/vendors')({
  validateSearch: securityVendorsSearchSchema,
  component: AdminSecurityVendorsRouteComponent,
});

function AdminSecurityVendorsRouteComponent() {
  return <AdminSecurityVendorsRoute search={Route.useSearch()} />;
}
