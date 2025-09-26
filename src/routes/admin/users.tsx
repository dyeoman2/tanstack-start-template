import { createFileRoute } from '@tanstack/react-router';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { UserManagement } from '~/features/admin/components/UserManagement';
import { getAllUsersServerFn } from '~/features/dashboard/admin.server';

function UserTableSkeleton() {
  return (
    <div className="mt-8">
      <div className="animate-pulse bg-gray-100 rounded-lg h-96" />
    </div>
  );
}

export const Route = createFileRoute('/admin/users')({
  component: UserManagement,
  errorComponent: AdminErrorBoundary,
  pendingMs: 200,
  pendingComponent: UserTableSkeleton,
  loader: async () => {
    return await getAllUsersServerFn();
  },
});
