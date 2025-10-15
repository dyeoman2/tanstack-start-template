import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import { type GetAllUsersServerFn, getAllUsersServerFn } from '~/features/dashboard/admin.server';
import { queryKeys } from '~/lib/query-keys';
import type { User as AdminUser } from '../server/admin-loader.server';
import { UserDeleteDialog } from './UserDeleteDialog';
import { UserEditDialog } from './UserEditDialog';
import { UserTable } from './UserTable';

type UserRoleFilterValue = 'all' | 'admin' | 'user';

const ROLE_FILTER_OPTIONS: TableFilterOption<UserRoleFilterValue>[] = [
  { label: 'All roles', value: 'all' },
  { label: 'Admin', value: 'admin' },
  { label: 'User', value: 'user' },
];

export function UserManagement() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/admin/users' });
  const searchTerm = search.search ?? '';
  const roleFilter = (search.role ?? 'all') as UserRoleFilterValue;

  const [selectedUser, setSelectedUser] = useState<GetAllUsersServerFn['users'][number] | null>(
    null,
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const queryClient = useQueryClient();

  const adminUsersSearchParams = useMemo(
    () =>
      ({
        ...search,
        role: roleFilter,
      }) satisfies {
        page: number;
        pageSize: number;
        sortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
        sortOrder: 'asc' | 'desc';
        secondarySortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
        secondarySortOrder: 'asc' | 'desc';
        search: string;
        role: UserRoleFilterValue;
      },
    [roleFilter, search],
  );

  const { data, isFetching, isPending } = useQuery({
    queryKey: queryKeys.admin.users.list(adminUsersSearchParams),
    queryFn: () => getAllUsersServerFn({ data: adminUsersSearchParams }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
  });

  // Memoize data to prevent unnecessary re-renders
  const users = useMemo(() => data?.users ?? [], [data]);
  const pagination = data?.pagination;
  const isLoading = isPending && !data;

  const handleEditUser = (user: AdminUser) => {
    setSelectedUser(user);
    setShowEditDialog(true);
  };

  const handleDeleteUser = (userId: string) => {
    setSelectedUserId(userId);
    setShowDeleteDialog(true);
  };

  const handleCloseDialogs = () => {
    setShowDeleteDialog(false);
    setShowEditDialog(false);
    setSelectedUser(null);
    setSelectedUserId(null);
  };

  const handleSearchChange = useCallback(
    (term: string) => {
      const normalizedTerm = term.trim();
      if (normalizedTerm === searchTerm.trim()) {
        return;
      }

      navigate({
        to: '/admin/users',
        search: {
          ...adminUsersSearchParams,
          search: normalizedTerm,
          page: 1,
        },
      });
    },
    [adminUsersSearchParams, navigate, searchTerm],
  );

  const handleRoleFilterChange = useCallback(
    (nextRole: UserRoleFilterValue) => {
      if (nextRole === roleFilter) {
        return;
      }

      navigate({
        to: '/admin/users',
        search: {
          ...adminUsersSearchParams,
          role: nextRole,
          page: 1,
        },
      });
    },
    [adminUsersSearchParams, navigate, roleFilter],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Manage user accounts, roles, and permissions."
      />

      <div className="mt-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TableFilter<UserRoleFilterValue>
            label="Role"
            value={roleFilter}
            options={ROLE_FILTER_OPTIONS}
            onValueChange={handleRoleFilterChange}
            className="sm:w-48"
            ariaLabel="Filter users by role"
          />
          <TableSearch
            initialValue={searchTerm}
            onSearch={handleSearchChange}
            placeholder="Search by name or email"
            isSearching={isFetching && !isLoading}
            className="min-w-[260px] sm:max-w-lg"
            ariaLabel="Search users by name or email"
          />
        </div>
        <UserTable
          users={users}
          pagination={pagination || { page: 1, pageSize: 10, total: 0, totalPages: 0 }}
          searchParams={adminUsersSearchParams}
          isLoading={isLoading}
          isFetching={isFetching && !isLoading}
          onEditUser={handleEditUser}
          onDeleteUser={handleDeleteUser}
        />
      </div>

      <UserEditDialog
        open={showEditDialog}
        user={selectedUser}
        onClose={handleCloseDialogs}
        queryClient={queryClient}
      />

      <UserDeleteDialog
        open={showDeleteDialog}
        userId={selectedUserId}
        onClose={handleCloseDialogs}
        queryClient={queryClient}
      />
    </div>
  );
}
