import { createFileRoute } from '@tanstack/react-router';
import { AdminSecurityPoliciesRoute } from '~/features/security/components/routes/AdminSecurityPoliciesRoute';
import { securityPoliciesSearchSchema } from '~/features/security/search';

export const Route = createFileRoute('/app/admin/security/policies')({
  validateSearch: securityPoliciesSearchSchema,
  component: AdminSecurityPoliciesRouteComponent,
});

function AdminSecurityPoliciesRouteComponent() {
  return <AdminSecurityPoliciesRoute search={Route.useSearch()} />;
}
