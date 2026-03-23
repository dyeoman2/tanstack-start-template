import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityRoute } from '~/features/security/components/AdminSecurityRoute';
import { securitySearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security')({
  validateSearch: securitySearchSchema,
  component: AdminSecurityRouteComponent,
});

function AdminSecurityRouteComponent() {
  return <AdminSecurityRoute search={Route.useSearch()} />;
}
