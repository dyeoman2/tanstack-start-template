import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityFindingsRoute } from '~/features/security/components/routes/AdminSecurityFindingsRoute';
import { securityFindingsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/findings')({
  validateSearch: securityFindingsSearchSchema,
  component: AdminSecurityFindingsRouteComponent,
});

function AdminSecurityFindingsRouteComponent() {
  return <AdminSecurityFindingsRoute search={Route.useSearch()} />;
}
