import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityOperationsRoute } from '~/features/security/components/AdminSecurityRoute';
import { securityOperationsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/operations')({
  validateSearch: securityOperationsSearchSchema,
  component: AdminSecurityOperationsRouteComponent,
});

function AdminSecurityOperationsRouteComponent() {
  return <AdminSecurityOperationsRoute search={Route.useSearch()} />;
}
