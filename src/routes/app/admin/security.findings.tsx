import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityFindingsRoute } from '~/features/security/components/AdminSecurityRoute';
import { securityFindingsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/findings')({
  validateSearch: securityFindingsSearchSchema,
  component: AdminSecurityFindingsRouteComponent,
});

function AdminSecurityFindingsRouteComponent() {
  return <AdminSecurityFindingsRoute search={Route.useSearch()} />;
}
