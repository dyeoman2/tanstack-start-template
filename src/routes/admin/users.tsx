import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
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

const usersSearchSchema = z.object({
  page: z.number().default(1),
  pageSize: z.number().default(10),
  sortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']).default('role'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  secondarySortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']).default('name'),
  secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  role: z.enum(['all', 'user', 'admin']).default('all'),
});

export const Route = createFileRoute('/admin/users')({
  validateSearch: usersSearchSchema,
  component: UserManagement,
  errorComponent: AdminErrorBoundary,
  pendingMs: 200,
  pendingComponent: UserTableSkeleton,
  loader: async () => {
    return await getAllUsersServerFn({
      data: {
        page: 1,
        pageSize: 10,
        sortBy: 'role',
        sortOrder: 'asc',
        secondarySortBy: 'role',
        secondarySortOrder: 'asc',
        search: '',
        role: 'all',
      },
    });
  },
});
