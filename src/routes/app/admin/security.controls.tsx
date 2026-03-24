import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityControlsRoute } from '~/features/security/components/routes/AdminSecurityControlsRoute';
import { securityControlsSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/controls')({
  validateSearch: securityControlsSearchSchema,
  component: AdminSecurityControlsRouteComponent,
});

function AdminSecurityControlsRouteComponent() {
  return <AdminSecurityControlsRoute search={Route.useSearch()} />;
}
