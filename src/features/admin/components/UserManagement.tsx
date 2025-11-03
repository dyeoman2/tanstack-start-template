import { api } from '@convex/_generated/api';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useCallback, useMemo, useState } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import type { UserRole } from '../../auth/types';
import { USER_ROLES } from '../../auth/types';
import type { User as AdminUser } from '../types';
import { UserDeleteDialog } from './UserDeleteDialog';
import { UserEditDialog } from './UserEditDialog';
import { UserTable } from './UserTable';

type UserRoleFilterValue = 'all' | UserRole;

const ROLE_FILTER_OPTIONS: TableFilterOption<UserRoleFilterValue>[] = [
  { label: 'All roles', value: 'all' },
  { label: 'Admin', value: USER_ROLES.ADMIN },
  { label: 'User', value: USER_ROLES.USER },
];

export function UserManagement() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/admin/users' });
  const searchTerm = search.search ?? '';
  const roleFilter = (search.role ?? 'all') as UserRoleFilterValue;

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

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
        cursor?: string; // Add cursor for optimized pagination
      },
    [roleFilter, search],
  );

  // Use Convex query directly - enables real-time updates automatically
  const data = useQuery(api.admin.getAllUsers, adminUsersSearchParams);

  // Memoize data to prevent unnecessary re-renders
  const users = useMemo(() => data?.users ?? [], [data]);
  const pagination = data?.pagination;
  const isLoading = data === undefined;

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
        to: '/app/admin/users',
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
        to: '/app/admin/users',
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
            isSearching={false}
            className="min-w-[260px] sm:max-w-lg"
            ariaLabel="Search users by name or email"
          />
        </div>
        <UserTable
          users={users}
          pagination={pagination || { page: 1, pageSize: 10, total: 0, totalPages: 0 }}
          searchParams={adminUsersSearchParams}
          isLoading={isLoading}
          isFetching={false}
          onEditUser={handleEditUser}
          onDeleteUser={handleDeleteUser}
        />
      </div>

      <UserEditDialog open={showEditDialog} user={selectedUser} onClose={handleCloseDialogs} />

      <UserDeleteDialog
        open={showDeleteDialog}
        userId={selectedUserId}
        onClose={handleCloseDialogs}
      />
    </div>
  );
}
