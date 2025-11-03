import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Shield } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import {
  createSortableHeader,
  DataTable,
  DeleteActionButton,
  EditActionButton,
  formatTableDate,
} from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { DEFAULT_ROLE, USER_ROLES } from '../../auth/types';
import type { User as AdminUser } from '../types';

type UserRow = AdminUser;

interface UserTableProps {
  users: UserRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  searchParams: {
    page: number;
    pageSize: number;
    sortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
    sortOrder: 'asc' | 'desc';
    secondarySortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
    secondarySortOrder: 'asc' | 'desc';
    search: string;
    role: 'all' | 'admin' | 'user';
  };
  isLoading: boolean;
  isFetching?: boolean;
  onEditUser: (user: UserRow) => void;
  onDeleteUser: (userId: string) => void;
}

export function UserTable({
  users,
  pagination,
  searchParams,
  isLoading,
  isFetching = false,
  onEditUser,
  onDeleteUser,
}: UserTableProps) {
  const navigate = useNavigate();

  // Sorting and pagination handlers
  const handleSorting = useCallback(
    (columnId: string) => {
      const newSortOrder =
        searchParams.sortBy === columnId && searchParams.sortOrder === 'asc' ? 'desc' : 'asc';
      navigate({
        to: '/app/admin/users',
        search: {
          ...searchParams,
          sortBy: columnId as 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt',
          sortOrder: newSortOrder,
          page: 1, // Reset to first page when sorting changes
        },
      });
    },
    [searchParams, navigate],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      navigate({
        to: '/app/admin/users',
        search: {
          ...searchParams,
          page: newPage,
        },
      });
    },
    [searchParams, navigate],
  );

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      navigate({
        to: '/app/admin/users',
        search: {
          ...searchParams,
          pageSize: newPageSize,
          page: 1, // Reset to first page when page size changes
        },
      });
    },
    [searchParams, navigate],
  );

  // Define table columns
  const tableColumns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: createSortableHeader('Name', 'name', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {row.original.name ?? 'No name'}
          </span>
        ),
      },
      {
        accessorKey: 'email',
        header: createSortableHeader('Email', 'email', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.email}</span>
        ),
      },
      {
        accessorKey: 'role',
        header: createSortableHeader('Role', 'role', searchParams, handleSorting),
        cell: ({ row }) => {
          const role = row.original.role ?? DEFAULT_ROLE;
          const isAdmin = role === USER_ROLES.ADMIN;
          const roleLabel = `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;

          return (
            <Badge variant={isAdmin ? 'destructive' : 'secondary'}>
              {isAdmin && <Shield className="h-3 w-3 mr-1" />}
              {roleLabel}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'emailVerified',
        header: createSortableHeader('Status', 'emailVerified', searchParams, handleSorting),
        cell: ({ row }) => (
          <Badge variant={row.original.emailVerified ? 'default' : 'outline'}>
            {row.original.emailVerified ? 'Verified' : 'Unverified'}
          </Badge>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: createSortableHeader('Created', 'createdAt', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatTableDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <EditActionButton onClick={() => onEditUser(row.original)} />
              <DeleteActionButton onClick={() => onDeleteUser(row.original.id)} />
            </div>
          </div>
        ),
      },
    ],
    [handleSorting, onDeleteUser, onEditUser, searchParams],
  );

  return (
    <DataTable<UserRow, (typeof tableColumns)[number]>
      data={users}
      columns={tableColumns}
      pagination={pagination}
      searchParams={searchParams}
      isLoading={isLoading}
      isFetching={isFetching}
      onPageChange={handlePageChange}
      onPageSizeChange={handlePageSizeChange}
      emptyMessage="No users found."
    />
  );
}
