import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AdminSecurityLayout } from '~/features/security/components/routes/AdminSecurityShell';

export const Route = createFileRoute('/app/admin/security')({
  component: AdminSecurityLayoutRouteComponent,
});

function AdminSecurityLayoutRouteComponent() {
  return (
    <AdminSecurityLayout>
      <Outlet />
    </AdminSecurityLayout>
  );
}
